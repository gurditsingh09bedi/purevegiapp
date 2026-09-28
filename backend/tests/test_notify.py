"""Push and SMS sender, with the network replaced by a fake transport."""

import json

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
