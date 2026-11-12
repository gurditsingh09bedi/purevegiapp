from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_config


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker[Session] | None = None


def init_engine(url: str | None = None):
    global _engine, _SessionLocal
    url = url or get_config().database_url
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
    _engine = create_engine(url, **kwargs)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_engine():
    return _engine or init_engine()


def get_db() -> Iterator[Session]:
    if _SessionLocal is None:
        init_engine()
    # Endpoints that change data call db.commit() themselves, before any
    # realtime event about the change is published.
    db = _SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
