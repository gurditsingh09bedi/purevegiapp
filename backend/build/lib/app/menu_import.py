"""Load the Pure Vegi menu (app/menu_data.py) into the database.

    python -m app.menu_import             # replace the menu with the leaflet menu
    python -m app.menu_import --if-sample # only if the database still has the old sample dishes

Old dishes are not deleted (past orders point at them): they move to a hidden "Old menu" category.
Categories with the same name are reused, so their order and visibility settings stay.
"""

import argparse

from sqlalchemy import select

from . import models
from .db import Base, get_db, get_engine
from .menu_data import MENU

ARCHIVE = "Old menu (hidden)"


def build_item(category_id: int, sort: int, d: dict) -> models.MenuItem:
    item = models.MenuItem(category_id=category_id, name=d["name"], description=d.get("description", ""),
                           price_pence=d["price"], is_vegan=d.get("vegan", False), spice_level=d.get("spice", 0),
                           allergens=d.get("allergens", []), sort_order=sort)
    item.option_groups = [
        models.OptionGroup(name=g["name"], min_choices=g.get("min", 0), max_choices=g.get("max", 1),
                           shown_if=g.get("shown_if"), sort_order=i,
                           options=[models.Option(name=n, price_pence=p) for n, p in g["options"]])
        for i, g in enumerate(d.get("groups", []))
    ]
    return item


def has_sample_menu(db) -> bool:
    return bool(db.scalar(select(models.MenuItem).where(models.MenuItem.description == "Sample dish")))


def run(db) -> int:
    archive = db.scalar(select(models.Category).where(models.Category.name == ARCHIVE))
    if archive is None:
        archive = models.Category(name=ARCHIVE, sort_order=999, is_active=False)
        db.add(archive)
        db.flush()
    for item in db.scalars(select(models.MenuItem).where(models.MenuItem.category_id != archive.id)).all():
        item.category_id = archive.id
        item.is_available = False
    names = {name for name, _ in MENU}
    for cat in db.scalars(select(models.Category).where(models.Category.id != archive.id)).all():
        if cat.name not in names:
            cat.is_active = False  # old category with nothing new in it
    count = 0
    for order, (name, dishes) in enumerate(MENU):
        cat = db.scalar(select(models.Category).where(models.Category.name == name))
        if cat is None:
            cat = models.Category(name=name)
            db.add(cat)
        cat.sort_order, cat.is_active = order, True
        db.flush()
        for i, d in enumerate(dishes):
            db.add(build_item(cat.id, i, d))
            count += 1
    db.commit()
    return count


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--if-sample", action="store_true", help="only replace the old sample menu")
    a = p.parse_args()
    Base.metadata.create_all(get_engine())
    try:  # an older development database may lack the newest columns (shown_if, sort_order)
        from .main import _add_missing_columns
        _add_missing_columns(get_engine())
    except Exception as e:  # production uses migrations; carry on
        print(f"(column check skipped: {e})")
    db = next(get_db())
    try:
        if a.if_sample and not has_sample_menu(db):
            print("Menu already set up, nothing to do.")
            return
        print(f"Menu loaded: {run(db)} dishes in {len(MENU)} categories.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
