"""Customer and staff notifications.

Messages are saved as ``Notification`` rows (so the app can also list them)
and sent by the worker when ``send_at`` passes, on every channel we have for
the customer:

* app push (the Pure Vegi phone app, through Expo's free push service),
* browser notifications (Web Push, our own code, see ``webpush.py``),
* email (any mailbox's SMTP),
* SMS from the restaurant's own Android phone (SMS Gate app) or Twilio.

Order updates go by SMS only when no push reached the customer; bookings always text.
WhatsApp is a button in the staff app (opens WhatsApp with the message ready to send).
"""

from __future__ import annotations

import html
import logging
import smtplib
from collections.abc import Callable
from datetime import datetime
from email.message import EmailMessage

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import AppConfig
from ..domain.order_flow import Message
from ..models import Booking, Device, Notification, Order, User, WebPushSubscription, utcnow
from . import webpush

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


def intl_phone(phone: str) -> str:
    """UK numbers in international form: 07700 900123 -> +447700900123."""
    p = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if p.startswith("00"):
        p = "+" + p[2:]
    if p.startswith("0"):
        p = "+44" + p[1:]
    if p.startswith("44"):
        p = "+" + p
    return p


class Sender:
    """Sends on every channel that is set up. Without keys a channel only logs, so
    development and tests never contact anyone."""

    def __init__(self, cfg: AppConfig | None = None, client: httpx.Client | None = None,
                 smtp_factory: Callable[..., smtplib.SMTP] | None = None):
        self.cfg = cfg or AppConfig()
        self.client = client or httpx.Client(timeout=10)
        self.smtp_factory = smtp_factory

    # --- which channels are live (shown on the admin Settings page) -------------------------
    def channels(self) -> dict:
        c = self.cfg
        sms = None
        if c.sms_provider == "android" and c.smsgate_user and c.smsgate_password:
            sms = "android"
        elif c.twilio_account_sid and c.twilio_auth_token and c.twilio_from_number:
            sms = "twilio"
        return {"app_push": True, "web_push": bool(c.vapid_public_key and c.vapid_private_key),
                "email": bool(c.smtp_host and c.smtp_user and c.smtp_password), "sms": sms, "whatsapp": "button"}

    # --- the phone app -----------------------------------------------------------------------
    def push(self, token: str, platform: str, title: str, body: str, data: dict) -> bool:
        """Returns False when the device is gone (app uninstalled), so the caller can forget it."""
        if not token.startswith(("ExponentPushToken[", "ExpoPushToken[")):
            log.info("PUSH (not an Expo token, skipped) %s: %s - %s", platform, title, body)
            return True
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.cfg.expo_access_token:
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

    # --- browser notifications ---------------------------------------------------------------
    def webpush(self, sub: WebPushSubscription, title: str, body: str, url: str) -> bool | None:
        """True = delivered, False = the browser unsubscribed (forget it), None = not sent."""
        c = self.cfg
        if not (c.vapid_public_key and c.vapid_private_key):
            log.info("WEB PUSH (no VAPID keys) %s - %s", title, body)
            return None
        try:
            headers, payload = webpush.build_request(sub.endpoint, sub.p256dh, sub.auth,
                                                     {"title": title, "body": body, "url": url},
                                                     c.vapid_public_key, c.vapid_private_key, c.vapid_subject)
            r = self.client.post(sub.endpoint, content=payload, headers=headers)
        except (httpx.HTTPError, ValueError):
            log.exception("web push failed")
            return None
        if r.status_code in (404, 410):
            return False
        if r.status_code >= 400:
            log.warning("web push %s: %s", r.status_code, r.text[:200])
            return None
        return True

    # --- email -------------------------------------------------------------------------------
    def email(self, to: str, subject: str, text: str, link: str | None = None) -> bool:
        c = self.cfg
        if not (c.smtp_host and c.smtp_user and c.smtp_password):
            log.info("EMAIL (SMTP not set up) %s: %s - %s", to, subject, text)
            return False
        msg = EmailMessage()
        msg["Subject"] = f"Pure Vegi: {subject}"
        msg["From"] = c.smtp_from or c.smtp_user
        msg["To"] = to
        msg.set_content(text + (f"\n\n{link}" if link else "") + "\n\nPure Vegi, 324 Soho Rd, Handsworth, Birmingham B21 9NA")
        button = (f'<p><a href="{html.escape(link)}" style="background:#0b3d2e;color:#fff;padding:10px 18px;'
                  f'border-radius:999px;text-decoration:none;font-weight:700">Open</a></p>') if link else ""
        msg.add_alternative(
            '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1d2a24">'
            f'<h2 style="color:#0b3d2e">{html.escape(subject)}</h2><p style="font-size:16px">{html.escape(text)}</p>{button}'
            '<p style="color:#777;font-size:13px">Pure Vegi · 324 Soho Rd, Handsworth, Birmingham B21 9NA'
            ' · 0121 554 7949</p></div>',
            subtype="html")
        try:
            factory = self.smtp_factory or (smtplib.SMTP_SSL if c.smtp_port == 465 else smtplib.SMTP)
            with factory(c.smtp_host, c.smtp_port, timeout=15) as smtp:
                if c.smtp_port != 465:
                    smtp.starttls()
                smtp.login(c.smtp_user, c.smtp_password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError):
            log.exception("email failed")
            return False
        return True

    # --- SMS ---------------------------------------------------------------------------------
    def sms(self, phone: str, text: str) -> bool:
        c = self.cfg
        to = intl_phone(phone)
        try:
            if c.sms_provider == "android" and c.smsgate_user and c.smsgate_password:
                # The restaurant's own Android phone sends it (SMS Gate app, cloud relay).
                r = self.client.post(f"{c.smsgate_url.rstrip('/')}/messages",
                                     json={"textMessage": {"text": text[:480]}, "phoneNumbers": [to]},
                                     auth=(c.smsgate_user, c.smsgate_password))
            elif c.twilio_account_sid and c.twilio_auth_token and c.twilio_from_number:
                url = f"https://api.twilio.com/2010-04-01/Accounts/{c.twilio_account_sid}/Messages.json"
                r = self.client.post(url, data={"To": to, "From": c.twilio_from_number, "Body": text[:320]},
                                     auth=(c.twilio_account_sid, c.twilio_auth_token))
            else:
                log.info("SMS (not set up) %s: %s", to, text)
                return False
        except httpx.HTTPError:
            log.exception("sms failed")
            return False
        if r.status_code >= 400:
            log.warning("sms %s: %s", r.status_code, r.text[:200])
            return False
        return True


