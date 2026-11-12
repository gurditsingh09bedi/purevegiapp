"""Browser notifications: the website asks the browser for permission and registers here."""

import jwt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..db import get_db
from ..deps import config, optional_user
from ..models import Booking, Order, User, WebPushSubscription
from ..schemas import WebPushIn
from ..security import decode_token

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/web-key")
def web_push_key(cfg: AppConfig = Depends(config)):
    """The public half of our VAPID key; null when browser notifications aren't set up."""
    return {"public_key": cfg.vapid_public_key if cfg.vapid_private_key else None}


def _owns(token: str | None, kind: str, obj_id: int, cfg: AppConfig) -> bool:
    try:
        return bool(token) and decode_token(token, cfg.jwt_secret, kind=kind)["sub"] == str(obj_id)
    except jwt.PyJWTError:
        return False


@router.post("/web-subscribe", status_code=204)
def web_subscribe(body: WebPushIn, db: Session = Depends(get_db), user: User | None = Depends(optional_user),
                  cfg: AppConfig = Depends(config)):
    """Save (or update) a browser's subscription. Guests prove which order or booking they follow
    with the token they got when they made it."""
    order_id = booking_id = None
    if body.order_id:
        o = db.get(Order, body.order_id)
        if o is None or not ((user and o.user_id == user.id) or _owns(body.order_token, "order", o.id, cfg)):
            raise HTTPException(404, "order not found")
        order_id = o.id
    if body.booking_id:
        b = db.get(Booking, body.booking_id)
        if b is None or not ((user and b.user_id == user.id) or _owns(body.booking_token, "booking", b.id, cfg)):
            raise HTTPException(404, "booking not found")
        booking_id = b.id
    if not (user or order_id or booking_id):
        raise HTTPException(401, "log in, or follow an order or booking")
    sub = db.scalar(select(WebPushSubscription).where(WebPushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = WebPushSubscription(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(sub)
    sub.p256dh, sub.auth = body.keys.p256dh, body.keys.auth
    if user:
        sub.user_id = user.id
    if order_id:
        sub.order_id = order_id
    if booking_id:
        sub.booking_id = booking_id
    db.commit()
