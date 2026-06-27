# nats_sync.py
import asyncio
import json
import logging
import os
import ssl
from nats.aio.client import Client as NATS
from database import upsert_user, delete_user_by_external_id

logger = logging.getLogger("nats-sync")

# ─── Config from .env ────────────────────────────────────────────────────────
NATS_URL     = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN   = os.getenv("NATS_TOKEN", "")
NATS_USER    = os.getenv("NATS_USER", "")
NATS_PASS    = os.getenv("NATS_PASS", "")
NATS_TLS     = os.getenv("NATS_TLS", "false").lower() in ("1", "true", "yes")
DEV_MODE     = os.getenv("DEV_MODE", "0") == "1"
AUTH_STREAM  = os.getenv("NATS_AUTH_STREAM", "AUTH_EVENTS")
AUTH_DURABLE = os.getenv("NATS_AUTH_DURABLE", "WEBAI_BRIDGE_AUTH_CONSUMER")
AUTH_PREFIX  = "auth.testing.v1" if DEV_MODE else "auth.v1"

# Track connection state for /health/nats endpoint
nats_connected = False

# Laravel role names that map to Bridge "admin"
ADMIN_ROLES = {"super-admin", "admin"}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _extract_bridge_role(roles: list) -> str:
    for r in roles:
        if r in ADMIN_ROLES:
            return "admin"
    return "user"


def _unwrap(msg) -> tuple:
    """Parse NATS message and return (data_dict, event_type_string)."""
    envelope = json.loads(msg.data.decode())
    if "data" not in envelope:
        raise ValueError(f"CloudEvents envelope missing 'data' field: {envelope}")
    return envelope["data"], envelope.get("type", "unknown")


def _extract_user_id(data: dict) -> int:
    """
    Extract user ID from payload.
    user.created sends: data.user.id  (nested)
    user.updated sends: data.user_id  (flat)
    user.deleted sends: data.user_id  (flat)
    """
    # Try flat: data.user_id or data.id
    uid = data.get("user_id") or data.get("id")
    if uid:
        try:
            return int(uid)
        except (ValueError, TypeError):
            pass

    # Try nested: data.user.id  (used by user.created)
    user_obj = data.get("user", {})
    if isinstance(user_obj, dict):
        uid = user_obj.get("id")
        if uid:
            try:
                return int(uid)
            except (ValueError, TypeError):
                pass
    return 0


def _extract_email_from_created(data: dict) -> str:
    """Extract email from user.created: data.user.email"""
    user_obj = data.get("user", {})
    if isinstance(user_obj, dict):
        return str(user_obj.get("email", ""))
    return str(data.get("email", ""))


def _extract_email_from_updated(data: dict) -> str:
    """
    Extract new email from user.updated: data.changed_fields.email.to
    Returns empty string if email was not changed in this event.
    """
    changed = data.get("changed_fields", {})
    email_delta = changed.get("email", {})
    if isinstance(email_delta, dict):
        return str(email_delta.get("to", ""))
    return str(email_delta) if email_delta else ""


def _extract_roles_from_created(data: dict) -> list:
    """Extract roles from user.created: data.roles = ["user", "admin"]"""
    roles = data.get("roles", [])
    if isinstance(roles, list):
        return roles
    return []


# ─── Event Handlers ──────────────────────────────────────────────────────────

async def handle_user_created(msg):
    """auth.v1.user.created → INSERT or UPDATE user in local DB"""
    try:
        data, event_type = _unwrap(msg)

        user_id = _extract_user_id(data)
        email   = _extract_email_from_created(data)
        roles   = _extract_roles_from_created(data)

        if not user_id or not email:
            logger.error(
                f"user.created: cannot extract user_id or email — "
                f"user_id={user_id} email={repr(email)} raw_data={data}"
            )
            await msg.nak()
            return

        logger.info(f"NATS {event_type}: user_id={user_id} email={email} roles={roles}")
        upsert_user(
            id=user_id,
            email=email,
            role=_extract_bridge_role(roles)
        )
        await msg.ack()

    except Exception:
        logger.exception("Failed to handle user.created event")
        try:
            await msg.nak()
        except Exception:
            pass


async def handle_user_updated(msg):
    """auth.v1.user.updated → UPDATE email in local DB if it changed"""
    try:
        data, event_type = _unwrap(msg)

        user_id   = _extract_user_id(data)
        new_email = _extract_email_from_updated(data)

        if not user_id:
            logger.error(f"user.updated: cannot extract user_id — raw_data={data}")
            await msg.nak()
            return

        logger.info(
            f"NATS {event_type}: user_id={user_id} "
            f"changed_fields={list(data.get('changed_fields', {}).keys())}"
        )

        if new_email:
            upsert_user(id=user_id, email=new_email, role="user")
        else:
            logger.info(f"user.updated: no email change for user_id={user_id}, skipping")

        await msg.ack()

    except Exception:
        logger.exception("Failed to handle user.updated event")
        try:
            await msg.nak()
        except Exception:
            pass


