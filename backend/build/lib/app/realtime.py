"""Live updates over WebSockets.

Channels: ``kitchen`` (kitchen screen and front of house), ``drivers`` and
``order:<id>`` (one customer's tracking screen).

Events are collected in an ``Outbox`` while a request runs and published
after the response, once the database change is committed. This in-process
hub works for one server; with several servers, swap ``publish`` for Redis
pub/sub.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import BackgroundTasks, WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)

    async def join(self, channel: str, ws: WebSocket) -> None:
        await ws.accept()
        self._channels[channel].add(ws)

    def leave(self, channel: str, ws: WebSocket) -> None:
        self._channels[channel].discard(ws)

    async def publish(self, channel: str, payload: dict) -> None:
        dead = []
        for ws in list(self._channels.get(channel, ())):
            try:
                await ws.send_json(payload)
            except Exception:  # client went away
                dead.append(ws)
        for ws in dead:
            self.leave(channel, ws)


hub = Hub()


@dataclass
class Outbox:
    events: list[tuple[str, dict]] = field(default_factory=list)

    def add(self, channel: str, payload: dict) -> None:
        self.events.append((channel, payload))

    async def flush(self) -> None:
        for channel, payload in self.events:
            try:
                await hub.publish(channel, payload)
            except Exception:
                log.exception("failed to publish to %s", channel)
        self.events.clear()


def get_outbox(background: BackgroundTasks) -> Outbox:
    """FastAPI dependency: events are published after the response is sent."""
    box = Outbox()
    background.add_task(box.flush)
    return box


async def keepalive(ws: WebSocket, channel: str) -> None:
    """Hold a socket open until the client disconnects (clients only listen)."""
    try:
        while True:
            await asyncio.wait_for(ws.receive_text(), timeout=60)
    except Exception:
        hub.leave(channel, ws)
