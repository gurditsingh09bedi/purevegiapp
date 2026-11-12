"""Create the tables, default settings, the owner account and sample menu/tables.

    python -m app.seed --owner-email owner@example.com --owner-password '...'

New databases get the Pure Vegi leaflet menu (app/menu_data.py).
"""

import argparse

from sqlalchemy import select

from . import menu_import, models
from .db import Base, get_db, get_engine
from .domain.settings import RestaurantSettings
from .security import hash_password
from .services.settings_store import get_settings, save_settings


def run(owner_email: str, owner_password: str) -> None:
    Base.metadata.create_all(get_engine())
    db = next(get_db())
    try:
        save_settings(db, get_settings(db) or RestaurantSettings())
        if not db.scalar(select(models.User).where(models.User.email == owner_email.lower())):
            db.add(models.User(name="Owner", email=owner_email.lower(), role=models.Role.OWNER,
                               password_hash=hash_password(owner_password)))
        if not db.scalar(select(models.Category)):
            db.commit()
            menu_import.run(db)  # the Pure Vegi leaflet menu
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
    print("Seeded with the Pure Vegi menu.")
