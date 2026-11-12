"""Creating orders and moving them through the kitchen, with notifications."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import jwt
from sqlalchemy import and_, or_, select, text
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..domain import delivery, kitchen, order_flow, slots
from ..domain.order_flow import OrderType, Status
from ..domain.settings import WEEKDAYS, RestaurantSettings
from ..models import (
    DiningTable,
    MenuItem,
    Option,
    Order,
    OrderItem,
    OrderStatusEvent,
    Promotion,
    TableSession,
    User,
)
from ..realtime import Outbox
from ..schemas import OrderCreate, OrderItemIn
from ..security import decode_token
from . import notify, payments


class OrderError(Exception):
    """A problem the customer or staff member can fix; shown as a 400/409."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def aware(dt: datetime | None) -> datetime | None:
    """SQLite drops time zones; Postgres keeps them. Treat naive values as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# --- Slots -------------------------------------------------------------------------


def occupied_slot_starts(db: Session, day_start: datetime, day_end: datetime, now: datetime) -> list[datetime]:
    """Slot starts held by live delivery orders and unexpired payment holds."""
    rows = db.scalars(
        select(Order.slot_start).where(
            Order.type == OrderType.DELIVERY,
            Order.slot_start >= day_start,
            Order.slot_start < day_end,
            Order.status.in_(order_flow.HOLDS_SLOT),
            or_(Order.status != Status.PENDING_PAYMENT, Order.hold_expires_at > now),
        )
    ).all()
    return [aware(r) for r in rows]


def day_bounds(day, settings: RestaurantSettings) -> tuple[datetime, datetime]:
    tz = ZoneInfo(settings.timezone)
    start = datetime.combine(day, datetime.min.time(), tz)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


def _lock_slot_booking(db: Session) -> None:
    """Serialise slot booking so two customers can't take the last place at once."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(7201)"))


# --- Pricing -----------------------------------------------------------------------


def _price_item(db: Session, line: OrderItemIn) -> OrderItem:
    item = db.get(MenuItem, line.menu_item_id)
    if item is None or not item.is_available or not item.category.is_active:
        raise OrderError(f"{item.name if item else 'A dish'} is not available right now")
    chosen = [db.get(Option, oid) for oid in line.option_ids]
    group_ids = {g.id for g in item.option_groups}
    for opt in chosen:
        if opt is None or opt.group_id not in group_ids or not opt.is_available:
            raise OrderError(f"an option for {item.name} is not available")
    chosen_names = {o.name for o in chosen}
    for g in item.option_groups:
        n = sum(1 for o in chosen if o.group_id == g.id)
        if g.shown_if and g.shown_if not in chosen_names:
            # e.g. 14" toppings picked with a 7" pizza: not offered, so not allowed
            if n:
                raise OrderError(f"{g.name} doesn't go with your choices for {item.name}")
            continue
        if n < g.min_choices or n > g.max_choices:
            raise OrderError(f"choose {g.min_choices}-{g.max_choices} for {g.name} on {item.name}")
    unit = item.price_pence + sum(o.price_pence for o in chosen)
    return OrderItem(
        menu_item_id=item.id,
        name=item.name,
        quantity=line.quantity,
        unit_price_pence=unit,
        options=[{"name": o.name, "price_pence": o.price_pence} for o in chosen],
        allergens=list(item.allergens or []),
        notes=line.notes,
    )


