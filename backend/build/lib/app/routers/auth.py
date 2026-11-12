from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..db import get_db
from ..deps import config, current_user, now
from ..models import Device, Notification, User
from ..schemas import DeviceIn, LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _token(user: User, cfg: AppConfig) -> TokenOut:
    return TokenOut(access_token=create_token(str(user.id), cfg.jwt_secret, cfg.jwt_minutes), role=user.role)


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "an account with this email already exists")
    user = User(
        name=body.name,
        email=email,
        phone=body.phone,
        password_hash=hash_password(body.password),
        marketing_opt_in=body.marketing_opt_in,
    )
    db.add(user)
    db.commit()
    return _token(user, cfg)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db), cfg: AppConfig = Depends(config)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "wrong email or password")
    if not user.is_active:
        raise HTTPException(403, "this account is disabled")
    return _token(user, cfg)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.post("/devices", status_code=204)
def register_device(body: DeviceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The app sends its push token after login so notifications reach the phone."""
    device = db.scalar(select(Device).where(Device.push_token == body.push_token))
    if device:
        device.user_id, device.platform = user.id, body.platform
    else:
        db.add(Device(user_id=user.id, push_token=body.push_token, platform=body.platform))
    db.commit()


@router.get("/notifications")
def my_notifications(user: User = Depends(current_user), db: Session = Depends(get_db), at: datetime = Depends(now)):
    """In-app inbox, including the Google review prompt once it is due."""
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id, Notification.send_at <= at)
        .order_by(Notification.send_at.desc())
        .limit(50)
    ).all()
    return [
        {"id": n.id, "order_id": n.order_id, "kind": n.kind, "title": n.title, "body": n.body,
         "link": n.link, "at": n.send_at, "read": n.read_at is not None}
        for n in rows
    ]
