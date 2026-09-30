from datetime import date, datetime, time, timedelta
from itertools import pairwise
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.domain import booking, delivery, kitchen, order_flow, slots
from app.domain.order_flow import OrderType, Status
from app.domain.settings import DayHours, RestaurantSettings

LDN = ZoneInfo("Europe/London")
DAY = date(2026, 10, 2)  # a Friday


def at(h, m=0, d=DAY):
    return datetime.combine(d, time(h, m), LDN)


# --- settings ------------------------------------------------------------------


def test_defaults_match_agreed_plan():
    s = RestaurantSettings()
    assert s.delivery_start == time(17) and s.delivery_end == time(22)
    assert s.slot_minutes == 15 and s.slot_capacity == 2
    assert s.free_radius_miles == 2 and s.fee_beyond_free_pence == 200
    assert s.auto_accept is False
    assert all(h.opens == time(12) and h.closes == time(22, 30) for h in s.opening_hours.values())


def test_settings_reject_nonsense():
    with pytest.raises(ValidationError):
        RestaurantSettings(delivery_start=time(22), delivery_end=time(17))
    with pytest.raises(ValidationError):
        RestaurantSettings(free_radius_miles=6, max_radius_miles=5)


# --- slots ---------------------------------------------------------------------


def test_twenty_slots_from_5_to_10():
    times = slots.slot_times(DAY, RestaurantSettings())
    assert len(times) == 20
    assert times[0] == (at(17), at(17, 15))
    assert times[-1] == (at(21, 45), at(22))


def test_slots_clipped_by_opening_hours_and_closed_days():
    s = RestaurantSettings()
    s.opening_hours["friday"] = DayHours(opens=time(18), closes=time(21))
    times = slots.slot_times(DAY, s)
    assert times[0][0] == at(18) and times[-1][1] == at(21)
    s.opening_hours["friday"] = DayHours(closed=True)
    assert slots.slot_times(DAY, s) == []


def test_full_slot_shows_booked_and_one_left():
    s = RestaurantSettings()  # 2 drivers x 1 order = 2 per slot
    now = at(13)
    taken = [at(18), at(18), at(18, 15)]
    by_start = {x.start: x for x in slots.slot_availability(DAY, s, taken, now)}
    assert by_start[at(18)].status == "booked"
    assert by_start[at(18, 15)].status == "few_left"
    assert by_start[at(18, 30)].status == "free"


def test_pre_order_at_1pm_for_7pm_is_allowed():
    s = RestaurantSettings()
    slot = slots.check_slot(at(19), s, [], now=at(13))
    assert slot.start == at(19) and slot.remaining == 2


def test_first_come_first_served():
    s = RestaurantSettings(drivers_on_shift=1)
    with pytest.raises(slots.SlotUnavailable, match="fully booked"):
        slots.check_slot(at(19), s, [at(19)], now=at(13))


def test_slots_too_soon_are_hidden():
    s = RestaurantSettings(min_lead_minutes=30)
    avail = slots.slot_availability(DAY, s, [], now=at(18, 10))
    assert avail[0].start == at(18, 45)


def test_off_grid_or_paused_slots_rejected():
    s = RestaurantSettings()
    with pytest.raises(slots.SlotUnavailable):
        slots.check_slot(at(19, 7), s, [], now=at(13))
    s.online_orders_paused = True
    with pytest.raises(slots.SlotUnavailable):
        slots.check_slot(at(19), s, [], now=at(13))


def test_changing_slot_length_in_admin():
    s = RestaurantSettings(slot_minutes=30)
    assert len(slots.slot_times(DAY, s)) == 10


def test_slot_label():
    slot = slots.Slot(start=at(18, 15), end=at(18, 30), capacity=2, taken=0)
    assert slot.label == "6:15pm–6:30pm"


# --- delivery fee --------------------------------------------------------------


def test_free_within_two_miles_then_two_pounds():
    s = RestaurantSettings()
    near = delivery.quote(s.latitude + 0.01, s.longitude, s)  # ~0.7 miles
    assert near.fee_pence == 0
    far = delivery.quote(s.latitude + 0.04, s.longitude, s)  # ~2.8 miles
    assert far.fee_pence == 200
    with pytest.raises(delivery.OutsideDeliveryArea):
        delivery.quote(s.latitude + 0.2, s.longitude, s)  # ~14 miles


# --- order flow ----------------------------------------------------------------


def test_delivery_happy_path():
    path = [Status.PENDING_PAYMENT, Status.PLACED, Status.ACCEPTED, Status.PREPARING,
            Status.READY, Status.OUT_FOR_DELIVERY, Status.DELIVERED]
    for a, b in pairwise(path):
        order_flow.check_transition(a, b, OrderType.DELIVERY)


def test_wrong_moves_blocked():
    with pytest.raises(order_flow.InvalidTransition):
        order_flow.check_transition(Status.READY, Status.OUT_FOR_DELIVERY, OrderType.COLLECTION)
    with pytest.raises(order_flow.InvalidTransition):
        order_flow.check_transition(Status.PLACED, Status.PREPARING, OrderType.DELIVERY)
    with pytest.raises(order_flow.InvalidTransition):
        order_flow.check_transition(Status.DELIVERED, Status.CANCELLED, OrderType.DELIVERY)


