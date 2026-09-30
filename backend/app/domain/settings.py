"""Restaurant settings the owner can change from the admin panel.

Every number the owner may want to adjust lives here, with the values
agreed in the plan as defaults. The admin API validates updates with this
model and stores the result as JSON in the ``restaurant_settings`` table.
"""

from __future__ import annotations

from datetime import time

from pydantic import BaseModel, Field, HttpUrl, model_validator

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


class DayHours(BaseModel):
    """Opening hours for one weekday. ``closed=True`` means shut all day."""

    opens: time = time(12, 0)
    closes: time = time(22, 30)
    closed: bool = False

    @model_validator(mode="after")
    def _opens_before_closes(self) -> DayHours:
        if not self.closed and self.opens >= self.closes:
            raise ValueError("opening time must be before closing time")
        return self


def _default_week() -> dict[str, DayHours]:
    # Agreed: every day 12:00 pm - 10:30 pm.
    return {day: DayHours() for day in WEEKDAYS}


class RestaurantSettings(BaseModel):
    # --- Restaurant ---------------------------------------------------------
    name: str = "Pure Vegi"
    address: str = "324 Soho Rd, Handsworth, Birmingham B21 9NA"
    phone: str = "0121 554 7949"
    timezone: str = "Europe/London"
    # Approximate coordinates of 324 Soho Rd; confirm with a geocoder before launch.
    latitude: float = 52.5063
    longitude: float = -1.9310
    opening_hours: dict[str, DayHours] = Field(default_factory=_default_week)

    # --- Delivery slots -----------------------------------------------------
    delivery_enabled: bool = True
    delivery_start: time = time(17, 0)  # agreed 5 pm
    delivery_end: time = time(22, 0)  # agreed 10 pm (last slot ends here)
    slot_minutes: int = Field(15, ge=5, le=120)
    drivers_on_shift: int = Field(2, ge=0, le=50)
    orders_per_driver_per_slot: int = Field(1, ge=1, le=10)
    slot_hold_minutes: int = Field(5, ge=1, le=30)  # hold while the customer pays
    min_lead_minutes: int = Field(30, ge=0, le=240)  # earliest slot = now + this
    max_days_ahead: int = Field(0, ge=0, le=14)  # 0 = today only

    # --- Delivery area and fees ----------------------------------------------
    free_radius_miles: float = Field(2.0, ge=0)
    fee_beyond_free_pence: int = Field(200, ge=0)  # agreed £2
    max_radius_miles: float = Field(5.0, gt=0)  # assumption, owner to confirm
    min_order_pence: int = Field(0, ge=0)  # owner to set

    # --- Collection ---------------------------------------------------------
    collection_enabled: bool = True

    # --- Kitchen ------------------------------------------------------------
    auto_accept: bool = False  # agreed: staff accept by default
    default_prep_minutes: int = Field(15, ge=1, le=180)
    prep_minute_choices: list[int] = Field(default_factory=lambda: [10, 15, 20, 30])
    ticket_amber_minutes: int = Field(10, ge=1)
    ticket_red_minutes: int = Field(15, ge=1)
    online_orders_paused: bool = False

    # --- Dine-in booking ------------------------------------------------------
    bookings_enabled: bool = True
    booking_deposit_pence: int = Field(0, ge=0)  # owner to set
    booking_deposit_per_guest: bool = False
    booking_refund_hours: int = Field(24, ge=0)  # full refund if cancelled this early
    booking_slot_minutes: int = Field(30, ge=15, le=120)
    booking_duration_minutes: int = Field(90, ge=30, le=300)  # how long a booking holds its table
    booking_min_lead_minutes: int = Field(30, ge=0, le=24 * 60)  # earliest booking = now + this
    booking_max_guests: int = Field(12, ge=1)

    # --- Reviews ------------------------------------------------------------
    google_review_url: HttpUrl | None = None  # "Ask for reviews" link from Google Business Profile
    review_prompt_delay_minutes: int = Field(45, ge=0, le=24 * 60)

    @model_validator(mode="after")
    def _check(self) -> RestaurantSettings:
        if self.delivery_start >= self.delivery_end:
            raise ValueError("delivery start must be before delivery end")
        if self.ticket_amber_minutes >= self.ticket_red_minutes:
            raise ValueError("amber warning must come before red")
        if self.free_radius_miles > self.max_radius_miles:
            raise ValueError("free radius cannot be larger than the delivery area")
        missing = set(WEEKDAYS) - set(self.opening_hours)
        if missing:
            raise ValueError(f"opening hours missing for: {', '.join(sorted(missing))}")
        return self

    @property
    def slot_capacity(self) -> int:
        return self.drivers_on_shift * self.orders_per_driver_per_slot
