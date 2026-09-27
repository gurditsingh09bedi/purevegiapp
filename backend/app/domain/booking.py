"""Dine-in table bookings: deposit up front, the rest paid at the end of the meal."""

from __future__ import annotations

from datetime import datetime, timedelta

from .settings import RestaurantSettings


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
