"""End-to-end API test: a pre-order at 1 pm for a 7 pm delivery slot, through to the review prompt."""

import typing
from datetime import UTC, datetime, timedelta

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient

FROZEN = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)  # 1 pm in London (BST)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PV_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("PV_DEV_PAYMENTS", "true")
    monkeypatch.setenv("PV_JWT_SECRET", "test-secret-that-is-long-enough-for-hs256-signing")
    from app import config, db, deps, seed

    config.get_config.cache_clear()
    db.init_engine()
    seed.run("owner@purevegi.co.uk", "owner-pass-123")
    from app.main import app

    app.dependency_overrides[deps.now] = lambda: FROZEN
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def plain_item(c):
    """A dish with no required choices (e.g. a side), for tests that don't care which."""
    return next(i["id"] for cat in c.get("/menu").json() for i in cat["items"]
                if i["is_available"] and not any(g["min_choices"] for g in i["option_groups"]))


def login(c, email, pw):
    r = c.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_pre_order_to_review_prompt(client):
    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    r = c.patch("/admin/settings", headers=owner,
                json={"google_review_url": "https://g.page/r/purevegi/review", "review_prompt_delay_minutes": 0})
    assert r.status_code == 200, r.text
    for role in ("kitchen", "driver"):
        r = c.post("/admin/staff", headers=owner, json={"name": role, "email": f"{role}@purevegi.co.uk",
                                                        "password": "staff-pass-123", "role": role})
        assert r.status_code == 201, r.text
    chef, driver = login(c, "kitchen@purevegi.co.uk", "staff-pass-123"), login(c, "driver@purevegi.co.uk", "staff-pass-123")

    r = c.post("/auth/register", json={"name": "Aman", "email": "aman@purevegi.co.uk", "phone": "07700900001",
                                       "password": "customer-123"})
    me = {"Authorization": f"Bearer {r.json()['access_token']}"}

    slots = c.get("/delivery/slots").json()
    assert len(slots) == 20 and slots[0]["label"] == "5pm–5:15pm"
    seven = next(s for s in slots if s["label"].startswith("7pm"))

    item_id = plain_item(c)
    body = {"type": "delivery", "items": [{"menu_item_id": item_id, "quantity": 2}], "slot_start": seven["start"],
            "address": {"line1": "1 Test St", "postcode": "B21 9AA", "lat": 52.5163, "lng": -1.9310}}
    r = c.post("/orders", headers=me, json=body)
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["status"] == "pending_payment" and order["delivery_fee_pence"] == 0

    r = c.post(f"/orders/{order['id']}/dev-pay", headers=owner)
    assert r.json()["status"] == "placed"

    queue = c.get("/kitchen/queue", headers=chef).json()
    assert queue[0]["order"]["id"] == order["id"] and queue[0]["pre_order"] is True

    oid = order["id"]
    assert c.post(f"/kitchen/orders/{oid}/accept", headers=chef, json={"prep_minutes": 15}).json()["status"] == "accepted"
    assert c.post(f"/kitchen/orders/{oid}/start", headers=chef).json()["status"] == "preparing"
    assert c.post(f"/kitchen/orders/{oid}/ready", headers=chef).json()["status"] == "ready"
    assert c.post(f"/driver/orders/{oid}/picked-up", headers=driver).json()["status"] == "out_for_delivery"
    done = c.post(f"/driver/orders/{oid}/delivered", headers=driver).json()
    assert [e["status"] for e in done["events"]] == [
        "pending_payment", "placed", "accepted", "preparing", "ready", "out_for_delivery", "delivered"]

    kinds = [n["kind"] for n in c.get("/auth/notifications", headers=me).json()]
    assert "review_prompt" in kinds


def test_full_slot_is_first_come_first_served(client):
    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    c.patch("/admin/settings", headers=owner, json={"drivers_on_shift": 1})
    seven = next(s for s in c.get("/delivery/slots").json() if s["label"].startswith("7pm"))
    item_id = plain_item(c)
    body = {"type": "delivery", "customer_name": "A", "customer_phone": "07700900002",
            "items": [{"menu_item_id": item_id, "quantity": 1}], "slot_start": seven["start"],
            "address": {"line1": "x", "postcode": "B21", "lat": 52.51, "lng": -1.93}}
    assert c.post("/orders", json=body).status_code == 201
    r = c.post("/orders", json=body)
    assert r.status_code == 409 and "fully booked" in r.json()["detail"]
    booked = next(s for s in c.get("/delivery/slots").json() if s["label"].startswith("7pm"))
    assert booked["status"] == "booked"