def _promotion_discount(db: Session, code: str | None, subtotal: int, fee: int, now: datetime) -> tuple[int, Promotion | None]:
    q = select(Promotion).where(Promotion.is_active.is_(True))
    q = q.where(Promotion.code == code.strip().upper()) if code else q.where(Promotion.code.is_(None))
    best, best_promo = 0, None
    for p in db.scalars(q).all():
        if (p.starts_at and aware(p.starts_at) > now) or (p.ends_at and aware(p.ends_at) < now):
            continue
        if p.max_uses is not None and p.uses >= p.max_uses:
            continue
        if subtotal < p.min_spend_pence:
            continue
        amount = {"percent": subtotal * p.value // 100, "amount": p.value, "free_delivery": fee}.get(p.kind, 0)
        amount = min(amount, subtotal + fee)
        if amount > best:
            best, best_promo = amount, p
    if code and best_promo is None:
        raise OrderError("that offer code isn't valid for this order")
    return best, best_promo


def _open_now(settings: RestaurantSettings, now: datetime) -> bool:
    local = now.astimezone(ZoneInfo(settings.timezone))
    h = settings.opening_hours[WEEKDAYS[local.weekday()]]
    return not h.closed and h.opens <= local.time() < h.closes


# --- Create ------------------------------------------------------------------------


def _table_session(db: Session, token: str, cfg: AppConfig) -> TableSession:
    try:
        table_id = int(decode_token(token, cfg.jwt_secret, kind="table")["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise OrderError("this table code isn't valid - please ask a member of staff") from None
    table = db.get(DiningTable, table_id)
    if table is None or not table.is_active:
        raise OrderError("this table isn't taking orders")
    session = db.scalars(
        select(TableSession).where(TableSession.table_id == table.id, TableSession.closed_at.is_(None))
    ).first()
    if session is None:
        session = TableSession(table_id=table.id)
        db.add(session)
        db.flush()
    return session


def create_order(
    db: Session,
    outbox: Outbox,
    data: OrderCreate,
    user: User | None,
    settings: RestaurantSettings,
    cfg: AppConfig,
    now: datetime,
) -> Order:
    if data.type is not OrderType.DINE_IN:
        if settings.online_orders_paused:
            raise OrderError("we're not taking online orders right now", 409)
        if data.type is OrderType.DELIVERY and not slots.delivery_open(settings, now):
            raise OrderError(f"we're not delivering right now. {delivery_hours_text(settings, now)}", 409)
        if data.type is OrderType.COLLECTION and not settings.collection_enabled:
            raise OrderError("collection isn't available right now", 409)
        if data.type is OrderType.COLLECTION and not _open_now(settings, now):
            raise OrderError("we're closed right now, so collection orders can't be taken", 409)
    elif not _open_now(settings, now):
        raise OrderError("the kitchen is closed", 409)

    if data.type is not OrderType.DINE_IN and user is None and not (data.customer_name and data.customer_phone):
        raise OrderError("please give your name and phone number so we can update you")

    lines = [_price_item(db, line) for line in data.items]
    subtotal = sum(li.unit_price_pence * li.quantity for li in lines)

    order = Order(
        user_id=user.id if user else None,
        type=data.type,
        status=order_flow.initial_status(data.type),
        customer_name=data.customer_name or (user.name if user else ""),
        customer_phone=data.customer_phone or (user.phone or "" if user else ""),
        notes=data.notes,
        push_token=data.push_token,
        customer_email=data.customer_email or None,
        tip_pence=data.tip_pence,
        delivery_fee_pence=0,
        discount_pence=0,
        extra_minutes=0,
        items=lines,
    )

    if data.type is OrderType.DELIVERY:
        if subtotal < settings.min_order_pence:
            raise OrderError(f"minimum order for delivery is £{settings.min_order_pence / 100:.2f}")
        try:
            q = delivery.quote(data.address.lat, data.address.lng, settings)
        except delivery.OutsideDeliveryArea as e:
            raise OrderError(str(e)) from None
        order.address = data.address.model_dump()
        order.distance_miles = q.distance_miles
        order.delivery_fee_pence = q.fee_pence
        # As soon as possible: no slots. The customer is told "about 45 minutes" (more on a busy night).
        order.promised_minutes = quoted_delivery_minutes(settings)
        order.channel = "online"

    if data.type is OrderType.COLLECTION:
        order.channel = "online"

    if data.type is OrderType.DINE_IN:
        order.table_session = _table_session(db, data.table_token, cfg)
        order.channel = "table"
        order.pay_code = _new_pay_code(db)

    order.discount_pence, promo = _promotion_discount(db, data.promo_code, subtotal, order.delivery_fee_pence, now)
    if promo:
        promo.uses += 1
    order.subtotal_pence = subtotal
    order.total_pence = subtotal + order.delivery_fee_pence + order.tip_pence - order.discount_pence

    db.add(order)
    db.flush()
    _record(db, order, order.status, user, now)
    return order


def _new_pay_code(db: Session) -> str:
    """A 4-digit code no other unpaid order is using."""
    import secrets

    taken = set(db.scalars(select(Order.pay_code).where(Order.status == Status.PENDING_PAYMENT,
                                                          Order.pay_code.is_not(None))).all())
    for _ in range(50):
        code = f"{secrets.randbelow(9000) + 1000}"
        if code not in taken:
            return code
    raise OrderError("too many orders waiting at the till, please try again", 503)


def find_by_pay_code(db: Session, code: str) -> Order | None:
    return db.scalar(select(Order).where(Order.pay_code == code.strip(), Order.status == Status.PENDING_PAYMENT)
                     .order_by(Order.id.desc()))


def pay_at_till(db: Session, outbox: Outbox, order: Order, method: str, settings, now, actor: User | None = None) -> Order:
    """The cashier took card or cash for a table order: it's paid and goes to the kitchen."""
    if order.status is not Status.PENDING_PAYMENT:
        raise OrderError("this order is already paid", 409)
    order.payment_method = method
    return mark_paid(db, outbox, order, settings, now)


# --- Delivery times ------------------------------------------------------------------


def quoted_delivery_minutes(settings: RestaurantSettings) -> int:
    """What a new delivery customer is told: the usual time plus any busy-night extra."""
    return settings.delivery_minutes + settings.busy_extra_minutes


def delivery_hours_text(settings: RestaurantSettings, now: datetime) -> str:
    """e.g. "We deliver Mon-Thu 6pm-10pm, Fri-Sun 5pm-10pm. Next delivery: today at 6pm." """
    summary = slots.delivery_summary(settings)
    if not summary:
        return "Delivery is switched off."
    nxt = slots.next_delivery_open(settings, now)
    when = ""
    if nxt is not None and nxt != now:
        local = nxt.astimezone(ZoneInfo(settings.timezone))
        today = now.astimezone(ZoneInfo(settings.timezone)).date()
        day = "today" if local.date() == today else local.strftime("%A")
        when = f" Next delivery: {day} at {slots.clock_text(local.time())}."
    return f"We deliver {summary}.{when}"


def arrive_by(order: Order, settings: RestaurantSettings) -> datetime | None:
    """Delivery: when the customer should expect it (time of payment + promised minutes + delays)."""
    if order.type is not OrderType.DELIVERY or not order.promised_minutes or order.slot_start is not None:
        return None
    base = aware(order.paid_at) or aware(order.created_at)
    if base is None:
        return None
    return base + timedelta(minutes=order.promised_minutes + (order.extra_minutes or 0))


def set_busy_time(db: Session, outbox: Outbox, settings: RestaurantSettings, extra: int, tell_customers: bool,
                  now: datetime, actor: User | None = None) -> int:
    """Kitchen's busy-night button: new delivery customers are quoted the longer time, and (optionally)
    customers already waiting get the same extra minutes and a "running late" message.
    Returns how many waiting customers were told."""
    from .settings_store import save_settings

    added = extra - settings.busy_extra_minutes
    settings.busy_extra_minutes = extra
    save_settings(db, settings)
    told = 0
    if added > 0 and tell_customers:
        waiting = db.scalars(select(Order).where(
            Order.type.in_([OrderType.DELIVERY, OrderType.COLLECTION]),
            Order.status.in_([Status.PLACED, Status.ACCEPTED, Status.PREPARING]),
            Order.slot_start.is_(None),
        )).all()
        for o in waiting:
            delay(db, outbox, o, added, settings, now, actor)
            told += 1
    outbox.add("kitchen", {"event": "busy_time", "extra_minutes": extra})
    return told


# --- Till (front counter) ----------------------------------------------------------------


def create_till_order(db: Session, outbox: Outbox, data, actor: User, settings: RestaurantSettings, now: datetime) -> Order:
    """A sale at the counter. Staff have already taken the money (card machine or cash), so the order is
    paid and goes straight to the kitchen."""
    lines = [_price_item(db, line) for line in data.items]
    subtotal = sum(li.unit_price_pence * li.quantity for li in lines)
    discount = min(data.discount_pence, subtotal)
    order = Order(
        type=OrderType.COLLECTION, status=Status.PLACED, channel="till", service=data.service,
        payment_method=data.payment_method, customer_name=data.customer_name.strip() or
        ("Eat in" if data.service == "eat_in" else "Takeaway"),
        notes=data.notes, items=lines, subtotal_pence=subtotal, discount_pence=discount,
        total_pence=subtotal - discount, paid_at=now, delivery_fee_pence=0, tip_pence=0, extra_minutes=0,
    )
    if data.payment_method == "cash" and data.cash_given_pence is not None and data.cash_given_pence < order.total_pence:
        raise OrderError("the cash given is less than the total")
    db.add(order)
    db.flush()
    _record(db, order, Status.PLACED, actor, now, note=f"till · {data.payment_method}")
    _broadcast(outbox, order, settings)
    if settings.auto_accept:
        accept(db, outbox, order, None, settings, now, actor)
    return order


# --- Payment -----------------------------------------------------------------------


def mark_paid(db: Session, outbox: Outbox, order: Order, settings: RestaurantSettings, now: datetime) -> Order:
    if order.status is not Status.PENDING_PAYMENT:
        return order  # webhook retries are harmless
    order.paid_at = now
    order.payment_method = order.payment_method or "online"
    order.hold_expires_at = None
    move(db, outbox, order, Status.PLACED, None, settings, now)
    if settings.auto_accept:
        accept(db, outbox, order, None, settings, now)
    return order


# --- Kitchen and driver steps ---------------------------------------------------------


def timing(order: Order) -> kitchen.TicketTiming:
    return kitchen.TicketTiming(
        order_id=order.id,
        order_type=order.type,
        status=order.status,
        created_at=aware(order.created_at),
        slot_start=aware(order.slot_start),
        prep_minutes=order.prep_minutes,
        accepted_at=aware(order.accepted_at),
        extra_minutes=order.extra_minutes,
    )


def ready_time(order: Order, settings: RestaurantSettings) -> datetime:
    return kitchen.ready_at(timing(order), settings.default_prep_minutes)


def accept(db, outbox, order: Order, prep_minutes: int | None, settings, now, actor: User | None = None,
           extra_minutes: int = 0) -> Order:
    order.accepted_at = now
    order.prep_minutes = prep_minutes or settings.default_prep_minutes
    if extra_minutes:
        # The "accepted" text then carries the later time (e.g. "should arrive around 7:05 pm").
        order.extra_minutes = (order.extra_minutes or 0) + extra_minutes
    return move(db, outbox, order, Status.ACCEPTED, actor, settings, now)


def delay(db, outbox, order: Order, minutes: int, settings, now, actor: User | None = None) -> Order:
    if order.status not in {Status.PLACED, Status.ACCEPTED, Status.PREPARING}:
        raise OrderError("only orders not yet ready can be delayed")
    order.extra_minutes += minutes
    new_time = arrive_by(order, settings) or ready_time(order, settings)
    _record(db, order, order.status, actor, now, note=f"+{minutes} min")
    notify.queue(db, order, order_flow.delay_message(new_time.astimezone(ZoneInfo(settings.timezone)), minutes), kind="delay",
                 send_at=now)
    _broadcast(outbox, order, settings)
    return order


def reject(db, outbox, order: Order, reason: str, settings, cfg: AppConfig, now, actor: User | None = None) -> Order:
    order.reject_reason = reason
    move(db, outbox, order, Status.REJECTED, actor, settings, now, note=reason)
    payments.refund(order, cfg)
    return order


def move(
    db: Session,
    outbox: Outbox,
    order: Order,
    target: Status,
    actor: User | None,
    settings: RestaurantSettings,
    now: datetime,
    note: str = "",
) -> Order:
    try:
        order_flow.check_transition(order.status, target, order.type)
    except order_flow.InvalidTransition as e:
        raise OrderError(str(e), 409) from None
    order.status = target
    _record(db, order, target, actor, now, note)
    _announce(db, outbox, order, settings)

    if target in order_flow.REVIEW_TRIGGERS and settings.google_review_url:
        notify.queue(
            db,
            order,
            order_flow.REVIEW_MESSAGE,
            kind="review_prompt",
            send_at=order_flow.review_prompt_time(now, settings.review_prompt_delay_minutes),
            link=str(settings.google_review_url),
        )
    return order


def close_table_session(db, outbox, session: TableSession, settings, now) -> None:
    """Bill paid: close the tab and queue the review prompt straight away."""
    session.paid = True
    session.closed_at = now
    last = max(session.orders, key=lambda o: o.id, default=None)
    if last is not None and settings.google_review_url:
        notify.queue(db, last, order_flow.REVIEW_MESSAGE, kind="review_prompt", send_at=now, link=str(settings.google_review_url))
    outbox.add("kitchen", {"event": "table_closed", "table_session_id": session.id})


# --- Internals ---------------------------------------------------------------------------


def _record(db, order: Order, status: Status, actor: User | None, now: datetime, note: str = "") -> None:
    db.add(OrderStatusEvent(order_id=order.id, status=status, by_user_id=actor.id if actor else None, note=note, at=now))


def _announce(db, outbox: Outbox, order: Order, settings: RestaurantSettings) -> None:
    tz = ZoneInfo(settings.timezone)
    slot_label = None
    if order.slot_start:
        s = aware(order.slot_start).astimezone(tz)
        slot_label = slots.Slot(s, aware(order.slot_end).astimezone(tz), 0, 0).label
    table = order.table_session.table.number if order.table_session else None
    msg = order_flow.customer_message(
        order.status,
        order.type,
        restaurant=settings.name,
        ready_at=(arrive_by(order, settings) or ready_time(order, settings)).astimezone(tz),
        slot_label=slot_label,
        table_number=table,
        reason=order.reject_reason,
    )
    if msg:
        notify.queue(db, order, msg)
    _broadcast(outbox, order, settings)


def _broadcast(outbox: Outbox, order: Order, settings: RestaurantSettings) -> None:
    payload = {
        "event": "order_updated",
        "order_id": order.id,
        "status": order.status.value,
        "type": order.type.value,
        "ready_at": ready_time(order, settings).isoformat(),
    }
    outbox.add("kitchen", payload)
    outbox.add(f"order:{order.id}", payload)
    if order.type is OrderType.DELIVERY and order.status in {Status.READY, Status.OUT_FOR_DELIVERY}:
        outbox.add("drivers", payload)


def kitchen_orders(db: Session, now: datetime, horizon_hours: int = 48) -> list[Order]:
    """Everything the kitchen should see: live orders and pre-orders, including tomorrow's
    (customers can order tomorrow's slots late at night, so those must show up too)."""
    return list(
        db.scalars(
            select(Order).where(
                Order.status.in_(order_flow.KITCHEN_ACTIVE),
                or_(Order.slot_start.is_(None), and_(Order.slot_start < now + timedelta(hours=horizon_hours))),
            )
        ).all()
    )
