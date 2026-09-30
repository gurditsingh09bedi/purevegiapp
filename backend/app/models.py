"""Database tables. Money is stored in pence; times are stored in UTC."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .domain.order_flow import OrderType, Status


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(StrEnum):
    CUSTOMER = "customer"
    OWNER = "owner"
    MANAGER = "manager"
    KITCHEN = "kitchen"
    WAITER = "waiter"
    DRIVER = "driver"


STAFF_ROLES = {Role.OWNER, Role.MANAGER, Role.KITCHEN, Role.WAITER, Role.DRIVER}
ADMIN_ROLES = {Role.OWNER, Role.MANAGER}


class TS:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(TS, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False), default=Role.CUSTOMER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    marketing_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    dietary_tags: Mapped[list] = mapped_column(JSON, default=list)
    loyalty_points: Mapped[int] = mapped_column(Integer, default=0)


class RestaurantSettingsRow(Base):
    """Single row holding the owner-editable settings as JSON."""

    __tablename__ = "restaurant_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# --- Menu ------------------------------------------------------------------------


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    items: Mapped[list[MenuItem]] = relationship(back_populates="category", order_by="MenuItem.sort_order")


class MenuItem(Base):
    __tablename__ = "menu_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    price_pence: Mapped[int] = mapped_column(Integer)
    image_url: Mapped[str | None] = mapped_column(String(500))
    model_3d_url: Mapped[str | None] = mapped_column(String(500))
    is_vegan: Mapped[bool] = mapped_column(Boolean, default=False)
    spice_level: Mapped[int] = mapped_column(Integer, default=0)
    allergens: Mapped[list] = mapped_column(JSON, default=list)  # UK 14 allergen names
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)  # false = "86" / sold out
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    category: Mapped[Category] = relationship(back_populates="items")
    option_groups: Mapped[list[OptionGroup]] = relationship(back_populates="item", cascade="all, delete-orphan")


class OptionGroup(Base):
    """E.g. "Size" (choose 1) or "Add-ons" (choose up to 3)."""

    __tablename__ = "option_groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    name: Mapped[str] = mapped_column(String(80))
    min_choices: Mapped[int] = mapped_column(Integer, default=0)
    max_choices: Mapped[int] = mapped_column(Integer, default=1)
    item: Mapped[MenuItem] = relationship(back_populates="option_groups")
    options: Mapped[list[Option]] = relationship(back_populates="group", cascade="all, delete-orphan")


class Option(Base):
    __tablename__ = "options"
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("option_groups.id"))
    name: Mapped[str] = mapped_column(String(80))
    price_pence: Mapped[int] = mapped_column(Integer, default=0)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    group: Mapped[OptionGroup] = relationship(back_populates="options")


# --- Tables and bookings -----------------------------------------------------------


class DiningTable(Base):
    __tablename__ = "dining_tables"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(16), unique=True)
    seats: Mapped[int] = mapped_column(Integer, default=4)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Booking(TS, Base):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32))
    guests: Mapped[int] = mapped_column(Integer)
    booking_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    table_id: Mapped[int | None] = mapped_column(ForeignKey("dining_tables.id"))
    deposit_pence: Mapped[int] = mapped_column(Integer, default=0)
    deposit_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    refund_pence: Mapped[int] = mapped_column(Integer, default=0)  # due back after a cancellation
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, confirmed, seated, cancelled, no_show
    notes: Mapped[str] = mapped_column(Text, default="")
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # table is held until then
    table: Mapped[DiningTable | None] = relationship()


class TableSession(TS, Base):
    """One sitting at a table: every round ordered goes on this tab."""

    __tablename__ = "table_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("dining_tables.id"), index=True)
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    table: Mapped[DiningTable] = relationship()
    booking: Mapped[Booking | None] = relationship()
    orders: Mapped[list[Order]] = relationship(back_populates="table_session")


# --- Orders ------------------------------------------------------------------------


class Order(TS, Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_slot_status", "slot_start", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[OrderType] = mapped_column(Enum(OrderType, native_enum=False))
    status: Mapped[Status] = mapped_column(Enum(Status, native_enum=False), index=True)
    customer_name: Mapped[str] = mapped_column(String(120), default="")
    customer_phone: Mapped[str] = mapped_column(String(32), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    push_token: Mapped[str | None] = mapped_column(String(300))  # the app's push token, for guests without an account

    # Delivery
    slot_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    slot_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    address: Mapped[dict | None] = mapped_column(JSON)  # line1, line2, postcode, lat, lng, notes
    distance_miles: Mapped[float | None] = mapped_column(Float)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # Dine-in
    table_session_id: Mapped[int | None] = mapped_column(ForeignKey("table_sessions.id"), index=True)

    # Kitchen timing
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    prep_minutes: Mapped[int | None] = mapped_column(Integer)
    extra_minutes: Mapped[int] = mapped_column(Integer, default=0)
    reject_reason: Mapped[str | None] = mapped_column(String(200))

    # Money (pence)
    subtotal_pence: Mapped[int] = mapped_column(Integer, default=0)
    discount_pence: Mapped[int] = mapped_column(Integer, default=0)
    delivery_fee_pence: Mapped[int] = mapped_column(Integer, default=0)
    tip_pence: Mapped[int] = mapped_column(Integer, default=0)
    total_pence: Mapped[int] = mapped_column(Integer, default=0)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(100), unique=True)

    items: Mapped[list[OrderItem]] = relationship(back_populates="order", cascade="all, delete-orphan")
    events: Mapped[list[OrderStatusEvent]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderStatusEvent.id"
    )
    table_session: Mapped[TableSession | None] = relationship(back_populates="orders")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    menu_item_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    name: Mapped[str] = mapped_column(String(120))  # copied at order time
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_pence: Mapped[int] = mapped_column(Integer)  # dish + options, copied at order time
    options: Mapped[list] = mapped_column(JSON, default=list)  # [{"name", "price_pence"}]
    allergens: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    order: Mapped[Order] = relationship(back_populates="items")


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    status: Mapped[Status] = mapped_column(Enum(Status, native_enum=False))
    by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(String(200), default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    order: Mapped[Order] = relationship(back_populates="events")


class Notification(TS, Base):
    """Every message to a customer or staff member; the worker sends those that are due."""

    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), index=True)
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))  # status, delay, review_prompt, staff_alert
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500))
    link: Mapped[str | None] = mapped_column(String(500))
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Device(TS, Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    push_token: Mapped[str] = mapped_column(String(300), unique=True)
    platform: Mapped[str] = mapped_column(String(20))  # android, ios, web


class DriverLocation(Base):
    __tablename__ = "driver_locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Promotion(TS, Base):
    """Offers the owner creates in admin: a code, or automatic when code is empty."""

    __tablename__ = "promotions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str | None] = mapped_column(String(40), unique=True)
    kind: Mapped[str] = mapped_column(String(20))  # percent, amount, free_delivery
    value: Mapped[int] = mapped_column(Integer, default=0)  # percent or pence
    min_spend_pence: Mapped[int] = mapped_column(Integer, default=0)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
