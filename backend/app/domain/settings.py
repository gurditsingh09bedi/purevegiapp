"""Restaurant settings the owner can change from the admin panel.

Every number the owner may want to adjust lives here, with the values
agreed in the plan as defaults. The admin API validates updates with this
model and stores the result as JSON in the ``restaurant_settings`` table.
"""

from __future__ import annotations

from datetime import date, time

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


def _default_delivery_week() -> dict[str, DayHours]:
    # Agreed Nov 2026: Monday-Thursday 6pm-10pm, Friday-Sunday 5pm-10pm.
    return {day: DayHours(opens=time(17 if day in ("friday", "saturday", "sunday") else 18), closes=time(22))
            for day in WEEKDAYS}


def _default_week() -> dict[str, DayHours]:
    # Agreed: every day 12:00 pm - 10:30 pm.
    return {day: DayHours() for day in WEEKDAYS}


class ReviewQuote(BaseModel):
    """A real customer review, copied from Google by staff, shown on the home page."""

    name: str = Field(min_length=1, max_length=60)
    rating: int = Field(5, ge=1, le=5)
    text: str = Field(min_length=1, max_length=400)
    when: str = Field("", max_length=40)  # e.g. "2 weeks ago", as Google shows it


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

    # --- Delivery -----------------------------------------------------------
    # Delivery hours per weekday (delivery_hours; a day can be marked closed). Mon-Thu 6-10pm, Fri-Sun 5-10pm.
    # Orders are "as soon as possible": the customer is told about delivery_minutes (45), plus
    # busy_extra_minutes when the kitchen turns up the time on a busy night.
    delivery_enabled: bool = True
    delivery_hours: dict[str, DayHours] = Field(default_factory=_default_delivery_week)
    delivery_minutes: int = Field(45, ge=10, le=180)
    busy_extra_minutes: int = Field(0, ge=0, le=180)
    delay_choices: list[int] = Field(default_factory=lambda: [5, 10, 15, 20, 30])
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
    # Busy meter on the website: how many orders on the go count as "busy" / "very busy".
    busy_orders: int = Field(4, ge=1, le=100)
    very_busy_orders: int = Field(8, ge=2, le=200)
    minutes_per_extra_order: int = Field(3, ge=0, le=30)

    # --- Today's special (shown on the home page on that day only) ------------
    special_item_id: int | None = None
    special_note: str = Field("", max_length=160)
    special_day: date | None = None

    # --- Dine-in booking ------------------------------------------------------
    bookings_enabled: bool = False  # agreed Nov 2026: no table booking for now
    booking_auto_confirm: bool = False  # agreed: staff accept or decline each request
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
    reviews: list[ReviewQuote] = Field(default_factory=list, max_length=12)
    google_rating: float | None = Field(None, ge=1, le=5)  # e.g. 4.8, as shown on Google
    google_review_count: int | None = Field(None, ge=0)

    # One-off data changes already applied to this database (see app/upgrades.py).
    applied_upgrades: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> RestaurantSettings:
        missing_delivery = set(WEEKDAYS) - set(self.delivery_hours)
        if missing_delivery:
            raise ValueError(f"delivery hours missing for: {', '.join(sorted(missing_delivery))}")
        if self.delivery_start >= self.delivery_end:
            raise ValueError("delivery start must be before delivery end")
        if self.ticket_amber_minutes >= self.ticket_red_minutes:
            raise ValueError("amber warning must come before red")
        if self.busy_orders >= self.very_busy_orders:
            raise ValueError("'very busy' must be more orders than 'busy'")
        if self.free_radius_miles > self.max_radius_miles:
            raise ValueError("free radius cannot be larger than the delivery area")
        missing = set(WEEKDAYS) - set(self.opening_hours)
        if missing:
            raise ValueError(f"opening hours missing for: {', '.join(sorted(missing))}")
        return self

    @property
    def slot_capacity(self) -> int:
        return self.drivers_on_shift * self.orders_per_driver_per_slot