def test_dine_in_starts_placed_and_ends_served():
    assert order_flow.initial_status(OrderType.DINE_IN) is Status.PLACED
    order_flow.check_transition(Status.READY, Status.SERVED, OrderType.DINE_IN)


def test_auto_accept_switch():
    assert order_flow.status_after_payment(False) is Status.PLACED
    assert order_flow.status_after_payment(True) is Status.ACCEPTED


def test_customer_messages():
    msg = order_flow.customer_message(Status.ACCEPTED, OrderType.COLLECTION, ready_at=at(18, 10))
    assert msg.title == "Accepted by Pure Vegi" and "6:10 pm" in msg.body
    msg = order_flow.customer_message(Status.READY, OrderType.DINE_IN, table_number="7")
    assert "table 7" in msg.body
    assert order_flow.customer_message(Status.PREPARING, OrderType.DELIVERY).body.startswith("The chef")


def test_review_prompt_after_delay():
    assert order_flow.review_prompt_time(at(19), 45) == at(19, 45)


# --- kitchen -------------------------------------------------------------------


def test_pre_order_waits_until_slot_minus_prep():
    t = kitchen.TicketTiming(1, OrderType.DELIVERY, Status.ACCEPTED, created_at=at(13),
                             slot_start=at(19), prep_minutes=15, accepted_at=at(13, 5))
    assert kitchen.cook_at(t, 15) == at(18, 45)
    assert kitchen.urgency(t, at(17), 15, 10, 15) == "waiting"
    assert kitchen.urgency(t, at(18, 57), 15, 10, 15) == "amber"


def test_busy_kitchen_adds_minutes():
    t = kitchen.TicketTiming(1, OrderType.COLLECTION, Status.PREPARING, created_at=at(18),
                             prep_minutes=10, accepted_at=at(18), extra_minutes=10)
    assert kitchen.ready_at(t, 15) == at(18, 20)


def test_queue_new_orders_first_then_by_cook_time():
    a = kitchen.TicketTiming(1, OrderType.DELIVERY, Status.ACCEPTED, at(13), slot_start=at(19), prep_minutes=15)
    b = kitchen.TicketTiming(2, OrderType.COLLECTION, Status.PREPARING, at(18), prep_minutes=10, accepted_at=at(18))
    c = kitchen.TicketTiming(3, OrderType.DINE_IN, Status.PLACED, at(18, 5))
    assert [t.order_id for t in kitchen.sort_queue([a, b, c], 15)] == [3, 2, 1]


# --- booking -------------------------------------------------------------------


def test_deposit_and_refund():
    s = RestaurantSettings(booking_deposit_pence=500, booking_deposit_per_guest=True, booking_refund_hours=24)
    assert booking.deposit_pence(4, s) == 2000
    assert booking.refund_on_cancel(2000, at(19), at(19) - timedelta(hours=30), s) == 2000
    assert booking.refund_on_cancel(2000, at(19), at(19) - timedelta(hours=2), s) == 0
    assert booking.amount_due_at_end(5400, 2000) == 3400
    assert booking.amount_due_at_end(1500, 2000) == 0


# --- table bookings: no clashes ---------------------------------------------------

T = [booking.TableInfo(1, "1", 2), booking.TableInfo(2, "2", 4), booking.TableInfo(3, "3", 4), booking.TableInfo(4, "10", 6)]


def test_smallest_fitting_table_first():
    free = booking.free_tables(T, [], at(19), 90, 3)
    assert [t.number for t in free] == ["2", "3", "10"]


def test_booked_table_is_not_offered_at_overlapping_times():
    taken = [booking.Taken(2, at(19), at(20, 30))]
    assert [t.number for t in booking.free_tables(T, taken, at(19, 30), 90, 3)] == ["3", "10"]
    assert [t.number for t in booking.free_tables(T, taken, at(18), 90, 3)] == ["3", "10"]  # would run into 7pm
    assert [t.number for t in booking.free_tables(T, taken, at(17, 30), 90, 3)] == ["2", "3", "10"]  # ends as 7pm starts
    assert [t.number for t in booking.free_tables(T, taken, at(20, 30), 90, 3)] == ["2", "3", "10"]  # starts as it ends


def test_full_time_offers_three_nearest_other_times():
    s = RestaurantSettings()
    taken = [booking.Taken(t.id, at(19), at(20, 30)) for t in T]  # every table 7-8:30pm
    avail = booking.availability(DAY, s, T, taken, 2, now=at(10))
    by_time = dict(avail)
    assert by_time[at(19)] == [] and by_time[at(18)] == []  # 6pm would overlap
    assert booking.alternatives(avail, at(19)) == [at(17), at(17, 30), at(20, 30)]


def test_booking_times_respect_hours_and_lead_time():
    s = RestaurantSettings()
    times = booking.booking_times(DAY, s, now=at(13))
    assert times[0] == at(13, 30) and times[-1] == at(21, 30)


def test_evening_shows_no_morning_times_and_past_days_are_empty():
    s = RestaurantSettings()
    times = booking.booking_times(DAY, s, now=at(20))  # 8pm: only 8:30pm onwards (last seating 9:30pm)
    assert times == [at(20, 30), at(21), at(21, 30)]
    assert booking.booking_times(DAY, s, now=at(21, 10)) == []  # too late for today
    assert booking.booking_times(DAY - timedelta(days=1), s, now=at(9)) == []  # yesterday
