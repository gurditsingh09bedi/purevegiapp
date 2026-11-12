"""What customers can see without logging in: menu, slots, delivery quote, hours."""

from datetime import date as Date
from datetime import timedelta
from zoneinfo import ZoneInfo

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import AppConfig
from ..db import get_db
from ..deps import config, now, settings
from ..domain import delivery, kitchen, slots
from ..domain.order_flow import Status
from ..domain.settings import WEEKDAYS, RestaurantSettings
from ..models import Category, DiningTable, MenuItem, OptionGroup, Order
from ..schemas import CategoryOut, QuoteIn, QuoteOut, SlotOut
from ..security import decode_token
from ..services import orders as svc
from ..services.orders import day_bounds, occupied_slot_starts

router = APIRouter(tags=["public"])


def _busy(db: Session, s: RestaurantSettings, at) -> dict:
    """Orders the kitchen has on: accepted or waiting, and not a pre-order for later than an hour."""
    on = db.scalar(
        select(func.count(Order.id)).where(
            Order.status.in_([Status.PLACED, Status.ACCEPTED, Status.PREPARING]),
            or_(Order.slot_start.is_(None), Order.slot_start <= at + timedelta(hours=1)),
        )
    ) or 0
    load = kitchen.kitchen_load(on, s.default_prep_minutes, s.busy_orders, s.very_busy_orders, s.minutes_per_extra_order)
    return {"level": load.level, "orders": load.orders, "wait_minutes": load.wait_minutes + s.busy_extra_minutes,
            "delivery_minutes": svc.quoted_delivery_minutes(s), "busy_extra_minutes": s.busy_extra_minutes,
            "paused": s.online_orders_paused, "open_now": slots.open_now(s, at),
            "delivery_open": slots.delivery_open(s, at)}


def _special(db: Session, s: RestaurantSettings, at) -> dict | None:
    if not s.special_item_id or s.special_day != at.astimezone(ZoneInfo(s.timezone)).date():
        return None
    item = db.get(MenuItem, s.special_item_id)
    if item is None or not item.is_available or not item.category.is_active:
        return None
    return {"item_id": item.id, "note": s.special_note}


def _today_delivery_hours(s: RestaurantSettings, at) -> list[str] | None:
    h = s.delivery_hours[WEEKDAYS[at.astimezone(ZoneInfo(s.timezone)).weekday()]]
    return None if h.closed else [h.opens.isoformat(), h.closes.isoformat()]


@router.get("/restaurant/busy")
def busy(db: Session = Depends(get_db), s: RestaurantSettings = Depends(settings), at=Depends(now)):
    """The busy meter: how busy the kitchen is now and roughly how long a new order takes."""
    return _busy(db, s, at)


@router.get("/restaurant")
def restaurant(db: Session = Depends(get_db), s: RestaurantSettings = Depends(settings), at=Depends(now)):
    nxt = slots.next_opening(s, at)
    nxt_delivery = slots.next_delivery_open(s, at)
    return {
        "busy": _busy(db, s, at),
        "special": _special(db, s, at),
        "reviews": [r.model_dump() for r in s.reviews],
        "google_rating": s.google_rating,
        "google_review_count": s.google_review_count,
        "open_now": slots.open_now(s, at),
        "next_open": nxt.isoformat() if nxt else None,  # when closed: the next opening time
        "name": s.name,
        "address": s.address,
        "phone": s.phone,
        "opening_hours": {d: h.model_dump(mode="json") for d, h in s.opening_hours.items()},
        "delivery": {
            "enabled": s.delivery_enabled,
            "hours": _today_delivery_hours(s, at),
            "days": [d for d in WEEKDAYS if not s.delivery_hours[d].closed],
            "week": {d: h.model_dump(mode="json") for d, h in s.delivery_hours.items()},
            "summary": slots.delivery_summary(s),
            "open_now": slots.delivery_open(s, at),
            "next_open": nxt_delivery.isoformat() if nxt_delivery else None,
            "minutes": svc.quoted_delivery_minutes(s),
            "hours_text": svc.delivery_hours_text(s, at),
            "free_radius_miles": s.free_radius_miles,
            "fee_beyond_free_pence": s.fee_beyond_free_pence,
            "min_order_pence": s.min_order_pence,
        },
        "online_orders_paused": s.online_orders_paused,
        "prep_minute_choices": s.prep_minute_choices,
        "default_prep_minutes": s.default_prep_minutes,
        "ticket_minutes": {"amber": s.ticket_amber_minutes, "red": s.ticket_red_minutes},
        "bookings_enabled": s.bookings_enabled,
        "booking_deposit_pence": s.booking_deposit_pence,
        "booking_deposit_per_guest": s.booking_deposit_per_guest,
        "booking_slot_minutes": s.booking_slot_minutes,
        "collection_enabled": s.collection_enabled,
        "delay_choices": s.delay_choices,
        "google_review_url": str(s.google_review_url) if s.google_review_url else None,
        "timezone": s.timezone,
    }


