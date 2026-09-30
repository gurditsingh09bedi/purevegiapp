"""Customer and staff notifications.

Messages are saved as ``Notification`` rows (so the app can also list them)
and sent by the worker when ``send_at`` passes: app push to the customer's
devices, or SMS for guests who ordered without an account.
"""

from __future__ import annotations

import logging
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..domain.order_flow import Message
from ..models import Booking, Device, Notification, Order, utcnow

log = logging.getLogger(__name__)


def queue_booking(db: Session, booking, message: Message, kind: str = "booking") -> Notification:
    n = Notification(user_id=booking.user_id, booking_id=booking.id, kind=kind, title=message.title,
                     body=message.body, send_at=utcnow())
    db.add(n)
    return n


def queue(
    db: Session,
    order: Order,
    message: Message,
    kind: str = "status",
    send_at: datetime | None = None,
    link: str | None = None,
) -> Notification:
    n = Notification(
        user_id=order.user_id,
        order_id=order.id,
        kind=kind,
        title=message.title,
        body=message.body,
        link=link,
        send_at=send_at or utcnow(),
    )
    db.add(n)
    return n


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class Sender:
    """Sends app pushes through Expo's push service and texts through Twilio.

    Without keys it only logs, so development and tests never contact anyone.
    """

    def __init__(self, cfg: AppConfig | None = None, client: httpx.Client | None = None):
        self.cfg = cfg
        self.client = client or httpx.Client(timeout=10)

    def push(self, token: str, platform: str, title: str, body: str, data: dict) -> bool:
        """Returns False when the device is gone (app uninstalled), so the caller can forget it."""
        if not token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
            log.info("PUSH (not an Expo token, skipped) %s: %s - %s", platform, title, body)
            return True
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.cfg and self.cfg.expo_access_token:
            headers["Authorization"] = f"Bearer {self.cfg.expo_access_token}"
        msg = {"to": token, "title": title, "body": body, "data": data, "sound": "default", "priority": "high"}
        try:
            r = self.client.post(EXPO_PUSH_URL, json=msg, headers=headers)
            ticket = (r.json() or {}).get("data") or {}
        except (httpx.HTTPError, ValueError):
            log.exception("push failed")
            return True
        if ticket.get("status") == "error":
            log.warning("push error: %s", ticket.get("message"))
            return (ticket.get("details") or {}).get("error") != "DeviceNotRegistered"
        return True

    def sms(self, phone: str, text: str) -> None:
        c = self.cfg
        if not (c and c.twilio_account_sid and c.twilio_auth_token and c.twilio_from_number):
            log.info("SMS (Twilio not set up) %s: %s", phone, text)
            return
        to = "+44" + phone.lstrip("0") if phone.startswith("07") else phone  # UK mobiles
        url = f"https://api.twilio.com/2010-04-01/Accounts/{c.twilio_account_sid}/Messages.json"
        try:
            self.client.post(url, data={"To": to, "From": c.twilio_from_number, "Body": text[:320]},
                             auth=(c.twilio_account_sid, c.twilio_auth_token))
        except httpx.HTTPError:
            log.exception("sms failed")


def send_due(db: Session, sender: Sender, now: datetime | None = None, limit: int = 200) -> int:
    """Send every unsent notification whose time has come. Returns how many were sent."""
    now = now or utcnow()
    due = db.scalars(
        select(Notification)
        .where(Notification.sent_at.is_(None), Notification.send_at <= now)
        .order_by(Notification.send_at)
        .limit(limit)
    ).all()
    for n in due:
        data = {"order_id": n.order_id, "kind": n.kind, "link": n.link}
        devices = db.scalars(select(Device).where(Device.user_id == n.user_id)).all() if n.user_id else []
        if devices:
            for d in devices:
                if not sender.push(d.push_token, d.platform, n.title, n.body, data):
                    db.delete(d)  # app uninstalled
        elif n.booking_id:
            b = db.get(Booking, n.booking_id)
            if b and b.phone:
                sender.sms(b.phone, f"{n.title}: {n.body}")
        elif n.order_id:
            order = db.get(Order, n.order_id)
            if order and order.push_token:
                sender.push(order.push_token, "app", n.title, n.body, data)
            elif order and order.customer_phone:
                text = f"{n.title}: {n.body}" + (f" {n.link}" if n.link else "")
                sender.sms(order.customer_phone, text)
        n.sent_at = now
    db.commit()
    return len(due)
