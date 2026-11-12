"""Kitchen screen and driver app actions."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..db import get_db
from ..deps import config, drivers, kitchen_staff, now, settings
from ..domain import kitchen
from ..domain.order_flow import OrderType, Status
from ..domain.settings import RestaurantSettings
from ..models import DriverLocation, Order, TableSession, User
from ..realtime import Outbox, get_outbox
from ..schemas import (
    AcceptIn,
    BusyTimeIn,
    DelayIn,
    LocationIn,
    OrderOut,
    RejectIn,
    TablePaidIn,
    TableTabOut,
    TicketOut,
    TillOrderIn,
)
from ..services import orders as svc
from ..services.settings_store import save_settings
from .orders import order_out

router = APIRouter(tags=["staff"])


def _get(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "order not found")
    return order


def _run(db: Session, fn, *args) -> None:
    try:
        fn(*args)
    except svc.OrderError as e:
        db.rollback()
        raise HTTPException(e.status_code, str(e)) from None
    db.commit()


# --- Kitchen -------------------------------------------------------------------------


@router.get("/kitchen/queue", response_model=list[TicketOut])
def kitchen_queue(
    db: Session = Depends(get_db),
    _: User = Depends(kitchen_staff),
    s: RestaurantSettings = Depends(settings),
    at: datetime = Depends(now),
):
    """New orders needing acceptance first, then by when to start cooking."""
    orders = {o.id: o for o in svc.kitchen_orders(db, at)}
    prep = s.default_prep_minutes
    queue = kitchen.sort_queue([svc.timing(o) for o in orders.values()], prep)
    return [
        TicketOut(
            order=order_out(orders[t.order_id], s),
            cook_at=kitchen.cook_at(t, prep),
            ready_at=kitchen.ready_at(t, prep),
            urgency=kitchen.urgency(t, at, prep, s.ticket_amber_minutes, s.ticket_red_minutes),
            pre_order=kitchen.is_pre_order(t, at, prep),
        )
        for t in queue
    ]


@router.post("/kitchen/orders/{order_id}/accept", response_model=OrderOut)
def accept(order_id: int, body: AcceptIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
           s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    _run(db, svc.accept, db, outbox, order, body.prep_minutes, s, at, user, body.extra_minutes)
    return order_out(order, s)


@router.post("/kitchen/orders/{order_id}/reject", response_model=OrderOut)
def reject(order_id: int, body: RejectIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
           s=Depends(settings), cfg: AppConfig = Depends(config), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    _run(db, svc.reject, db, outbox, order, body.reason, s, cfg, at, user)
    return order_out(order, s)


@router.post("/kitchen/orders/{order_id}/delay", response_model=OrderOut)
def delay(order_id: int, body: DelayIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
          s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    _run(db, svc.delay, db, outbox, order, body.minutes, s, at, user)
    return order_out(order, s)


@router.post("/kitchen/orders/{order_id}/start", response_model=OrderOut)
def start_cooking(order_id: int, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
                  s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    _run(db, svc.move, db, outbox, order, Status.PREPARING, user, s, at)
    return order_out(order, s)


@router.post("/kitchen/orders/{order_id}/ready", response_model=OrderOut)
def ready(order_id: int, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
          s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    _run(db, svc.move, db, outbox, order, Status.READY, user, s, at)
    return order_out(order, s)


@router.post("/kitchen/orders/{order_id}/handed-over", response_model=OrderOut)
def handed_over(order_id: int, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
                s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    """Collection picked up at the counter, or dine-in food served at the table."""
    order = _get(db, order_id)
    target = {OrderType.COLLECTION: Status.COLLECTED, OrderType.DINE_IN: Status.SERVED}.get(order.type)
    if target is None:
        raise HTTPException(409, "delivery orders are handed to a driver")
    _run(db, svc.move, db, outbox, order, target, user, s, at)
    return order_out(order, s)


@router.post("/kitchen/pause")
def pause_online_orders(paused: bool, db: Session = Depends(get_db), _: User = Depends(kitchen_staff),
                        s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox)):
    """Busy button: stop new online orders (and hide slots) until switched back."""
    s.online_orders_paused = paused
    save_settings(db, s)
    db.commit()
    outbox.add("kitchen", {"event": "online_orders_paused", "paused": paused})
    return {"online_orders_paused": paused}


@router.post("/kitchen/busy-time")
def busy_time(body: BusyTimeIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
              s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    """Busy night: add minutes to the delivery time customers are quoted (e.g. 45 -> 60 min).
    With tell_customers, people already waiting get the extra minutes and a text too."""
    told = svc.set_busy_time(db, outbox, s, body.extra_minutes, body.tell_customers, at, user)
    db.commit()
    return {"busy_extra_minutes": s.busy_extra_minutes, "delivery_minutes": svc.quoted_delivery_minutes(s),
            "customers_told": told}


# --- Till (front counter) -----------------------------------------------------------


@router.post("/till/orders", response_model=OrderOut, status_code=201)
def till_order(body: TillOrderIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
               s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    """Counter sale: the money is taken first (card machine or cash), then the sale is completed here
    and goes to the kitchen."""
    try:
        order = svc.create_till_order(db, outbox, body, user, s, at)
    except svc.OrderError as e:
        db.rollback()
        raise HTTPException(e.status_code, str(e)) from None
    db.commit()
    return order_out(order, s)


@router.get("/till/waiting", response_model=list[OrderOut])
def waiting_to_pay(db: Session = Depends(get_db), _: User = Depends(kitchen_staff), s: RestaurantSettings = Depends(settings),
                   at=Depends(now)):
    """Table orders whose guests chose "pay at the till" and haven't paid yet (last 3 hours)."""
    rows = db.scalars(select(Order).where(Order.status == Status.PENDING_PAYMENT, Order.pay_code.is_not(None),
                                          Order.created_at >= at - timedelta(hours=3)).order_by(Order.id.desc())).all()
    return [_with_code(o, s) for o in rows]


