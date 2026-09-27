"""Delivery distance and fee: free within the free radius, a flat fee beyond it."""

from __future__ import annotations

from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt

from .settings import RestaurantSettings

EARTH_RADIUS_MILES = 3958.8


class OutsideDeliveryArea(Exception):
    pass


@dataclass(frozen=True)
class DeliveryQuote:
    distance_miles: float
    fee_pence: int

    @property
    def is_free(self) -> bool:
        return self.fee_pence == 0


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance. Road distance from Google Maps can replace it later."""
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(sqrt(a))


def quote(lat: float, lng: float, settings: RestaurantSettings) -> DeliveryQuote:
    miles = round(haversine_miles(settings.latitude, settings.longitude, lat, lng), 2)
    if miles > settings.max_radius_miles:
        raise OutsideDeliveryArea(
            f"{miles:.1f} miles away; we deliver up to {settings.max_radius_miles:g} miles"
        )
    fee = 0 if miles <= settings.free_radius_miles else settings.fee_beyond_free_pence
    return DeliveryQuote(distance_miles=miles, fee_pence=fee)
