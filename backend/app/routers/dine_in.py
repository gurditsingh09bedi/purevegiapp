"""Table bookings with deposit, and paying the table bill at the end."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, kitchen_staff, now, optional_user, settings
from ..domain import booking as rules
from ..domain.order_flow import Message, Status
from ..domain.settings import RestaurantSettings
from ..models import Booking, DiningTable, TableSession, User
from ..realtime import Outbox, get_outbox
from ..schemas import BillOut, BookingIn, BookingOut, BookingStatusIn, BookingTimeOut, FreeTable
from ..services import notify
from ..services import orders as svc
from .orders import order_out

router = APIRouter(tags=["dine-in"])


def _tables(db: Session) -> list[rules.TableInfo]:
    return [rules.TableInfo(t.id, t.number, t.seats)
            for t in db.scalars(select(DiningTable).where(DiningTable.is_active.is_(True))).all()]


def _taken(db: Session, day_start: datetime, day_end: datetime, s: RestaurantSettings,
           skip_id: int | None = None) -> list[rules.Taken]:
    rows = db.scalars(select(Booking).where(
        Booking.status.in_(rules.HOLDS_TABLE), Booking.table_id.is_not(None),
        Booking.booking_at < day_end + timedelta(hours=6), Booking.booking_at > day_start - timedelta(hours=6),
    )).all()
    out = []
    for b in rows:
        if b.id == skip_id:
            continue
        start = svc.aware(b.booking_at)
        end = svc.aware(b.ends_at) or start + timedelta(minutes=s.booking_duration_minutes)
        out.append(rules.Taken(b.table_id, start, end))
    return out


def _day_window(day: date, s: RestaurantSettings) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(), ZoneInfo(s.timezone)).astimezone(UTC)
    return start, start + timedelta(days=1)


def booking_out(b: Booking) -> BookingOut:
    out = BookingOut.model_validate(b)
    out.table_number = b.table.number if b.table else None
    return out


def _when_text(dt: datetime, s: RestaurantSettings) -> str:
    local = dt.astimezone(ZoneInfo(s.timezone))
    return local.strftime("%a %-d %b, ") + local.strftime("%-I:%M%p").lower().replace(":00", "")


@router.get("/bookings/availability", response_model=list[BookingTimeOut])
def booking_availability(day: date, guests: int = Query(2, ge=1, le=50), db: Session = Depends(get_db),
                         s: RestaurantSettings = Depends(settings), at: datetime = Depends(now)):
    """Every bookable time on a day with how many suitable tables are still free."""
    if not s.bookings_enabled:
        return []
    avail = rules.availability(day, s, _tables(db), _taken(db, *_day_window(day, s), s), guests, at)
    return [BookingTimeOut(start=t, tables_left=len(free),
                           tables=[FreeTable(id=x.id, number=x.number, seats=x.seats) for x in free[:3]])
            for t, free in avail]


@router.post("/bookings", response_model=BookingOut, status_code=201)
def create_booking(body: BookingIn, db: Session = Depends(get_db), user: User | None = Depends(optional_user),
                   s: RestaurantSettings = Depends(settings), outbox: Outbox = Depends(get_outbox),
                   at: datetime = Depends(now)):
    if not s.bookings_enabled:
        raise HTTPException(409, "online booking is closed")
    when = body.booking_at if body.booking_at.tzinfo else body.booking_at.replace(tzinfo=ZoneInfo(s.timezone))
    local_day = when.astimezone(ZoneInfo(s.timezone)).date()
    try:
        deposit = rules.deposit_pence(body.guests, s)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if when not in rules.booking_times(local_day, s, at):
        raise HTTPException(400, "please pick one of the times shown (we take bookings until an hour before closing)")

    # One booking at a time, so two people can't take the same table at the same moment.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(7202)"))
    tables = _tables(db)
    if not any(t.seats >= body.guests for t in tables):
        raise HTTPException(409, f"we don't have a table for {body.guests} online, please call us")
    avail = rules.availability(local_day, s, tables, _taken(db, *_day_window(local_day, s), s), body.guests, at)
    free = dict(avail).get(when, [])
    chosen = next((t for t in free if t.id == body.table_id), None) or (free[0] if free else None)
    if chosen is None:
        alts = rules.alternatives(avail, when)
        raise HTTPException(409, {
            "message": "Sorry, every table is booked at that time. These times are free:",
            "alternatives": [a.isoformat() for a in alts],
        })

    b = Booking(user_id=user.id if user else None, name=body.name.strip(), phone=body.phone.strip(), guests=body.guests,
                booking_at=when.astimezone(UTC), ends_at=(when + timedelta(minutes=s.booking_duration_minutes)).astimezone(UTC),
                table_id=chosen.id, deposit_pence=deposit, notes=body.notes, status="pending" if deposit else "confirmed")
    db.add(b)
    db.flush()
    who = f"Table {chosen.number} for {b.guests}, {_when_text(when, s)}. Booking #{b.id}."
    if b.status == "confirmed":
        notify.queue_booking(db, b, Message("Table booked", f"{who} See you soon at {s.name}!"))
    else:
        notify.queue_booking(db, b, Message("Booking request received", f"{who} We'll confirm shortly."))
    outbox.add("kitchen", {"event": "booking_created", "booking_id": b.id, "status": b.status})
    db.commit()
    db.refresh(b)
    return booking_out(b)


@router.get("/me/bookings", response_model=list[BookingOut])
def my_bookings(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(Booking).where(Booking.user_id == user.id).order_by(Booking.booking_at.desc()).limit(30)).all()
    return [booking_out(b) for b in rows]


@router.post("/bookings/{booking_id}/status", response_model=BookingOut)
def set_booking_status(booking_id: int, body: BookingStatusIn, db: Session = Depends(get_db),
                       _: User = Depends(kitchen_staff), s: RestaurantSettings = Depends(settings),
                       outbox: Outbox = Depends(get_outbox)):
    """Staff confirm a request, cancel it, or mark a no-show (frees the table)."""
    b = db.get(Booking, booking_id)
    if b is None:
        raise HTTPException(404, "booking not found")
    if b.status in {"cancelled", "no_show", "seated"}:
        raise HTTPException(409, f"this booking is already {b.status.replace('_', ' ')}")
    b.status = body.status
    table = f"Table {b.table.number} for {b.guests}, " if b.table else ""
    when = _when_text(svc.aware(b.booking_at), s)
    if body.status == "confirmed":
        notify.queue_booking(db, b, Message("Booking confirmed", f"{table}{when}. Booking #{b.id}. See you soon!"))
    elif body.status == "cancelled":
        text_ = f"Your booking for {when} is cancelled. Questions? Call {s.phone}."
        notify.queue_booking(db, b, Message("Booking cancelled", text_))
    outbox.add("kitchen", {"event": "booking_updated", "booking_id": b.id, "status": b.status})
    db.commit()
    return booking_out(b)


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
    return booking_out(b)


@router.post("/bookings/{booking_id}/seat", status_code=201)
def seat_booking(booking_id: int, table_id: int | None = None, db: Session = Depends(get_db),
                 _: User = Depends(kitchen_staff)):
    """Guests arrived: open their table tab linked to the booking, so the deposit comes off the bill.
    Uses the booked table unless staff move them to another one."""
    b = db.get(Booking, booking_id)
    if b is not None and table_id is None:
        table_id = b.table_id
    table = db.get(DiningTable, table_id) if table_id else None
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
    return [booking_out(b) for b in db.scalars(q).all()]
