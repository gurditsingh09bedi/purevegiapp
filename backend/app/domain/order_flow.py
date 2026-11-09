"""Order status rules and the message the customer gets at each step.

    pending_payment -> placed -> accepted -> preparing -> ready -> out_for_delivery -> delivered
                                                                -> collected   (collection)
                                                                -> served      (dine-in)
    placed -> rejected (refund);  pending_payment / placed / accepted -> cancelled

Dine-in orders are paid at the end of the meal, so they skip
``pending_payment`` and start at ``placed``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum


class OrderType(StrEnum):
    DELIVERY = "delivery"
    COLLECTION = "collection"
    DINE_IN = "dine_in"


class Status(StrEnum):
    PENDING_PAYMENT = "pending_payment"
    PLACED = "placed"
    ACCEPTED = "accepted"
    PREPARING = "preparing"
    READY = "ready"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    COLLECTED = "collected"
    SERVED = "served"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


TERMINAL = {Status.DELIVERED, Status.COLLECTED, Status.SERVED, Status.REJECTED, Status.CANCELLED}
# Orders in these states hold a delivery slot.
HOLDS_SLOT = {
    Status.PENDING_PAYMENT,
    Status.PLACED,
    Status.ACCEPTED,
    Status.PREPARING,
    Status.READY,
    Status.OUT_FOR_DELIVERY,
    Status.DELIVERED,
}
# Shown on the kitchen screen.
KITCHEN_ACTIVE = {Status.PLACED, Status.ACCEPTED, Status.PREPARING, Status.READY}

_COMMON: dict[Status, set[Status]] = {
    Status.PENDING_PAYMENT: {Status.PLACED, Status.CANCELLED},
    Status.PLACED: {Status.ACCEPTED, Status.REJECTED, Status.CANCELLED},
    Status.ACCEPTED: {Status.PREPARING, Status.CANCELLED},
    Status.PREPARING: {Status.READY},
}
_AFTER_READY = {
    OrderType.DELIVERY: {Status.READY: {Status.OUT_FOR_DELIVERY}, Status.OUT_FOR_DELIVERY: {Status.DELIVERED}},
    OrderType.COLLECTION: {Status.READY: {Status.COLLECTED}},
    OrderType.DINE_IN: {Status.READY: {Status.SERVED}},
}


class InvalidTransition(Exception):
    pass


def allowed_next(current: Status, order_type: OrderType) -> set[Status]:
    return _COMMON.get(current, set()) | _AFTER_READY[order_type].get(current, set())


def check_transition(current: Status, target: Status, order_type: OrderType) -> None:
    if target not in allowed_next(current, order_type):
        raise InvalidTransition(f"a {order_type.value} order can't go from {current.value} to {target.value}")


def initial_status(order_type: OrderType) -> Status:
    return Status.PLACED if order_type is OrderType.DINE_IN else Status.PENDING_PAYMENT


def status_after_payment(auto_accept: bool) -> Status:
    """Paid orders reach the kitchen as ``placed``; auto-accept moves them on at once."""
    return Status.ACCEPTED if auto_accept else Status.PLACED


# --- Customer messages ---------------------------------------------------------


@dataclass(frozen=True)
class Message:
    title: str
    body: str


def _clock(dt: datetime | None) -> str:
    return dt.strftime("%-I:%M %p").lower() if dt else "soon"


def customer_message(
    status: Status,
    order_type: OrderType,
    *,
    restaurant: str = "Pure Vegi",
    ready_at: datetime | None = None,
    slot_label: str | None = None,
    table_number: str | None = None,
    reason: str | None = None,
) -> Message | None:
    """The push / SMS text for a status change, or ``None`` if nothing is sent."""
    if status is Status.PLACED:
        when = f" for {slot_label}" if slot_label else ""
        return Message("Order received", f"{restaurant} has your order{when}. We'll confirm it shortly.")
    if status is Status.ACCEPTED:
        if slot_label:
            return Message(f"Accepted by {restaurant}", f"Your order is confirmed for {slot_label}.")
        if order_type is OrderType.DELIVERY:
            return Message(f"Accepted by {restaurant}", f"Your order should arrive around {_clock(ready_at)}.")
        return Message(f"Accepted by {restaurant}", f"Your order will be ready around {_clock(ready_at)}.")
    if status is Status.PREPARING:
        return Message("Cooking now", "The chef has started cooking your order.")
    if status is Status.READY:
        if order_type is OrderType.COLLECTION:
            return Message("Ready to collect", f"Your order is ready at {restaurant}.")
        if order_type is OrderType.DINE_IN:
            table = f" to table {table_number}" if table_number else ""
            return Message("On its way", f"Your food is coming{table} now.")
        return Message("Packed and ready", "Your driver is collecting your order.")
    if status is Status.OUT_FOR_DELIVERY:
        return Message("Out for delivery", "Track your driver live on the map.")
    if status is Status.DELIVERED:
        return Message("Delivered", f"Enjoy your meal! Thank you for ordering from {restaurant}.")
    if status is Status.COLLECTED:
        return Message("Enjoy!", f"Thank you for ordering from {restaurant}.")
    if status is Status.REJECTED:
        why = f" ({reason})" if reason else ""
        return Message("Sorry, we can't take this order", f"You will get a full refund{why}.")
    if status is Status.CANCELLED:
        return Message("Order cancelled", "Any payment will be refunded.")
    return None


def delay_message(new_ready_at: datetime, extra_minutes: int) -> Message:
    return Message("Running a little late", f"About {extra_minutes} minutes extra. New time: {_clock(new_ready_at)}.")


# --- Review prompt ---------------------------------------------------------------

REVIEW_TRIGGERS = {Status.DELIVERED, Status.COLLECTED}


def review_prompt_time(finished_at: datetime, delay_minutes: int) -> datetime:
    """When to show the Google review pop-up after an order finishes.

    Sent to every customer with no reward attached: Google's policy forbids
    incentives for reviews and asking only happy customers.
    """
    return finished_at + timedelta(minutes=delay_minutes)


REVIEW_MESSAGE = Message("Enjoyed your meal?", "Tap to leave us a Google review. It really helps a local restaurant.")