def test_beyond_two_miles_costs_two_pounds(client):
    r = client.post("/delivery/quote", json={"lat": 52.5463, "lng": -1.9310})
    assert r.json()["fee_pence"] == 200


def test_guest_orders_pays_in_test_mode_and_tracks_with_token(client):
    c = client
    item_id = plain_item(c)
    seven = next(s for s in c.get("/delivery/slots").json() if s["label"].startswith("7pm"))
    body = {"type": "delivery", "customer_name": "Guest", "customer_phone": "07700900003",
            "items": [{"menu_item_id": item_id, "quantity": 1}], "slot_start": seven["start"],
            "address": {"line1": "x", "postcode": "B21", "lat": 52.51, "lng": -1.93}}
    placed = c.post("/orders", json=body).json()
    token = {"X-Order-Token": placed["view_token"]}
    assert c.get(f"/orders/{placed['id']}").status_code == 404
    assert c.get(f"/orders/{placed['id']}", headers=token).json()["status"] == "pending_payment"
    assert c.post(f"/orders/{placed['id']}/test-pay", headers=token).json()["status"] == "placed"


def test_table_qr_lookup(client):
    owner = login(client, "owner@purevegi.co.uk", "owner-pass-123")
    qr = client.get("/admin/tables", headers=owner).json()[0]["qr_url"].split("/t/")[1]
    assert client.get(f"/tables/qr/{qr}").json()["table_number"] == "1"
    assert client.get("/tables/qr/nonsense").status_code == 404


def test_table_bookings_never_clash(client):
    """Seed has 10 tables of 4. The 11th booking at 7pm is refused with other free times."""
    c = client
    seven = "2026-10-02T19:00:00+01:00"
    avail = c.get("/bookings/availability", params={"day": "2026-10-02", "guests": 4}).json()
    slot = next(a for a in avail if datetime.fromisoformat(a["start"]) == datetime.fromisoformat(seven))
    assert slot["tables_left"] == 10 and len(slot["tables"]) == 3
    tables = set()
    for i in range(10):
        r = c.post("/bookings", json={"name": f"Guest {i}", "phone": "07700900111", "guests": 4, "booking_at": seven})
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "pending"  # a request until staff accept it, but the table is already held
        tables.add(r.json()["table_number"])
    assert len(tables) == 10  # every booking got its own table
    r = c.post("/bookings", json={"name": "Late", "phone": "07700900111", "guests": 4, "booking_at": seven})
    assert r.status_code == 409
    alts = r.json()["detail"]["alternatives"]
    # A 90-minute booking at 7pm blocks starts from 5:31pm to 8:29pm; 5:30pm ends exactly at 7pm, so it is free.
    assert [a[11:16] for a in alts] == ["17:00", "17:30", "20:30"]
    after = c.get("/bookings/availability", params={"day": "2026-10-02", "guests": 4}).json()
    full = [a for a in after if a["tables_left"] == 0]
    assert full  # 6pm-8pm show as full

    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    listed = c.get("/bookings", params={"day": "2026-10-02"}, headers=owner).json()
    assert len(listed) == 10 and listed[0]["table_number"]


def _texts(booking_id):
    from app import db
    from app.models import Notification

    with db._SessionLocal() as s:
        return [n.body for n in s.query(Notification).filter(Notification.booking_id == booking_id).order_by(Notification.id)]


