"""Realtime channel: pushes rows of realtime_events (written by backend and worker) to the browser."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import COOKIE, origin_allowed
from app.core.time import iso
from app.database.database import SessionLocal
from app.database.models import RealtimeEvent
from app.services import sessions

log = logging.getLogger(__name__)
router = APIRouter()


def _check_session(token: str | None) -> bool:
    with SessionLocal() as db:
        return sessions.get_valid(db, token) is not None


def _max_id() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.max(RealtimeEvent.id))) or 0


def _fetch(after: int) -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(select(RealtimeEvent).where(RealtimeEvent.id > after).order_by(RealtimeEvent.id).limit(200)).all()
        return [{"id": r.id, "type": r.type, "payload": r.payload, "at": iso(r.created_at)} for r in rows]


@router.websocket("/ws/events")
async def events_ws(ws: WebSocket):
    token = ws.cookies.get(COOKIE)
    if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host")) or not await run_in_threadpool(_check_session, token):
        await ws.close(code=4401)
        return
    await ws.accept()
    last = await run_in_threadpool(_max_id)
    ticks = 0
    try:
        while True:
            for ev in await run_in_threadpool(_fetch, last):
                last = ev["id"]
                await ws.send_json(ev)
            await asyncio.sleep(1)
            ticks += 1
            if ticks % 60 == 0 and not await run_in_threadpool(_check_session, token):
                await ws.close(code=4401)
                return
            if ticks % 25 == 0:
                await ws.send_json({"id": 0, "type": "ping", "payload": {}})
    except (WebSocketDisconnect, RuntimeError):
        return
