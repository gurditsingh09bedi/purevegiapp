"""Create the tables, default settings, the owner account and sample menu/tables.

    python -m app.seed --owner-email owner@example.com --owner-password '...'

The sample dishes are placeholders until the new Pure Vegi menu arrives.
"""

import argparse

from sqlalchemy import select

from . import models
from .db import Base, get_db, get_engine
from .domain.settings import RestaurantSettings
from .security import hash_password
from .services.settings_store import get_settings, save_settings

SAMPLE_MENU = {
    "Burgers": [("Classic Veggie Burger", 850, True), ("Paneer Tikka Burger", 950, False)],
    "Wraps": [("Falafel Wrap", 750, True), ("Spicy Paneer Wrap", 800, False)],
    "Noodles": [("Veg Hakka Noodles", 800, True)],
    "Stir Fry": [("Chilli Garlic Stir Fry", 850, True)],
}


def run(owner_email: str, owner_password: str) -> None:
    Base.metadata.create_all(get_engine())
    db = next(get_db())
    try:
        save_settings(db, get_settings(db) or RestaurantSettings())
        if not db.scalar(select(models.User).where(models.User.email == owner_email.lower())):
            db.add(models.User(name="Owner", email=owner_email.lower(), role=models.Role.OWNER,
                               password_hash=hash_password(owner_password)))
        if not db.scalar(select(models.Category)):
            for i, (cat, dishes) in enumerate(SAMPLE_MENU.items()):
                c = models.Category(name=cat, sort_order=i)
                c.items = [models.MenuItem(name=n, price_pence=p, is_vegan=v, description="Sample dish")
                           for n, p, v in dishes]
                db.add(c)
        if not db.scalar(select(models.DiningTable)):
            db.add_all(models.DiningTable(number=str(n), seats=4) for n in range(1, 11))
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--owner-email", required=True)
    p.add_argument("--owner-password", required=True)
    a = p.parse_args()
    run(a.owner_email, a.owner_password)
    print("Seeded. Sample menu is a placeholder until the real menu is added.")