@router.get("/collection/times")
def collection_times(day: Date | None = Query(None, description="YYYY-MM-DD in UK time; defaults to today"),
                     s: RestaurantSettings = Depends(settings), at=Depends(now)):
    """Pick-up times for collection orders (today or tomorrow), so people can order ahead while we're closed."""
    day = day or at.astimezone(ZoneInfo(s.timezone)).date()
    if day not in slots.bookable_days(s, at):
        raise HTTPException(400, "collection can't be booked for that day")
    return [{"start": t.isoformat(), "label": t.strftime("%-I:%M%p").lower().replace(":00", "")}
            for t in slots.collection_times(day, s, at)]


@router.get("/tables/qr/{token}")
def table_from_qr(token: str, db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    """The QR page asks which table it is on, so guests see "Table 7" before ordering."""
    try:
        table_id = int(decode_token(token, cfg.jwt_secret, kind="table")["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(404, "this table code isn't valid - please ask a member of staff") from None
    table = db.get(DiningTable, table_id)
    if table is None or not table.is_active:
        raise HTTPException(404, "this table isn't taking orders")
    return {"table_number": table.number, "seats": table.seats}


@router.get("/menu", response_model=list[CategoryOut])
def menu(db: Session = Depends(get_db)):
    cats = db.scalars(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort_order, Category.id)
        .options(
            selectinload(Category.items)
            .selectinload(MenuItem.option_groups)
            .selectinload(OptionGroup.options)
        )
    ).all()
    # Sold-out dishes stay visible but greyed out, so customers know they exist.
    return cats


@router.get("/delivery/slots", response_model=list[SlotOut])
def delivery_slots(
    day: Date | None = Query(None, description="YYYY-MM-DD in UK time; defaults to today"),
    db: Session = Depends(get_db),
    s: RestaurantSettings = Depends(settings),
    at=Depends(now),
):
    day = day or at.astimezone(ZoneInfo(s.timezone)).date()
    if day not in slots.bookable_days(s, at):
        raise HTTPException(400, "delivery can't be booked for that day")
    taken = occupied_slot_starts(db, *day_bounds(day, s), at)
    return [
        SlotOut(start=x.start, end=x.end, label=x.label, status=x.status, remaining=x.remaining)
        for x in slots.slot_availability(day, s, taken, at)
    ]


@router.post("/delivery/quote", response_model=QuoteOut)
def delivery_quote(body: QuoteIn, s: RestaurantSettings = Depends(settings)):
    try:
        q = delivery.quote(body.lat, body.lng, s)
    except delivery.OutsideDeliveryArea as e:
        raise HTTPException(400, str(e)) from None
    return QuoteOut(distance_miles=q.distance_miles, fee_pence=q.fee_pence, is_free=q.is_free)
