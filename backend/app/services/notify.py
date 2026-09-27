"""Customer and staff notifications.

Messages are saved as ``Notification`` rows (so the app can also list them)
and sent by the worker when ``send_at`` passes: app push to the customer's
devices, or SMS for guests who ordered without an account.
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.order_flow import Message
from ..models import Device, Notification, Order, utcnow

log = logging.getLogger(__name__)


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


class Sender:
    """Replace the bodies with Firebase Cloud Messaging (via Expo) and Twilio calls."""

    def push(self, token: str, platform: str, title: str, body: str, data: dict) -> None:
        log.info("PUSH %s %s: %s - %s %s", platform, token[:12], title, body, data)

    def sms(self, phone: str, text: str) -> None:
        log.info("SMS %s: %s", phone, text)


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
                sender.push(d.push_token, d.platform, n.title, n.body, data)
        elif n.order_id:
            order = db.get(Order, n.order_id)
            if order and order.customer_phone:
                text = f"{n.title}: {n.body}" + (f" {n.link}" if n.link else "")
                sender.sms(order.customer_phone, text)
        n.sent_at = now
    db.commit()
    return len(due)
