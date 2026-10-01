"""Request and response bodies."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .domain.order_flow import OrderType, Status
from .models import Role


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth -------------------------------------------------------------------------


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str | None = Field(None, max_length=32)
    password: str = Field(min_length=8, max_length=200)
    marketing_opt_in: bool = False


class LoginIn(BaseModel):
    # Plain text on purpose: logging in only has to match a stored address.
    email: str = Field(max_length=254)
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role


class UserOut(ORM):
    id: int
    name: str
    email: str | None
    phone: str | None
    role: Role
    loyalty_points: int
    is_active: bool


class StaffIn(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None
    password: str = Field(min_length=8)
    role: Role


class DeviceIn(BaseModel):
    push_token: str = Field(max_length=300)
    platform: str = Field(pattern="^(android|ios|web)$")


# --- Menu -------------------------------------------------------------------------


class OptionIO(ORM):
    id: int | None = None
    name: str
    price_pence: int = Field(0, ge=0)
    is_available: bool = True


class OptionGroupIO(ORM):
    id: int | None = None
    name: str
    min_choices: int = Field(0, ge=0)
    max_choices: int = Field(1, ge=1)
    options: list[OptionIO] = []


class MenuItemIn(BaseModel):
    category_id: int
    name: str = Field(max_length=120)
    description: str = ""
    price_pence: int = Field(ge=0)
    image_url: str | None = None
    model_3d_url: str | None = None
    is_vegan: bool = False
    spice_level: int = Field(0, ge=0, le=3)
    allergens: list[str] = []
    is_available: bool = True
    sort_order: int = 0
    option_groups: list[OptionGroupIO] = []


class MenuItemOut(ORM):
    id: int
    category_id: int
    name: str
    description: str
    price_pence: int
    image_url: str | None
    model_3d_url: str | None
    is_vegan: bool
    spice_level: int
    allergens: list[str]
    is_available: bool
    sort_order: int
    option_groups: list[OptionGroupIO]


class CategoryIn(BaseModel):
    name: str = Field(max_length=80)
    sort_order: int = 0
    is_active: bool = True


class CategoryOut(ORM):
    id: int
    name: str
    sort_order: int
    is_active: bool
    items: list[MenuItemOut] = []


# --- Delivery ---------------------------------------------------------------------


class Address(BaseModel):
    line1: str = Field(max_length=200)
    line2: str = ""
    postcode: str = Field(max_length=10)
    lat: float
    lng: float
    notes: str = ""


class SlotOut(BaseModel):
    start: datetime
    end: datetime
    label: str
    status: str  # free, few_left, booked
    remaining: int


class QuoteIn(BaseModel):
    lat: float
    lng: float


class QuoteOut(BaseModel):
    distance_miles: float
    fee_pence: int
    is_free: bool


# --- Orders -----------------------------------------------------------------------


class OrderItemIn(BaseModel):
    menu_item_id: int
    quantity: int = Field(ge=1, le=50)
    option_ids: list[int] = []
    notes: str = Field("", max_length=300)


class OrderCreate(BaseModel):
    type: OrderType
    items: list[OrderItemIn] = Field(min_length=1)
    customer_name: str = Field("", max_length=120)
    customer_phone: str = Field("", max_length=32)
    notes: str = Field("", max_length=500)
    tip_pence: int = Field(0, ge=0)
    promo_code: str | None = None
    # delivery
    slot_start: datetime | None = None
    address: Address | None = None
    # dine-in: the signed token from the table's QR code
    table_token: str | None = None
    # set by the Pure Vegi app so guests get push updates for this order
    push_token: str | None = Field(None, max_length=300)

    @model_validator(mode="after")
    def _by_type(self) -> OrderCreate:
        if self.type is OrderType.DELIVERY and (self.slot_start is None or self.address is None):
            raise ValueError("delivery orders need a slot and an address")
        if self.type is OrderType.DINE_IN and not self.table_token:
            raise ValueError("dine-in orders need the table QR token")
        return self


class OrderItemOut(ORM):
    name: str
    quantity: int
    unit_price_pence: int
    options: list[dict]
    allergens: list[str]
    notes: str


class StatusEventOut(ORM):
    status: Status
    at: datetime
    note: str


class OrderOut(ORM):
    id: int
    type: OrderType
    status: Status
    customer_name: str
    customer_phone: str
    notes: str
    slot_start: datetime | None
    slot_end: datetime | None
    address: dict | None
    subtotal_pence: int
    discount_pence: int
    delivery_fee_pence: int
    tip_pence: int
    total_pence: int
    paid_at: datetime | None
    created_at: datetime
    items: list[OrderItemOut]
    events: list[StatusEventOut]
    ready_at: datetime | None = None
    table_number: str | None = None
    view_token: str | None = None  # only on the order-placed response: lets a guest track this order


class PaymentStart(BaseModel):
    client_secret: str | None
    dev_mode: bool
    amount_pence: int


class AcceptIn(BaseModel):
    prep_minutes: int | None = Field(None, ge=1, le=180)


class DelayIn(BaseModel):
    minutes: int = Field(ge=1, le=120)


class RejectIn(BaseModel):
    reason: str = Field(max_length=200)


class TicketOut(BaseModel):
    order: OrderOut
    cook_at: datetime
    ready_at: datetime
    urgency: str  # waiting, ok, amber, red
    pre_order: bool


class LocationIn(BaseModel):
    lat: float
    lng: float


# --- Bookings ---------------------------------------------------------------------


class BookingIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=10, max_length=32)
    guests: int = Field(ge=1)
    booking_at: datetime
    table_id: int | None = None  # a table the customer picked; otherwise the best free one
    notes: str = Field("", max_length=500)


class BookingOut(ORM):
    id: int
    name: str
    phone: str
    notes: str
    guests: int
    booking_at: datetime
    ends_at: datetime | None
    table_number: str | None = None
    created_at: datetime
    deposit_pence: int
    deposit_paid: bool
    refund_pence: int
    status: str
    table_id: int | None
    staff_message: str | None = None
    view_token: str | None = None  # lets a guest follow their request without an account


class FreeTable(BaseModel):
    id: int
    number: str
    seats: int


class BookingTimeOut(BaseModel):
    start: datetime
    tables_left: int
    tables: list[FreeTable]  # up to 3 best-fitting free tables


class BookingStatusIn(BaseModel):
    status: str = Field(pattern="^(confirmed|declined|cancelled|no_show)$")
    message: str = Field("", max_length=500)  # optional note to the customer, e.g. "Yes, we'll have a cake ready"


class BookingMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)


class BillOut(BaseModel):
    table_number: str
    orders: list[OrderOut]
    total_pence: int
    deposit_pence: int
    due_pence: int


class TableIn(BaseModel):
    number: str = Field(max_length=16)
    seats: int = Field(4, ge=1)


class TableOut(ORM):
    id: int
    number: str
    seats: int
    is_active: bool
    qr_url: str | None = None


# --- Offers -----------------------------------------------------------------------


class PromotionIO(ORM):
    id: int | None = None
    name: str
    code: str | None = None
    kind: str = Field(pattern="^(percent|amount|free_delivery)$")
    value: int = Field(0, ge=0)
    min_spend_pence: int = Field(0, ge=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = None
    uses: int = 0  # read-only: how many times it has been used
    is_active: bool = True