def test_booking_request_waits_for_staff_then_customer_is_told(client):
    """Request -> staff accept with a note about the special request -> the customer sees it and is texted."""
    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    body = {"name": "Gurdit", "phone": "07778233556", "guests": 4, "booking_at": "2026-10-02T17:00:00+01:00",
            "notes": "Parents visiting from India, could you arrange a cake? I'll pay extra"}
    r = c.post("/bookings", json=body)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "pending" and b["view_token"]
    assert "will confirm shortly" in _texts(b["id"])[0]
    guest = {"X-Booking-Token": b["view_token"]}

    assert c.get(f"/bookings/{b['id']}").status_code == 404  # no token, no peeking
    assert c.get(f"/bookings/{b['id']}", headers={"X-Booking-Token": "nope"}).status_code == 404
    assert c.get(f"/bookings/{b['id']}", headers=guest).json()["status"] == "pending"
    assert c.post(f"/bookings/{b['id']}/seat", headers=owner).status_code == 409  # accept first
    waiting = c.get("/bookings", params={"status": "pending"}, headers=owner).json()
    assert [x["id"] for x in waiting] == [b["id"]]  # the kitchen screen sees the request

    note = "Yes, we'll have a cake ready for your parents. £15, paid on the day."
    r = c.post(f"/bookings/{b['id']}/status", headers=owner, json={"status": "confirmed", "message": note})
    assert r.status_code == 200, r.text
    assert c.get("/bookings", params={"status": "pending"}, headers=owner).json() == []
    seen = c.get(f"/bookings/{b['id']}", headers=guest).json()
    assert seen["status"] == "confirmed" and seen["staff_message"] == note
    assert note in _texts(b["id"])[-1] and "Confirmed!" in _texts(b["id"])[-1]
    # Can't answer twice.
    assert c.post(f"/bookings/{b['id']}/status", headers=owner, json={"status": "declined"}).status_code == 409

    r = c.post(f"/bookings/{b['id']}/message", headers=owner, json={"message": "Candles included!"})
    assert r.status_code == 200 and r.json()["staff_message"] == "Candles included!"
    assert "Candles included!" in _texts(b["id"])[-1]
    assert c.post(f"/bookings/{b['id']}/seat", headers=owner).status_code == 201


def test_declined_request_frees_the_table_and_auto_confirm_switch(client):
    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    seven = "2026-10-02T19:00:00+01:00"
    ids = []
    for i in range(10):
        r = c.post("/bookings", json={"name": f"G{i}", "phone": "07700900111", "guests": 4, "booking_at": seven})
        ids.append(r.json()["id"])
    assert c.post("/bookings", json={"name": "X", "phone": "07700900111", "guests": 4, "booking_at": seven}).status_code == 409
    r = c.post(f"/bookings/{ids[0]}/status", headers=owner, 
                 json={"status": "declined", "message": "Kitchen closed for a private event."})
    assert r.status_code == 200 and r.json()["status"] == "declined"
    assert "can't take your booking" in _texts(ids[0])[-1] and "private event" in _texts(ids[0])[-1]
    r = c.post("/bookings", json={"name": "X", "phone": "07700900111", "guests": 4, "booking_at": seven})
    assert r.status_code == 201  # the declined request's table is free again

    assert c.patch("/admin/settings", headers=owner, json={"booking_auto_confirm": True}).status_code == 200
    r = c.post("/bookings", json={"name": "Y", "phone": "07700900111", "guests": 2, "booking_at": "2026-10-02T13:30:00+01:00"})
    assert r.status_code == 201 and r.json()["status"] == "confirmed"

    # The customer can cancel with the link from their text.
    tok = {"X-Booking-Token": r.json()["view_token"]}
    assert c.post(f"/bookings/{r.json()['id']}/cancel", headers=tok).json()["status"] == "cancelled"


def test_phone_booking_by_staff_is_confirmed_straight_away(client):
    owner = login(client, "owner@purevegi.co.uk", "owner-pass-123")
    r = client.post("/bookings", headers=owner, json={"name": "Phone guest", "phone": "07700900222", "guests": 2,
                                                       "booking_at": "2026-10-02T18:00:00+01:00"})
    assert r.status_code == 201 and r.json()["status"] == "confirmed"


