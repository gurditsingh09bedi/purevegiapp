"""What customers can see without logging in: menu, slots, delivery quote, hours."""

from datetime import date as Date
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import now, settings
from ..domain import delivery, slots
from ..domain.settings import RestaurantSettings
from ..models import Category, MenuItem, OptionGroup
from ..schemas import CategoryOut, QuoteIn, QuoteOut, SlotOut
from ..services.orders import day_bounds, occupied_slot_starts

router = APIRouter(tags=["public"])


@router.get("/restaurant")
def restaurant(s: RestaurantSettings = Depends(settings)):
    return {
        "name": s.name,
        "address": s.address,
        "phone": s.phone,
        "opening_hours": {d: h.model_dump(mode="json") for d, h in s.opening_hours.items()},
        "delivery": {
            "enabled": s.delivery_enabled,
            "hours": [s.delivery_start.isoformat(), s.delivery_end.isoformat()],
            "free_radius_miles": s.free_radius_miles,
            "fee_beyond_free_pence": s.fee_beyond_free_pence,
            "min_order_pence": s.min_order_pence,
        },
        "online_orders_paused": s.online_orders_paused,
        "prep_minute_choices": s.prep_minute_choices,
        "ticket_minutes": {"amber": s.ticket_amber_minutes, "red": s.ticket_red_minutes},
        "bookings_enabled": s.bookings_enabled,
    }


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
