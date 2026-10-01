"""Pure Vegi API. Run with: uvicorn app.main:app --reload"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from . import models  # noqa: F401  (registers tables)
from .config import get_config
from .db import Base, get_engine
from .realtime import hub, keepalive
from .routers import admin, auth, dine_in, orders, public, push, staff
from .security import decode_token


def _add_missing_columns(engine) -> None:
    """Development only: add columns that are new in the code to an existing test database.
    (create_all makes new tables but never changes existing ones.) Production uses migrations."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have and col.nullable:
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}'))


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_config()
    if not cfg.is_prod:
        engine = get_engine()
        Base.metadata.create_all(engine)  # production uses migrations (Alembic)
        _add_missing_columns(engine)
    yield


app = FastAPI(title="Pure Vegi API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_config().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (public, auth, orders, staff, dine_in, admin, push):
    app.include_router(r.router)


@app.get("/health")
def health():
    return {"ok": True}


# --- Live updates ------------------------------------------------------------------


def _staff_from_token(token: str | None) -> None:
    from .db import get_db
    from .models import STAFF_ROLES, User

    try:
        payload = decode_token(token or "", get_config().jwt_secret)
    except Exception:
        raise WebSocketException(status.WS_1008_POLICY_VIOLATION) from None
    db = next(get_db())
    try:
        user = db.get(User, int(payload["sub"]))
        if user is None or user.role not in STAFF_ROLES:
            raise WebSocketException(status.WS_1008_POLICY_VIOLATION)
    finally:
        db.close()


@app.websocket("/ws/kitchen")
async def ws_kitchen(ws: WebSocket, token: str | None = None):
    """Kitchen screen and front of house: every order change, pauses, table closes."""
    _staff_from_token(token)
    await hub.join("kitchen", ws)
    await keepalive(ws, "kitchen")


@app.websocket("/ws/drivers")
async def ws_drivers(ws: WebSocket, token: str | None = None):
    _staff_from_token(token)
    await hub.join("drivers", ws)
    await keepalive(ws, "drivers")


@app.websocket("/ws/orders/{order_id}")
async def ws_order(ws: WebSocket, order_id: int):
    """A customer's tracking screen: status changes and the driver's position.

    Only ids and statuses are sent here; details come from GET /orders/{id},
    which checks who is asking.
    """
    channel = f"order:{order_id}"
    await hub.join(channel, ws)
    await keepalive(ws, channel)
