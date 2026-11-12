from sqlalchemy.orm import Session

from ..domain.settings import RestaurantSettings
from ..models import RestaurantSettingsRow


def get_settings(db: Session) -> RestaurantSettings:
    row = db.get(RestaurantSettingsRow, 1)
    return RestaurantSettings.model_validate(row.data) if row else RestaurantSettings()


def save_settings(db: Session, settings: RestaurantSettings) -> RestaurantSettings:
    row = db.get(RestaurantSettingsRow, 1)
    data = settings.model_dump(mode="json")
    if row is None:
        db.add(RestaurantSettingsRow(id=1, data=data))
    else:
        row.data = data
    return settings
