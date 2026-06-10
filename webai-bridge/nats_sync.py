# nats_sync.py
import asyncio
import json
import logging
import os
from nats.aio.client import Client as NATS
from database import upsert_user, delete_user_by_external_id

logger = logging.getLogger("nats-sync")
NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN = os.getenv("NATS_TOKEN", "")   # optional — set if Laravel NATS uses token auth

# Track connection state so /health/nats can report it
nats_connected = False

# Laravel role names that map to Bridge "admin"
ADMIN_ROLES = {"super-admin", "admin"}


def _extract_bridge_role(roles: list) -> str:
    """
    Map a list of Laravel role names to a single Bridge role.
    If any role in the list is admin-level → "admin", otherwise → "user".
    """
    for r in roles:
        if r in ADMIN_ROLES:
            return "admin"
    return "user"


def _unwrap(msg):
    """
    Parse a NATS message and unwrap the CloudEvents envelope.
    Returns (inner data dict, event type).
    Raises ValueError if the envelope is malformed.
    """
    envelope = json.loads(msg.data.decode())
    if "data" not in envelope:
        raise ValueError(f"CloudEvents envelope missing 'data' field: {envelope}")
    return envelope["data"], envelope.get("type", "unknown")


# ─── Event Handlers ──────────────────────────────────────────────────────────

async def handle_user_created(msg):
    """auth.v1.user.created → INSERT or UPDATE user in local DB"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} email={data.get('email')}")
        upsert_user(
            external_id=data["user_id"],
            email=data["email"],
            role=_extract_bridge_role(data.get("roles", []))
        )
    except Exception:
        logger.exception("Failed to handle user.created event")


async def handle_user_updated(msg):
    """auth.v1.user.updated → UPDATE email and role in local DB"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} roles={data.get('roles')}")
        upsert_user(
            external_id=data["user_id"],
            email=data["email"],
            role=_extract_bridge_role(data.get("roles", []))
        )
    except Exception:
        logger.exception("Failed to handle user.updated event")


async def handle_user_deleted(msg):
    """auth.v1.user.deleted → DELETE user from local DB (cascades to conversations, assignments)"""
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')}")
        deleted = delete_user_by_external_id(data["user_id"])
        logger.info(f"User removed from local DB: user_id={data['user_id']}, found={deleted}")
    except Exception:
        logger.exception("Failed to handle user.deleted event")


async def handle_role_changed(msg):
    """
    auth.v1.assignment.role.assigned / role.removed
    Role list is not in this event — we re-use upsert_user but only update role.
    Data shape: { "user_id": 42, "role": "admin", "store_id": null }
    """
    try:
        data, event_type = _unwrap(msg)
        logger.info(f"NATS {event_type}: user_id={data.get('user_id')} role={data.get('role')}")
        # We only have the single changed role here, not the full list.
        # Use the event type to decide direction:
        #   assigned → if this role is admin-level, promote
        #   removed  → demote to user (safe fallback — next full sync will correct)
        if "assigned" in event_type:
            role_name = data.get("role", "user")
            bridge_role = "admin" if role_name in ADMIN_ROLES else "user"
        else:
            bridge_role = "user"

        # Update only the role — keep email from existing record
        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET role = %s, synced_at = NOW() WHERE external_id = %s",
            (bridge_role, data["user_id"])
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception:
        logger.exception("Failed to handle role change event")


# ─── Main subscriber task ─────────────────────────────────────────────────────

async def start_nats_sync():
    """
    Connect to NATS and subscribe to user events from Laravel.
    Runs forever as a background asyncio task.
    Auto-reconnects on disconnect.
    """
    global nats_connected
    nc = NATS()

    async def disconnected_cb():
        global nats_connected
        nats_connected = False
        logger.warning("NATS disconnected — user sync paused")

    async def reconnected_cb():
        global nats_connected
        nats_connected = True
        logger.info("NATS reconnected — user sync resumed")

    async def error_cb(e):
        logger.error(f"NATS error: {e}")

    connect_kwargs = dict(
        disconnected_cb=disconnected_cb,
        reconnected_cb=reconnected_cb,
        error_cb=error_cb,
        max_reconnect_attempts=-1,   # retry forever
    )
    if NATS_TOKEN:
        connect_kwargs["token"] = NATS_TOKEN

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(f"NATS connected: {NATS_URL}")

        # Real subject names from Laravel (auth.v1.* pattern)
        await nc.subscribe("auth.v1.user.created",              cb=handle_user_created)
        await nc.subscribe("auth.v1.user.updated",              cb=handle_user_updated)
        await nc.subscribe("auth.v1.user.deleted",              cb=handle_user_deleted)
        await nc.subscribe("auth.v1.assignment.role.assigned",  cb=handle_role_changed)
        await nc.subscribe("auth.v1.assignment.role.removed",   cb=handle_role_changed)

        logger.info("Subscribed to auth.v1.user.* and auth.v1.assignment.role.* events")

        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")


def get_nats_status() -> bool:
    """Returns True if currently connected to NATS. Used by /health/nats."""
    return nats_connected
