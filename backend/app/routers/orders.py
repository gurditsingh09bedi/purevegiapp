"""Customer ordering, payment and tracking."""

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..db import get_db
from ..deps import config, current_user, now, optional_user, require, settings
from ..domain.order_flow import Status
from ..domain.settings import RestaurantSettings
from ..models import STAFF_ROLES, Order, Role, User, utcnow
from ..realtime import Outbox, get_outbox
from ..schemas import OrderCreate, OrderOut, PaymentStart
from ..services import orders as svc
from ..services import payments

router = APIRouter(tags=["orders"])


def order_out(order: Order, s: RestaurantSettings) -> OrderOut:
    out = OrderOut.model_validate(order)
    out.ready_at = svc.ready_time(order, s)
    out.table_number = order.table_session.table.number if order.table_session else None
    return out


def _can_view(order: Order, user: User | None, guest_phone: str | None) -> bool:
    if user and (user.role in STAFF_ROLES or order.user_id == user.id):
        return True
    # Guests track with their phone number (sent as a header by the website).
    return order.user_id is None and bool(guest_phone) and guest_phone == order.customer_phone


@router.post("/orders", response_model=OrderOut, status_code=201)
def place_order(
    body: OrderCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    s: RestaurantSettings = Depends(settings),
    cfg: AppConfig = Depends(config),
    outbox: Outbox = Depends(get_outbox),
    at: datetime = Depends(now),
):
    try:
        order = svc.create_order(db, outbox, body, user, s, cfg, at)
    except svc.OrderError as e:
        db.rollback()
        raise HTTPException(e.status_code, str(e)) from None
    db.commit()
    return order_out(order, s)


@router.post("/orders/{order_id}/pay", response_model=PaymentStart)
def start_payment(
    order_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    cfg: AppConfig = Depends(config),
    x_guest_phone: str | None = Header(None),
):
    order = db.get(Order, order_id)
    if order is None or not _can_view(order, user, x_guest_phone):
        raise HTTPException(404, "order not found")
    if order.status is not Status.PENDING_PAYMENT:
        raise HTTPException(409, "this order doesn't need paying now")
    try:
        result = payments.create_intent(order, cfg)
    except payments.PaymentsNotConfigured as e:
        raise HTTPException(503, str(e)) from None
    db.commit()
    return result


@router.post("/orders/{order_id}/dev-pay", response_model=OrderOut)
def dev_pay(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require(Role.MANAGER)),
    s: RestaurantSettings = Depends(settings),
    cfg: AppConfig = Depends(config),
    outbox: Outbox = Depends(get_outbox),
    at: datetime = Depends(now),
):
    """Testing only: mark an order paid without Stripe. Disabled in production."""
    if not cfg.dev_payments:
        raise HTTPException(404)
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "order not found")
    svc.mark_paid(db, outbox, order, s, at)
    db.commit()
    return order_out(order, s)


@router.post("/payments/stripe-webhook", include_in_schema=False)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    s: RestaurantSettings = Depends(settings),
    cfg: AppConfig = Depends(config),
    outbox: Outbox = Depends(get_outbox),
    stripe_signature: str = Header(...),
):
    try:
        event = payments.parse_webhook(await request.body(), stripe_signature, cfg)
    except Exception:
        raise HTTPException(400, "invalid webhook") from None
    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        order = db.scalar(select(Order).where(Order.stripe_payment_intent_id == intent["id"]))
        if order is not None:
            svc.mark_paid(db, outbox, order, s, utcnow())
            db.commit()
    return {"received": True}


@router.get("/orders/{order_id}", response_model=OrderOut)
def track_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    s: RestaurantSettings = Depends(settings),
    x_guest_phone: str | None = Header(None),
):
    order = db.get(Order, order_id)
    if order is None or not _can_view(order, user, x_guest_phone):
        raise HTTPException(404, "order not found")
    return order_out(order, s)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    s: RestaurantSettings = Depends(settings),
    cfg: AppConfig = Depends(config),
    outbox: Outbox = Depends(get_outbox),
    at: datetime = Depends(now),
):
    """Customers can cancel until the kitchen accepts; staff until cooking starts."""
    order = db.get(Order, order_id)
    if order is None or not _can_view(order, user, None):
        raise HTTPException(404, "order not found")
    if user.role not in STAFF_ROLES and order.status not in {Status.PENDING_PAYMENT, Status.PLACED}:
        raise HTTPException(409, "the kitchen has accepted this order - please call us")
    try:
        svc.move(db, outbox, order, Status.CANCELLED, user, s, at)
    except svc.OrderError as e:
        raise HTTPException(e.status_code, str(e)) from None
    payments.refund(order, cfg)
    db.commit()
    return order_out(order, s)


@router.get("/me/orders", response_model=list[OrderOut])
def my_orders(db: Session = Depends(get_db), user: User = Depends(current_user), s: RestaurantSettings = Depends(settings)):
    rows = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.id.desc()).limit(50)).all()
    return [order_out(o, s) for o in rows]