def test_booking_updates_go_out_on_every_channel(client):
    """A guest's booking: web push to their browser, email, and SMS from the restaurant's phone."""
    import httpx
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from app import db
    from app.config import AppConfig
    from app.services import notify, webpush

    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    r = c.post("/bookings", json={"name": "Gurdit", "phone": "07778233556", "guests": 2, "email": "gurdit@example.com",
                                  "booking_at": "2026-10-02T18:00:00+01:00", "notes": "Cake please"})
    b = r.json()
    assert b["email"] == "gurdit@example.com"
    browser = ec.generate_private_key(ec.SECP256R1())
    keys = {"p256dh": webpush.b64u(browser.public_key().public_bytes(serialization.Encoding.X962,
                                                                     serialization.PublicFormat.UncompressedPoint)),
            "auth": webpush.b64u(b"0123456789abcdef")}
    sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/xyz", "keys": keys, "booking_id": b["id"]}
    assert c.post("/push/web-subscribe", json=sub).status_code == 404  # needs the booking's token
    assert c.post("/push/web-subscribe", json={**sub, "booking_token": b["view_token"]}).status_code == 204
    c.post(f"/bookings/{b['id']}/status", headers=owner, json={"status": "confirmed", "message": "Cake is on us!"})

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(201, json={})

    class SMTP:
        sent: typing.ClassVar[list] = []

        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, *a):
            pass

        def send_message(self, msg):
            SMTP.sent.append(msg)

    pub, priv = webpush.new_vapid_keys()
    cfg = AppConfig(vapid_public_key=pub, vapid_private_key=priv, smtp_host="smtp.example.com", smtp_user="u", smtp_password="p",
                    sms_provider="android", smsgate_user="pv", smsgate_password="s")
    sender = notify.Sender(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)), smtp_factory=SMTP)
    with db._SessionLocal() as s:
        assert notify.send_due(s, sender) == 2  # "request sent" and "confirmed"
    hosts = [r.url.host for r in calls]
    assert hosts.count("fcm.googleapis.com") == 2 and hosts.count("api.sms-gate.app") == 2
    assert len(SMTP.sent) == 2 and any("Cake is on us!" in m.get_body(("plain",)).get_content() for m in SMTP.sent)


def test_leaflet_menu_sizes_toppings_and_meal_upgrade(client):
    """Pizza price follows the size; toppings are priced for that size only; a meal needs a can."""
    c = client
    menu = c.get("/menu").json()
    assert [cat["name"] for cat in menu][:3] == ["Pizzas", "Burgers", "Wraps"]
    marg = next(i for i in menu[0]["items"] if i["name"] == "Margarita")
    opt = {(g["name"], o["name"]): o["id"] for g in marg["option_groups"] for o in g["options"]}
    groups = {g["name"]: g for g in marg["option_groups"]}
    assert groups["Extra toppings (80p each)"]["shown_if"] == '10" (6 slices)'
    ten, fourteen = opt[("Size", '10" (6 slices)')], opt[("Size", '14" (10 slices)')]
    olives10, paneer10 = opt[("Extra toppings (80p each)", "Olives")], opt[("Extra toppings (80p each)", "Paneer")]
    olives14 = opt[("Extra toppings (£1.20 each)", "Olives")]

    def order(item_id, option_ids):
        return c.post("/orders", json={"type": "collection", "customer_name": "T", "customer_phone": "07700900111",
                                       "items": [{"menu_item_id": item_id, "quantity": 1, "option_ids": option_ids}]})

    r = order(marg["id"], [ten, olives10, paneer10])
    assert r.status_code == 201, r.text
    assert r.json()["subtotal_pence"] == 650 + 80 + 80          # 10" £6.50 + two toppings at 80p
    assert order(marg["id"], [ten, olives14]).status_code == 400  # 14" topping on a 10" pizza
    assert order(marg["id"], []).status_code == 400               # size is required
    assert order(marg["id"], [fourteen]).json()["subtotal_pence"] == 999

    burger = next(i for i in menu[1]["items"] if i["name"] == "Veggie Burger")
    b = {(g["name"], o["name"]): o["id"] for g in burger["option_groups"] for o in g["options"]}
    meal, coke = b[("Make it a meal", "Fries + can of pop")], b[("Choose your can", "Coke")]
    assert order(burger["id"], [meal]).status_code == 400          # meal needs a can
    assert order(burger["id"], [coke]).status_code == 400          # can only comes with the meal
    assert order(burger["id"], [meal, coke]).json()["subtotal_pence"] == 450 + 249