def _with_code(o: Order, s: RestaurantSettings) -> OrderOut:
    out = order_out(o, s)
    out.pay_code = o.pay_code
    return out


@router.get("/till/pay-code/{code}", response_model=OrderOut)
def order_by_pay_code(code: str, db: Session = Depends(get_db), _: User = Depends(kitchen_staff),
                      s: RestaurantSettings = Depends(settings)):
    """The cashier types (or scans) the guest's 4-digit code and sees the order and total."""
    order = svc.find_by_pay_code(db, code)
    if order is None:
        raise HTTPException(404, "no unpaid order with that code")
    return _with_code(order, s)


@router.post("/till/pay-code/{code}/paid", response_model=OrderOut)
def paid_by_pay_code(code: str, body: TablePaidIn, db: Session = Depends(get_db), user: User = Depends(kitchen_staff),
                     s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    """Card (on the card machine) or cash taken: the order is paid and goes to the kitchen."""
    order = svc.find_by_pay_code(db, code)
    if order is None:
        raise HTTPException(404, "no unpaid order with that code")
    _run(db, svc.pay_at_till, db, outbox, order, body.payment_method, s, at, user)
    return _with_code(order, s)


@router.get("/till/tables", response_model=list[TableTabOut])
def open_tables(db: Session = Depends(get_db), _: User = Depends(kitchen_staff)):
    """Tables with an open tab, for taking payment at the till. Tables that asked to pay at the till first."""
    out = []
    for ts in db.scalars(select(TableSession).where(TableSession.closed_at.is_(None))).all():
        live = [o for o in ts.orders if o.status not in {Status.REJECTED, Status.CANCELLED}]
        if not live:
            continue
        total = sum(o.total_pence for o in live)
        unpaid = sum(o.total_pence for o in live if o.paid_at is None)
        deposit = ts.booking.deposit_pence if ts.booking and ts.booking.deposit_paid else 0
        out.append(TableTabOut(table_session_id=ts.id, table_number=ts.table.number, orders=len(live),
                               total_pence=total, due_pence=max(0, unpaid - deposit),
                               pay_at_till=ts.pay_at_till_at is not None,
                               opened_at=min(svc.aware(o.created_at) for o in live)))
    return sorted(out, key=lambda t: (not t.pay_at_till, t.opened_at or datetime.min.replace(tzinfo=UTC)))


# --- Drivers -------------------------------------------------------------------------


@router.get("/driver/orders", response_model=list[OrderOut])
def driver_orders(db: Session = Depends(get_db), user: User = Depends(drivers), s=Depends(settings)):
    """Ready deliveries waiting for a driver, plus this driver's current ones, in slot order."""
    rows = db.scalars(
        select(Order)
        .where(
            Order.type == OrderType.DELIVERY,
            ((Order.status == Status.READY) & Order.driver_id.is_(None))
            | ((Order.driver_id == user.id) & Order.status.in_([Status.READY, Status.OUT_FOR_DELIVERY])),
        )
        .order_by(Order.slot_start, Order.id)
    ).all()
    return [order_out(o, s) for o in rows]


@router.post("/driver/orders/{order_id}/picked-up", response_model=OrderOut)
def picked_up(order_id: int, db: Session = Depends(get_db), user: User = Depends(drivers),
              s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    if order.driver_id not in (None, user.id):
        raise HTTPException(409, "another driver has this order")
    order.driver_id = user.id
    _run(db, svc.move, db, outbox, order, Status.OUT_FOR_DELIVERY, user, s, at)
    return order_out(order, s)


@router.post("/driver/orders/{order_id}/delivered", response_model=OrderOut)
def delivered(order_id: int, db: Session = Depends(get_db), user: User = Depends(drivers),
              s=Depends(settings), outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    order = _get(db, order_id)
    if order.driver_id != user.id:
        raise HTTPException(403, "this isn't your delivery")
    _run(db, svc.move, db, outbox, order, Status.DELIVERED, user, s, at)
    return order_out(order, s)


@router.post("/driver/location", status_code=204)
def driver_location(body: LocationIn, db: Session = Depends(get_db), user: User = Depends(drivers),
                    outbox: Outbox = Depends(get_outbox), at=Depends(now)):
    """Sent every 5-10 seconds while out; forwarded to that driver's customers' maps."""
    db.add(DriverLocation(driver_id=user.id, lat=body.lat, lng=body.lng, at=at))
    active = db.scalars(
        select(Order.id).where(Order.driver_id == user.id, Order.status == Status.OUT_FOR_DELIVERY)
    ).all()
    db.commit()
    for oid in active:
        outbox.add(f"order:{oid}", {"event": "driver_location", "lat": body.lat, "lng": body.lng, "at": at.isoformat()})
