"""Dine-in table bookings: deposit up front, the rest paid at the end of the meal."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .settings import WEEKDAYS, RestaurantSettings

# Bookings in these states hold their table.
HOLDS_TABLE = {"pending", "confirmed", "seated"}


@dataclass(frozen=True)
class TableInfo:
    id: int
    number: str
    seats: int


@dataclass(frozen=True)
class Taken:
    """A table already booked from start to end."""

    table_id: int
    start: datetime
    end: datetime


def _natural(number: str):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", number)]


def free_tables(tables: Iterable[TableInfo], taken: Iterable[Taken], start: datetime, minutes: int,
                guests: int) -> list[TableInfo]:
    """Tables big enough for the party and not booked at any moment of [start, start + minutes).
    Smallest suitable table first, so big tables stay free for big groups."""
    end = start + timedelta(minutes=minutes)
    busy = {t.table_id for t in taken if start < t.end and t.start < end}
    fit = [t for t in tables if t.id not in busy and t.seats >= guests]
    return sorted(fit, key=lambda t: (t.seats, _natural(t.number)))


def booking_times(day: date, settings: RestaurantSettings, now: datetime) -> list[datetime]:
    """Bookable start times on a day: every booking_slot_minutes from opening until the last
    seating (one hour before closing), not in the past or too soon."""
    tz = ZoneInfo(settings.timezone)
    hours = settings.opening_hours[WEEKDAYS[day.weekday()]]
    if hours.closed:
        return []
    t = datetime.combine(day, hours.opens, tz)
    last = datetime.combine(day, hours.closes, tz) - timedelta(minutes=60)
    earliest = now + timedelta(minutes=settings.booking_min_lead_minutes)
    out = []
    while t <= last:
        if t >= earliest:
            out.append(t)
        t += timedelta(minutes=settings.booking_slot_minutes)
    return out


def availability(day: date, settings: RestaurantSettings, tables: list[TableInfo], taken: list[Taken],
                 guests: int, now: datetime) -> list[tuple[datetime, list[TableInfo]]]:
    """Every bookable time on the day with the tables still free for this party size."""
    return [(t, free_tables(tables, taken, t, settings.booking_duration_minutes, guests))
            for t in booking_times(day, settings, now)]


def alternatives(avail: list[tuple[datetime, list[TableInfo]]], wanted: datetime, n: int = 3) -> list[datetime]:
    """The n nearest times (before or after) that still have a free table."""
    open_times = [t for t, free in avail if free and t != wanted]
    nearest = sorted(open_times, key=lambda t: abs((t - wanted).total_seconds()))[:n]
    return sorted(nearest)


def deposit_pence(guests: int, settings: RestaurantSettings) -> int:
    if guests < 1:
        raise ValueError("a booking needs at least one guest")
    if guests > settings.booking_max_guests:
        raise ValueError(f"please call us for groups over {settings.booking_max_guests}")
    per = settings.booking_deposit_pence
    return per * guests if settings.booking_deposit_per_guest else per


def refund_on_cancel(deposit: int, booking_at: datetime, cancelled_at: datetime, settings: RestaurantSettings) -> int:
    """Full refund when cancelled early enough, otherwise the deposit is kept."""
    early_enough = booking_at - cancelled_at >= timedelta(hours=settings.booking_refund_hours)
    return deposit if early_enough else 0


def amount_due_at_end(bill_total: int, deposit_paid: int) -> int:
    """What the table pays at the end: the bill minus the deposit, never below zero."""
    return max(bill_total - deposit_paid, 0)