def send_due(db: Session, sender: Sender, now: datetime | None = None, limit: int = 200) -> int:
    """Send every unsent notification whose time has come. Returns how many were sent."""
    now = now or utcnow()
    due = db.scalars(
        select(Notification)
        .where(Notification.sent_at.is_(None), Notification.send_at <= now)
        .order_by(Notification.send_at)
        .limit(limit)
    ).all()
    site = (sender.cfg.site_url or "").rstrip("/")
    for n in due:
        order = db.get(Order, n.order_id) if n.order_id else None
        booking = db.get(Booking, n.booking_id) if n.booking_id else None
        user = db.get(User, n.user_id) if n.user_id else None
        path = f"/order/{n.order_id}" if n.order_id else f"/booking/{n.booking_id}" if n.booking_id else "/"
        click = n.link or path  # where a tap on the notification goes
        data = {"order_id": n.order_id, "booking_id": n.booking_id, "kind": n.kind, "link": n.link}
        pushed = False

        # 1. The phone app.
        devices = db.scalars(select(Device).where(Device.user_id == n.user_id)).all() if n.user_id else []
        for d in devices:
            if sender.push(d.push_token, d.platform, n.title, n.body, data):
                pushed = True
            else:
                db.delete(d)  # app uninstalled
        if not devices and order and order.push_token:
            pushed = sender.push(order.push_token, "app", n.title, n.body, data) or pushed

        # 2. Browsers that asked for notifications (for this customer, order or booking).
        who = [WebPushSubscription.user_id == n.user_id] if n.user_id else []
        who += [WebPushSubscription.order_id == n.order_id] if n.order_id else []
        who += [WebPushSubscription.booking_id == n.booking_id] if n.booking_id else []
        for sub in db.scalars(select(WebPushSubscription).where(or_(*who))).all() if who else []:
            ok = sender.webpush(sub, n.title, n.body, click)
            if ok is False:
                db.delete(sub)
            pushed = pushed or bool(ok)

        # 3. Email, when we have an address.
        email = (booking.email if booking else order.customer_email if order else None) or (user.email if user else None)
        if email:
            sender.email(email, n.title, n.body, n.link or (f"{site}{path}" if site and order else None))

        # 4. SMS: bookings always (the text has the details); orders only if no push got through.
        phone = booking.phone if booking else (order.customer_phone if order and not pushed else None)
        if phone:
            sender.sms(phone, f"{n.title}: {n.body}" + (f" {n.link}" if n.link else ""))
        n.sent_at = now
    db.commit()
    return len(due)
