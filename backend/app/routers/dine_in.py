"""Table bookings with deposit, and paying the table bill at the end."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import kitchen_staff, now, optional_user, settings
from ..domain import booking as rules
from ..domain.order_flow import Status
from ..domain.settings import WEEKDAYS, RestaurantSettings
from ..models import Booking, DiningTable, TableSession, User
from ..realtime import Outbox, get_outbox
from ..schemas import BillOut, BookingIn, BookingOut
from ..services import orders as svc
from .orders import order_out

router = APIRouter(tags=["dine-in"])


@router.post("/bookings", response_model=BookingOut, status_code=201)
def create_booking(body: BookingIn, db: Session = Depends(get_db), user: User | None = Depends(optional_user),
                   s: RestaurantSettings = Depends(settings), at: datetime = Depends(now)):
    if not s.bookings_enabled:
        raise HTTPException(409, "online booking is closed")
    when = body.booking_at if body.booking_at.tzinfo else body.booking_at.replace(tzinfo=ZoneInfo(s.timezone))
    local = when.astimezone(ZoneInfo(s.timezone))
    hours = s.opening_hours[WEEKDAYS[local.weekday()]]
    last_seating = (datetime.combine(local.date(), hours.closes, local.tzinfo) - timedelta(minutes=60)).time()
    if when <= at or hours.closed or not (hours.opens <= local.time() <= last_seating):
        raise HTTPException(400, "please pick a time when we're open (last booking an hour before closing)")
    if local.minute % s.booking_slot_minutes:
        raise HTTPException(400, f"bookings are every {s.booking_slot_minutes} minutes")
    try:
        deposit = rules.deposit_pence(body.guests, s)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    b = Booking(user_id=user.id if user else None, name=body.name, phone=body.phone, guests=body.guests,
                booking_at=when.astimezone(UTC), deposit_pence=deposit, notes=body.notes,
                status="pending" if deposit else "confirmed")
    db.add(b)
    db.commit()
    # Next step for the app: pay the deposit through Stripe (same flow as orders).
    return b


@router.post("/bookings/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(booking_id: int, db: Session = Depends(get_db), user: User | None = Depends(optional_user),
                   s: RestaurantSettings = Depends(settings), at: datetime = Depends(now)):
    b = db.get(Booking, booking_id)
    if b is None or (b.user_id and (user is None or user.id != b.user_id)):
        raise HTTPException(404, "booking not found")
    if b.status in {"cancelled", "seated", "no_show"}:
        raise HTTPException(409, f"this booking is already {b.status.replace('_', ' ')}")
    paid = b.deposit_pence if b.deposit_paid else 0
    b.refund_pence = rules.refund_on_cancel(paid, svc.aware(b.booking_at), at, s)
    b.status = "cancelled"
    db.commit()
    return b


@router.post("/bookings/{booking_id}/seat", status_code=201)
def seat_booking(booking_id: int, table_id: int, db: Session = Depends(get_db), _: User = Depends(kitchen_staff)):
    """Guests arrived: open their table tab linked to the booking, so the deposit comes off the bill."""
    b = db.get(Booking, booking_id)
    table = db.get(DiningTable, table_id)
    if b is None or table is None:
        raise HTTPException(404, "booking or table not found")
    if db.scalar(select(TableSession).where(TableSession.table_id == table_id, TableSession.closed_at.is_(None))):
        raise HTTPException(409, f"table {table.number} still has an open tab")
    ts = TableSession(table_id=table_id, booking_id=b.id)
    b.status, b.table_id = "seated", table_id
    db.add(ts)
    db.commit()
    return {"table_session_id": ts.id}


@router.get("/tables/sessions/{session_id}/bill", response_model=BillOut)
def table_bill(session_id: int, db: Session = Depends(get_db), s: RestaurantSettings = Depends(settings)):
    ts = db.get(TableSession, session_id)
    if ts is None:
        raise HTTPException(404, "table not found")
    live = [o for o in ts.orders if o.status not in {Status.REJECTED, Status.CANCELLED}]
    total = sum(o.total_pence for o in live)
    deposit = ts.booking.deposit_pence if ts.booking and ts.booking.deposit_paid else 0
    return BillOut(table_number=ts.table.number, orders=[order_out(o, s) for o in live], total_pence=total,
                   deposit_pence=deposit, due_pence=rules.amount_due_at_end(total, deposit))


@router.post("/tables/sessions/{session_id}/paid", status_code=204)
def table_paid(session_id: int, db: Session = Depends(get_db), _: User = Depends(kitchen_staff),
               s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox),
               at: datetime = Depends(now)):
    """Staff confirm the bill is paid (card terminal or cash); closes the tab, sends the review prompt."""
    ts = db.get(TableSession, session_id)
    if ts is None or ts.closed_at is not None:
        raise HTTPException(404, "open table not found")
    for o in ts.orders:
        if o.paid_at is None and o.status not in {Status.REJECTED, Status.CANCELLED}:
            o.paid_at = at
    svc.close_table_session(db, outbox, ts, s, at)
    db.commit()


@router.get("/bookings", response_model=list[BookingOut])
def list_bookings(day: date | None = None, db: Session = Depends(get_db), _: User = Depends(kitchen_staff),
                  s: RestaurantSettings = Depends(settings)):
    q = select(Booking).where(Booking.status != "cancelled").order_by(Booking.booking_at)
    if day:
        start = datetime.combine(day, time(), ZoneInfo(s.timezone)).astimezone(UTC)
        q = q.where(Booking.booking_at >= start, Booking.booking_at < start + timedelta(days=1))
    return db.scalars(q).all()
