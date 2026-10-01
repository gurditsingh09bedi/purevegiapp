"""End-to-end API test: a pre-order at 1 pm for a 7 pm delivery slot, through to the review prompt."""

from datetime import UTC, datetime

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

    item_id = c.get("/menu").json()[0]["items"][0]["id"]
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
    item_id = c.get("/menu").json()[0]["items"][0]["id"]
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
    item_id = c.get("/menu").json()[0]["items"][0]["id"]
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

    note = "Yes, we'll have a cake ready for your parents. £15, paid on the day."
    r = c.post(f"/bookings/{b['id']}/status", headers=owner, json={"status": "confirmed", "message": note})
    assert r.status_code == 200, r.text
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
