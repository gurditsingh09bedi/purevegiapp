"""One-off changes to an existing database, applied once each when the API starts.

Each upgrade has a name; once applied it is recorded in the restaurant settings
(applied_upgrades), so it never runs twice and staff changes made afterwards are kept.
"""

from __future__ import annotations

from datetime import time

from sqlalchemy import select

from . import models
from .menu_data import SAUCE_GROUP, SAUCES, wants_sauce
from .services.settings_store import get_settings, save_settings


def _sauces(db) -> None:
    """Nov 2026: free "choose up to 2 sauces" on burgers, wraps, street food and fries."""
    items = db.scalars(select(models.MenuItem).join(models.Category).where(models.Category.is_active.is_(True))).all()
    for item in items:
        if not wants_sauce(item.category.name, item.name) or any(g.name == SAUCE_GROUP for g in item.option_groups):
            continue
        meal = next((g for g in item.option_groups if g.name == "Make it a meal"), None)
        sort = meal.sort_order if meal else max((g.sort_order for g in item.option_groups), default=-1) + 1
        for g in item.option_groups:
            if g.sort_order >= sort:
                g.sort_order += 1
        item.option_groups.append(models.OptionGroup(
            name=SAUCE_GROUP, min_choices=0, max_choices=2, sort_order=sort,
            options=[models.Option(name=n, price_pence=0) for n in SAUCES]))


def _nov_2026_service(db, s) -> None:
    """Nov 2026: delivery as soon as possible (about 45 min), Friday-Sunday 5pm-10pm; no table booking."""
    s.delivery_days = ["friday", "saturday", "sunday"]
    s.delivery_start, s.delivery_end = time(17), time(22)
    s.delivery_minutes = 45
    s.bookings_enabled = False


UPGRADES = [("sauces-2026-11", lambda db, s: _sauces(db)), ("service-2026-11", _nov_2026_service)]


def apply(db) -> list[str]:
    s = get_settings(db)
    done = []
    for name, fn in UPGRADES:
        if name in s.applied_upgrades:
            continue
        fn(db, s)
        s.applied_upgrades = [*s.applied_upgrades, name]
        done.append(name)
    if done:
        save_settings(db, s)
        db.commit()
    return done
