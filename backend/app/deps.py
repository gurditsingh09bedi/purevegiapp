from collections.abc import Callable
from datetime import datetime

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import AppConfig, get_config
from .db import get_db
from .domain.settings import RestaurantSettings
from .models import ADMIN_ROLES, Role, User, utcnow
from .security import decode_token
from .services.settings_store import get_settings

bearer = HTTPBearer(auto_error=False)


def config() -> AppConfig:
    return get_config()


def settings(db: Session = Depends(get_db)) -> RestaurantSettings:
    return get_settings(db)


def now() -> datetime:
    """Overridden in tests to freeze time."""
    return utcnow()


def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    cfg: AppConfig = Depends(config),
) -> User | None:
    if creds is None:
        return None
    try:
        payload = decode_token(creds.credentials, cfg.jwt_secret)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "please log in again") from None
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account not found")
    return user


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "please log in")
    return user


def require(*roles: Role) -> Callable[..., User]:
    allowed = set(roles) | {Role.OWNER}  # the owner can do everything

    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not allowed for your role")
        return user

    return dep


admin_only = require(*ADMIN_ROLES)
kitchen_staff = require(Role.MANAGER, Role.KITCHEN, Role.WAITER)
drivers = require(Role.MANAGER, Role.DRIVER)
