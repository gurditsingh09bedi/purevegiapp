"""Owner / manager panel: settings, menu, offers, staff, tables, orders."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..db import get_db
from ..deps import admin_only, config, settings
from ..domain.order_flow import Status
from ..domain.settings import RestaurantSettings
from ..models import Category, DiningTable, MenuItem, Option, OptionGroup, Order, Promotion, Role, TableSession, User
from ..schemas import (
    CategoryIn,
    CategoryOut,
    MenuItemIn,
    MenuItemOut,
    NotifyTestIn,
    OrderOut,
    PromotionIO,
    StaffIn,
    TableIn,
    TableOut,
    UserOut,
)
from ..security import hash_password, table_token
from ..services.notify import Sender
from ..services.settings_store import save_settings
from .orders import order_out

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_only)])


# --- Settings: every number the owner can change ----------------------------------------


@router.get("/settings", response_model=RestaurantSettings)
def get_all_settings(s: RestaurantSettings = Depends(settings)):
    return s


@router.patch("/settings", response_model=RestaurantSettings)
def update_settings(changes: dict, db: Session = Depends(get_db), s: RestaurantSettings = Depends(settings)):
    """Send only the fields to change, e.g. {"slot_minutes": 20, "fee_beyond_free_pence": 250}."""
    unknown = set(changes) - set(RestaurantSettings.model_fields)
    if unknown:
        raise HTTPException(422, f"unknown settings: {', '.join(sorted(unknown))}")
    try:
        new = RestaurantSettings.model_validate({**s.model_dump(mode="json"), **changes})
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False)) from None
    save_settings(db, new)
    db.commit()
    return new


# --- Notifications: which channels are switched on, and a test message ------------------


def get_sender(cfg: AppConfig = Depends(config)) -> Sender:
    return Sender(cfg)


@router.get("/notify-status")
def notify_status(sender: Sender = Depends(get_sender)):
    return sender.channels()


@router.post("/notify-test")
def notify_test(body: NotifyTestIn, sender: Sender = Depends(get_sender)):
    """Send a test email and/or text so the owner can check the setup."""
    out = {}
    if body.email:
        out["email"] = sender.email(body.email, "Test message", "If you can read this, Pure Vegi emails are working.")
    if body.phone:
        out["sms"] = sender.sms(body.phone, "Pure Vegi test: if you can read this, texts are working.")
    return out


# --- Menu --------------------------------------------------------------------------------


@router.get("/menu", response_model=list[CategoryOut])
def full_menu(db: Session = Depends(get_db)):
    """Every category and dish, including hidden categories and sold-out dishes."""
    return db.scalars(select(Category).order_by(Category.sort_order, Category.id)).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db)):
    c = Category(**body.model_dump())
    db.add(c)
    db.commit()
    return c


@router.put("/categories/{cid}", response_model=CategoryOut)
def update_category(cid: int, body: CategoryIn, db: Session = Depends(get_db)):
    c = db.get(Category, cid) or _404("category")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return c


def _apply_item(item: MenuItem, body: MenuItemIn) -> None:
    data = body.model_dump(exclude={"option_groups"})
    for k, v in data.items():
        setattr(item, k, v)
    item.option_groups = [
        OptionGroup(
            name=g.name,
            min_choices=g.min_choices,
            max_choices=g.max_choices,
            shown_if=g.shown_if or None,
            sort_order=i,
            options=[Option(name=o.name, price_pence=o.price_pence, is_available=o.is_available) for o in g.options],
        )
        for i, g in enumerate(body.option_groups)
    ]


@router.post("/items", response_model=MenuItemOut, status_code=201)
def create_item(body: MenuItemIn, db: Session = Depends(get_db)):
    db.get(Category, body.category_id) or _404("category")
    item = MenuItem()
    _apply_item(item, body)
    db.add(item)
    db.commit()
    return item


@router.put("/items/{item_id}", response_model=MenuItemOut)
def update_item(item_id: int, body: MenuItemIn, db: Session = Depends(get_db)):
    item = db.get(MenuItem, item_id) or _404("dish")
    _apply_item(item, body)
    db.commit()
    return item


@router.post("/items/{item_id}/availability", response_model=MenuItemOut)
def set_availability(item_id: int, available: bool, db: Session = Depends(get_db)):
    """Sold out ("86") hides the dish from ordering on every channel at once."""
    item = db.get(MenuItem, item_id) or _404("dish")
    item.is_available = available
    db.commit()
    return item


# --- Offers ------------------------------------------------------------------------------


@router.get("/promotions", response_model=list[PromotionIO])
def list_promotions(db: Session = Depends(get_db)):
    return db.scalars(select(Promotion).order_by(Promotion.id.desc())).all()


@router.post("/promotions", response_model=PromotionIO, status_code=201)
def create_promotion(body: PromotionIO, db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"id", "uses"})
    data["code"] = data["code"].strip().upper() if data["code"] else None
    if data["code"] and db.scalar(select(Promotion).where(Promotion.code == data["code"])):
        raise HTTPException(409, "that code already exists")
    p = Promotion(**data)
    db.add(p)
    db.commit()
    return p


@router.put("/promotions/{pid}", response_model=PromotionIO)
def update_promotion(pid: int, body: PromotionIO, db: Session = Depends(get_db)):
    p = db.get(Promotion, pid) or _404("offer")
    for k, v in body.model_dump(exclude={"id", "uses"}).items():
        setattr(p, k, v.strip().upper() if k == "code" and v else v)
    db.commit()
    return p


# --- Staff -------------------------------------------------------------------------------


@router.get("/staff", response_model=list[UserOut])
def list_staff(db: Session = Depends(get_db)):
    return db.scalars(select(User).where(User.role != Role.CUSTOMER).order_by(User.id)).all()


@router.post("/staff/{user_id}/active", response_model=UserOut)
def set_staff_active(user_id: int, active: bool, db: Session = Depends(get_db)):
    """Switch a staff login off when someone leaves (their history stays)."""
    u = db.get(User, user_id) or _404("staff member")
    if u.role == Role.OWNER and not active:
        raise HTTPException(409, "the owner account can't be switched off")
    u.is_active = active
    db.commit()
    return u


@router.post("/staff", response_model=UserOut, status_code=201)
def create_staff(body: StaffIn, db: Session = Depends(get_db), actor: User = Depends(admin_only)):
    if body.role in {Role.OWNER, Role.CUSTOMER}:
        raise HTTPException(422, "staff can be kitchen, waiter, driver or manager")
    if body.role == Role.MANAGER and actor.role != Role.OWNER:
        raise HTTPException(403, "only the owner can add managers")
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "an account with this email already exists")
    u = User(name=body.name, email=body.email.lower(), phone=body.phone,
             password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.commit()
    return u


# --- Tables ------------------------------------------------------------------------------


@router.get("/tables", response_model=list[TableOut])
def list_tables(db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    out = []
    for t in db.scalars(select(DiningTable).where(DiningTable.is_active.is_(True)).order_by(DiningTable.id)).all():
        row = TableOut.model_validate(t)
        row.qr_url = f"/t/{table_token(t.id, cfg.jwt_secret)}"  # prefix with the website domain when printing
        out.append(row)
    return out


def _number_free(db: Session, number: str, skip_id: int | None = None) -> None:
    other = db.scalar(select(DiningTable).where(DiningTable.number == number.strip()))
    if other is not None and other.id != skip_id:
        raise HTTPException(409, f"there is already a table {number}")


@router.post("/tables", response_model=TableOut, status_code=201)
def create_table(body: TableIn, db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    if not body.number.strip():
        raise HTTPException(422, "give the table a number or name")
    _number_free(db, body.number)
    t = DiningTable(number=body.number.strip(), seats=body.seats)
    db.add(t)
    db.commit()
    row = TableOut.model_validate(t)
    row.qr_url = f"/t/{table_token(t.id, cfg.jwt_secret)}"
    return row


@router.put("/tables/{table_id}", response_model=TableOut)
def update_table(table_id: int, body: TableIn, db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    """Rename a table or change its seats. Its QR code stays the same."""
    t = db.get(DiningTable, table_id)
    if t is None or not t.is_active:
        _404("table")
    _number_free(db, body.number, skip_id=t.id)
    t.number, t.seats = body.number.strip(), body.seats
    db.commit()
    row = TableOut.model_validate(t)
    row.qr_url = f"/t/{table_token(t.id, cfg.jwt_secret)}"
    return row


@router.delete("/tables/{table_id}", status_code=204)
def delete_table(table_id: int, db: Session = Depends(get_db)):
    """Remove a table. Its QR code stops working. Past orders keep their history, so a table that was
    ever used is hidden rather than erased (and its number is freed for a new table)."""
    t = db.get(DiningTable, table_id)
    if t is None or not t.is_active:
        _404("table")
    if db.scalar(select(TableSession).where(TableSession.table_id == t.id, TableSession.closed_at.is_(None))):
        raise HTTPException(409, f"table {t.number} has an open bill: take payment first")
    used = db.scalar(select(func.count(TableSession.id)).where(TableSession.table_id == t.id))
    if used:
        t.is_active = False
        t.number = f"old{t.id}-{t.number}"[:16]
    else:
        db.delete(t)
    db.commit()


# --- Orders and reports -----------------------------------------------------------------


@router.get("/orders", response_model=list[OrderOut])
def list_orders(status: Status | None = None, limit: int = 100, db: Session = Depends(get_db),
                s: RestaurantSettings = Depends(settings)):
    q = select(Order).order_by(Order.id.desc()).limit(min(limit, 500))
    if status:
        q = q.where(Order.status == status)
    return [order_out(o, s) for o in db.scalars(q).all()]


@router.get("/reports/sales")
def sales_report(start: datetime, end: datetime, db: Session = Depends(get_db)):
    """Paid sales between two times, by order type (pence)."""
    rows = db.execute(
        select(Order.type, func.count(Order.id), func.sum(Order.total_pence), func.sum(Order.tip_pence))
        .where(Order.paid_at >= start, Order.paid_at < end, Order.status.not_in([Status.REJECTED, Status.CANCELLED]))
        .group_by(Order.type)
    ).all()
    return [{"type": t.value, "orders": n, "total_pence": total or 0, "tips_pence": tips or 0} for t, n, total, tips in rows]


@router.get("/reports/payments")
def payments_report(start: datetime, end: datetime, db: Session = Depends(get_db)):
    """Paid sales between two times by how they were paid: card / cash at the till, or online (pence)."""
    rows = db.execute(
        select(Order.payment_method, func.count(Order.id), func.sum(Order.total_pence))
        .where(Order.paid_at >= start, Order.paid_at < end, Order.status.not_in([Status.REJECTED, Status.CANCELLED]))
        .group_by(Order.payment_method)
    ).all()
    return [{"method": m or "online", "orders": n, "total_pence": total or 0} for m, n, total in rows]


def _404(what: str):
    raise HTTPException(404, f"{what} not found")