def test_closed_at_night_order_ahead_only(client):
    """2am: no 'as soon as possible' collection; a pick-up time from the list works; tomorrow's delivery slots open."""
    from app import deps
    from app.main import app

    c = client
    night = datetime(2026, 10, 2, 1, 0, tzinfo=UTC)  # 2am in London
    app.dependency_overrides[deps.now] = lambda: night
    info = c.get("/restaurant").json()
    assert info["open_now"] is False and info["next_open"].startswith("2026-10-02T12:00")
    item = plain_item(c)
    base = {"type": "collection", "customer_name": "T", "customer_phone": "07700900111",
            "items": [{"menu_item_id": item, "quantity": 1}]}
    r = c.post("/orders", json=base)
    assert r.status_code == 409 and "collection time" in r.json()["detail"]
    times = c.get("/collection/times").json()
    assert times[0]["label"] == "12:15pm"
    assert c.post("/orders", json={**base, "collect_at": "2026-10-02T03:00:00+01:00"}).status_code == 409  # not offered
    r = c.post("/orders", json={**base, "collect_at": times[0]["start"]})
    assert r.status_code == 201, r.text
    got = datetime.fromisoformat(r.json()["slot_start"])
    got = got if got.tzinfo else got.replace(tzinfo=UTC)  # SQLite hands back naive UTC
    assert got == datetime.fromisoformat(times[0]["start"])
    assert c.get("/delivery/slots", params={"day": "2026-10-03"}).status_code == 200  # tomorrow can be booked


def test_late_night_order_for_tomorrow_shows_in_kitchen(client):
    """11pm: a delivery for tomorrow 5:15pm must appear on the kitchen screen straight away."""
    from app import deps
    from app.main import app

    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    app.dependency_overrides[deps.now] = lambda: datetime(2026, 10, 2, 22, 0, tzinfo=UTC)  # 11pm London
    slot = next(s for s in c.get("/delivery/slots", params={"day": "2026-10-03"}).json() if s["status"] != "booked")
    order = c.post("/orders", json={"type": "delivery", "customer_name": "Night", "customer_phone": "07700900222",
                                    "items": [{"menu_item_id": plain_item(c), "quantity": 1}], "slot_start": slot["start"],
                                    "address": {"line1": "x", "postcode": "B21", "lat": 52.51, "lng": -1.93}}).json()
    assert c.post(f"/orders/{order['id']}/test-pay", headers={"X-Order-Token": order["view_token"]}).json()["status"] == "placed"
    queue = c.get("/kitchen/queue", headers=owner).json()
    assert any(t["order"]["id"] == order["id"] for t in queue)


def test_busy_meter_special_and_reviews(client):
    from app import deps
    from app.main import app

    c = client
    owner = login(c, "owner@purevegi.co.uk", "owner-pass-123")
    assert c.get("/restaurant/busy").json()["level"] == "quiet"
    assert c.patch("/admin/settings", headers=owner, json={"busy_orders": 2, "very_busy_orders": 3}).status_code == 200
    item = plain_item(c)
    for _ in range(2):
        r = c.post("/orders", json={"type": "collection", "customer_name": "T", "customer_phone": "07700900111",
                                    "items": [{"menu_item_id": item, "quantity": 1}]}).json()
        c.post(f"/orders/{r['id']}/test-pay", headers={"X-Order-Token": r["view_token"]})
    busy = c.get("/restaurant/busy").json()
    assert busy["orders"] == 2 and busy["level"] == "busy"
    assert c.get("/restaurant").json()["busy"]["level"] == "busy"

    r = c.patch("/admin/settings", headers=owner, json={
        "special_item_id": item, "special_note": "Fresh today", "special_day": "2026-10-02",
        "reviews": [{"name": "Harpreet", "rating": 5, "text": "Best paneer wrap in Brum"}], "google_rating": 4.8})
    assert r.status_code == 200, r.text
    info = c.get("/restaurant").json()
    assert info["special"] == {"item_id": item, "note": "Fresh today"}
    assert info["reviews"][0]["name"] == "Harpreet" and info["google_rating"] == 4.8
    app.dependency_overrides[deps.now] = lambda: FROZEN + timedelta(days=1)
    assert c.get("/restaurant").json()["special"] is None  # only on its day
    assert c.patch("/admin/settings", headers=owner, json={"reviews": [{"name": "X", "rating": 9, "text": "y"}]}).status_code == 422
