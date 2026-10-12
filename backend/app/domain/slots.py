"""Delivery slots.

Deliveries run in fixed slots (15 minutes by default) between the delivery
start and end times. Each slot holds ``drivers_on_shift x orders_per_driver``
orders. When a slot is full it shows as booked and the customer picks another
one - first come, first served.

This module is pure Python so it can be tested without a database: callers
pass in the start times of orders (and payment holds) that already occupy
slots.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .settings import WEEKDAYS, RestaurantSettings


class SlotUnavailable(Exception):
    """The requested slot does not exist, is in the past, or is full."""


@dataclass(frozen=True)
class Slot:
    start: datetime
    end: datetime
    capacity: int
    taken: int

    @property
    def remaining(self) -> int:
        return max(self.capacity - self.taken, 0)

    @property
    def status(self) -> str:
        """``free``, ``few_left`` or ``booked`` - shown as words, not colour only."""
        if self.remaining == 0:
            return "booked"
        if self.remaining == 1 and self.capacity > 1:
            return "few_left"
        return "free"

    @property
    def label(self) -> str:
        return f"{_fmt(self.start)}–{_fmt(self.end)}"


def _fmt(dt: datetime) -> str:
    return dt.strftime("%-I:%M %p").lower().replace(":00 ", " ").replace(" ", "")


def _key(dt: datetime) -> datetime:
    """Normalise to UTC so aware datetimes from any zone compare equal."""
    if dt.tzinfo is None:
        raise ValueError("slot times must be timezone-aware")
    return dt.astimezone(ZoneInfo("UTC")).replace(second=0, microsecond=0)


def slot_times(day: date, settings: RestaurantSettings) -> list[tuple[datetime, datetime]]:
    """All delivery slots on ``day`` inside both delivery hours and opening hours."""
    tz = ZoneInfo(settings.timezone)
    hours = settings.opening_hours[WEEKDAYS[day.weekday()]]
    if hours.closed or not settings.delivery_enabled:
        return []

    window_start = datetime.combine(day, max(settings.delivery_start, hours.opens), tz)
    window_end = datetime.combine(day, min(settings.delivery_end, hours.closes), tz)
    step = timedelta(minutes=settings.slot_minutes)

    # Slots sit on a grid anchored at the delivery start (5:00, 5:15, 5:30 ...).
    cursor = datetime.combine(day, settings.delivery_start, tz)
    while cursor < window_start:
        cursor += step

    slots = []
    while cursor + step <= window_end:
        slots.append((cursor, cursor + step))
        cursor += step
    return slots


def slot_availability(
    day: date,
    settings: RestaurantSettings,
    occupied_starts: Iterable[datetime],
    now: datetime,
) -> list[Slot]:
    """Slots for ``day`` with how many places are taken.

    ``occupied_starts`` = slot start of every active delivery order plus every
    unexpired payment hold. Slots that start sooner than ``min_lead_minutes``
    from ``now`` are left out, as are all slots while online orders are paused.
    """
    if settings.online_orders_paused:
        return []
    taken = Counter(_key(s) for s in occupied_starts)
    earliest = now + timedelta(minutes=settings.min_lead_minutes)
    capacity = settings.slot_capacity
    return [
        Slot(start=s, end=e, capacity=capacity, taken=taken[_key(s)])
        for s, e in slot_times(day, settings)
        if s >= earliest
    ]


def bookable_days(settings: RestaurantSettings, now: datetime) -> list[date]:
    """Today and at least tomorrow, so late-night visitors (or anyone when we're closed) can order ahead."""
    today = now.astimezone(ZoneInfo(settings.timezone)).date()
    return [today + timedelta(days=i) for i in range(max(settings.max_days_ahead, 1) + 1)]


def collection_times(day: date, settings: RestaurantSettings, now: datetime, step: int = 15) -> list[datetime]:
    """Pick-up times for a collection order on ``day``: every 15 minutes while we're open, from
    opening + prep time until 15 minutes before closing, and never sooner than now + prep time."""
    hours = settings.opening_hours[WEEKDAYS[day.weekday()]]
    if hours.closed:
        return []
    tz = ZoneInfo(settings.timezone)
    prep = timedelta(minutes=settings.default_prep_minutes)
    t = datetime.combine(day, hours.opens, tz) + prep
    if t.minute % step:
        t += timedelta(minutes=step - t.minute % step)
    t = t.replace(second=0, microsecond=0)
    last = datetime.combine(day, hours.closes, tz) - timedelta(minutes=step)
    earliest = now + prep
    out = []
    while t <= last:
        if t >= earliest:
            out.append(t)
        t += timedelta(minutes=step)
    return out


def next_opening(settings: RestaurantSettings, now: datetime) -> datetime | None:
    """When we next open (or ``now`` if we're open). None if every day is marked closed."""
    if open_now(settings, now):
        return now
    tz = ZoneInfo(settings.timezone)
    today = now.astimezone(tz).date()
    for i in range(8):
        day = today + timedelta(days=i)
        h = settings.opening_hours[WEEKDAYS[day.weekday()]]
        opens = datetime.combine(day, h.opens, tz)
        if not h.closed and opens > now:
            return opens
    return None


def open_now(settings: RestaurantSettings, now: datetime) -> bool:
    local = now.astimezone(ZoneInfo(settings.timezone))
    h = settings.opening_hours[WEEKDAYS[local.weekday()]]
    return not h.closed and h.opens <= local.time() < h.closes


def check_slot(
    start: datetime,
    settings: RestaurantSettings,
    occupied_starts: Iterable[datetime],
    now: datetime,
) -> Slot:
    """Return the slot starting at ``start`` or raise ``SlotUnavailable``."""
    day = start.astimezone(ZoneInfo(settings.timezone)).date()
    if day not in bookable_days(settings, now):
        raise SlotUnavailable("delivery can't be booked for that day")
    for slot in slot_availability(day, settings, occupied_starts, now):
        if _key(slot.start) == _key(start):
            if slot.remaining == 0:
                raise SlotUnavailable(f"the {slot.label} slot is fully booked")
            return slot
    raise SlotUnavailable("that delivery time is not available")