async def handle_user_deleted(msg):
    """auth.v1.user.deleted → DELETE user from local DB"""
    try:
        data, event_type = _unwrap(msg)

        user_id = _extract_user_id(data)

        if not user_id:
            logger.error(f"user.deleted: cannot extract user_id — raw_data={data}")
            await msg.nak()
            return

        logger.info(f"NATS {event_type}: user_id={user_id}")
        deleted = delete_user_by_external_id(user_id)
        logger.info(f"User removed from local DB: user_id={user_id} found={deleted}")
        await msg.ack()

    except Exception:
        logger.exception("Failed to handle user.deleted event")
        try:
            await msg.nak()
        except Exception:
            pass


async def handle_role_changed(msg):
    """
    auth.v1.user.role.assigned / role.removed / role.synced
    Pizzasys sends: data.user_id, data.roles = ["admin"] or {"from":[], "to":[], ...}
    """
    try:
        data, event_type = _unwrap(msg)

        user_id = _extract_user_id(data)
        if not user_id:
            logger.error(f"role_changed: cannot extract user_id — raw_data={data}")
            await msg.ack()
            return

        roles = data.get("roles", [])

        # For synced events, roles is a delta dict — use the final "to" list
        if isinstance(roles, dict):
            roles = roles.get("to", [])

        if not isinstance(roles, list):
            roles = []

        logger.info(f"NATS {event_type}: user_id={user_id} roles={roles}")

        if "removed" in event_type and not roles:
            bridge_role = "user"
        else:
            bridge_role = _extract_bridge_role(roles)

        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET role = %s, synced_at = NOW() WHERE id = %s",
            (bridge_role, user_id)
        )
        conn.commit()
        cursor.close()
        conn.close()
        await msg.ack()

    except Exception:
        logger.exception("Failed to handle role change event")
        try:
            await msg.nak()
        except Exception:
            pass


# ─── Stream setup ────────────────────────────────────────────────────────────

async def _ensure_stream(js):
    """Create AUTH_EVENTS stream if it doesn't exist. Safe to call every startup."""
    try:
        await js.stream_info(AUTH_STREAM)
        logger.info(f"NATS stream '{AUTH_STREAM}' already exists")
    except Exception:
        logger.info(f"NATS stream '{AUTH_STREAM}' not found — creating it now")
        await js.add_stream(
            name=AUTH_STREAM,
            subjects=["auth.v1.>", "auth.testing.v1.>"],
        )
        logger.info(f"NATS stream '{AUTH_STREAM}' created")


# ─── Main JetStream subscriber ───────────────────────────────────────────────

async def start_nats_sync():
    """
    Connect to NATS JetStream and subscribe to auth user events.
    Uses durable consumer — missed messages are replayed on reconnect.
    Runs forever as a background asyncio task.
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

    # Build auth options — token takes priority, then user+pass, then no auth
    connect_kwargs = dict(
        disconnected_cb=disconnected_cb,
        reconnected_cb=reconnected_cb,
        error_cb=error_cb,
        max_reconnect_attempts=-1,
    )

    if NATS_TOKEN:
        connect_kwargs["token"] = NATS_TOKEN
    elif NATS_USER and NATS_PASS:
        connect_kwargs["user"]     = NATS_USER
        connect_kwargs["password"] = NATS_PASS

    if NATS_TLS:
        tls_ctx = ssl.create_default_context()
        connect_kwargs["tls"] = tls_ctx

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(f"NATS connected: {NATS_URL} | dev_mode={DEV_MODE} | stream={AUTH_STREAM}")

        js = nc.jetstream()

        # Create stream if it doesn't exist yet
        await _ensure_stream(js)

        await js.subscribe(
            f"{AUTH_PREFIX}.user.created",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_CREATED",
            cb=handle_user_created,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.updated",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_UPDATED",
            cb=handle_user_updated,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.deleted",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_DELETED",
            cb=handle_user_deleted,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.role.assigned",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_ROLE_ASSIGNED",
            cb=handle_role_changed,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.role.removed",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_ROLE_REMOVED",
            cb=handle_role_changed,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.role.synced",
            stream=AUTH_STREAM,
            durable=f"{AUTH_DURABLE}_ROLE_SYNCED",
            cb=handle_role_changed,
        )

        logger.info(
            f"JetStream subscribed | stream={AUTH_STREAM} | "
            f"prefix={AUTH_PREFIX} | durable_base={AUTH_DURABLE}"
        )

        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")


def get_nats_status() -> bool:
    """Returns True if currently connected to NATS. Used by /health/nats."""
    return nats_connected
