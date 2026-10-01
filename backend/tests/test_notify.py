"""Push and SMS sender, with the network replaced by a fake transport."""

import json
import typing

import httpx
import pytest

pytest.importorskip("pydantic_settings")
pytest.importorskip("sqlalchemy")

from app.config import AppConfig
from app.services.notify import Sender


def make_sender(reply: dict, seen: list, **cfg):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=reply)

    return Sender(AppConfig(**cfg), client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_expo_push_is_sent():
    seen = []
    s = make_sender({"data": {"status": "ok", "id": "x"}}, seen)
    assert s.push("ExponentPushToken[abc]", "android", "Accepted by Pure Vegi", "Ready 6:10pm", {"order_id": 5}) is True
    body = json.loads(seen[0].content)
    assert seen[0].url == "https://exp.host/--/api/v2/push/send"
    assert body["to"] == "ExponentPushToken[abc]" and body["title"] == "Accepted by Pure Vegi"


def test_uninstalled_app_is_reported():
    seen = []
    s = make_sender({"data": {"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}}}, seen)
    assert s.push("ExponentPushToken[abc]", "ios", "t", "b", {}) is False


def test_sms_needs_twilio_keys():
    seen = []
    make_sender({}, seen).sms("07700900001", "hi")
    assert seen == []
    make_sender({}, seen, twilio_account_sid="AC1", twilio_auth_token="t", twilio_from_number="+441234").sms("07700900001", "hi")
    assert "To=%2B447700900001" in seen[0].content.decode()


def test_android_phone_sms_through_sms_gate():
    seen = []
    s = make_sender({"id": "m1"}, seen, sms_provider="android", smsgate_user="pv", smsgate_password="secret")
    assert s.sms("07778 233556", "Booking confirmed") is True
    req = seen[0]
    assert str(req.url) == "https://api.sms-gate.app/3rdparty/v1/messages"
    assert json.loads(req.content) == {"textMessage": {"text": "Booking confirmed"}, "phoneNumbers": ["+447778233556"]}
    assert req.headers["authorization"].startswith("Basic ")


class FakeSMTP:
    sent: typing.ClassVar[list] = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        self.tls = True

    def login(self, user, password):
        self.user = user

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


def test_email_through_smtp():
    FakeSMTP.sent = []
    s = Sender(AppConfig(smtp_host="smtp.gmail.com", smtp_user="purevegi@gmail.com", smtp_password="app-pass"),
               smtp_factory=FakeSMTP)
    assert s.email("gurdit@example.com", "Booking confirmed", "Table 2 for 4, Fri 5pm.", "https://purevegi.co.uk/booking/4")
    msg = FakeSMTP.sent[0]
    assert msg["To"] == "gurdit@example.com" and msg["Subject"] == "Pure Vegi: Booking confirmed"
    assert "Table 2 for 4" in msg.get_body(("plain",)).get_content()
    # Not set up: only logged.
    assert Sender(AppConfig(), smtp_factory=FakeSMTP).email("x@example.com", "t", "b") is False


def test_web_push_delivered_or_gone():
    from types import SimpleNamespace

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from app.services import webpush

    pub, priv = webpush.new_vapid_keys()
    browser = ec.generate_private_key(ec.SECP256R1())
    sub = SimpleNamespace(endpoint="https://fcm.googleapis.com/fcm/send/abc",
                          p256dh=webpush.b64u(browser.public_key().public_bytes(serialization.Encoding.X962,
                                                                                serialization.PublicFormat.UncompressedPoint)),
                          auth=webpush.b64u(b"0123456789abcdef"))
    for code, expected in ((201, True), (410, False)):
        seen = []

        def handler(request, code=code, seen=seen):
            seen.append(request)
            return httpx.Response(code)

        s = Sender(AppConfig(vapid_public_key=pub, vapid_private_key=priv),
                   client=httpx.Client(transport=httpx.MockTransport(handler)))
        assert s.webpush(sub, "Booking confirmed", "Table 2", "/booking/4") is expected
        assert seen[0].headers["content-encoding"] == "aes128gcm" and seen[0].headers["authorization"].startswith("vapid t=")
    assert Sender(AppConfig()).webpush(sub, "t", "b", "/") is None  # no keys: not sent


def test_channels_report():
    assert Sender(AppConfig()).channels() == {"app_push": True, "web_push": False, "email": False, "sms": None,
                                              "whatsapp": "button"}
    c = Sender(AppConfig(sms_provider="android", smsgate_user="u", smsgate_password="p")).channels()
    assert c["sms"] == "android"
