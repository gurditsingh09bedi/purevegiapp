"""Kitchen screen timing: when to start cooking, how late a ticket is, queue order."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

from .order_flow import OrderType, Status


@dataclass(frozen=True)
class TicketTiming:
    order_id: int
    order_type: OrderType
    status: Status
    created_at: datetime
    slot_start: datetime | None = None  # delivery slot, pre-orders included
    prep_minutes: int | None = None  # set when staff accept
    accepted_at: datetime | None = None
    extra_minutes: int = 0  # added when the kitchen is busy


def ready_at(t: TicketTiming, default_prep: int) -> datetime:
    """When the food should be ready.

    Slot orders must be ready at the slot start so the driver can leave on
    time; other orders are ready prep time after acceptance (or creation).
    """
    if t.slot_start is not None:
        return t.slot_start + timedelta(minutes=t.extra_minutes)
    base = t.accepted_at or t.created_at
    return base + timedelta(minutes=(t.prep_minutes or default_prep) + t.extra_minutes)


def cook_at(t: TicketTiming, default_prep: int) -> datetime:
    """When the chef should start. Pre-orders wait until slot start minus prep time."""
    return ready_at(t, default_prep) - timedelta(minutes=t.prep_minutes or default_prep)


def is_pre_order(t: TicketTiming, now: datetime, default_prep: int) -> bool:
    return t.slot_start is not None and cook_at(t, default_prep) > now


def urgency(t: TicketTiming, now: datetime, default_prep: int, amber: int, red: int) -> str:
    """``waiting`` (pre-order, not due yet), ``ok``, ``amber`` or ``red``.

    For orders being cooked, the clock counts from when cooking should have
    started; for new orders, from when the order came in.
    """
    if is_pre_order(t, now, default_prep) and t.status in {Status.PLACED, Status.ACCEPTED}:
        return "waiting"
    started = cook_at(t, default_prep) if t.status is not Status.PLACED else t.created_at
    age = (now - started).total_seconds() / 60
    if age >= red:
        return "red"
    if age >= amber:
        return "amber"
    return "ok"


def sort_queue(tickets: Iterable[TicketTiming], default_prep: int) -> list[TicketTiming]:
    """New orders needing acceptance first, then by start-cooking time (first come, first served)."""
    return sorted(
        tickets,
        key=lambda t: (t.status is not Status.PLACED, cook_at(t, default_prep), t.created_at, t.order_id),
    )
