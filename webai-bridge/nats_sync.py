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
NATS_URL  = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN = os.getenv("NATS_TOKEN", "")
NATS_USER  = os.getenv("NATS_USER", "")
NATS_PASS  = os.getenv("NATS_PASS", "")
NATS_TLS   = os.getenv("NATS_TLS", "false").lower() in ("1", "true", "yes")
DEV_MODE   = os.getenv("DEV_MODE", "0") == "1"

# DEV_MODE switches both the stream and consumer automatically.
# Override with NATS_AUTH_STREAM / NATS_AUTH_DURABLE env vars if needed.
_default_stream  = "AUTH_TESTING_EVENTS"  if DEV_MODE else "AUTH_EVENTS"
_default_durable = "WEBAI_AUTH_TESTING_CONSUMER" if DEV_MODE else "WEBAI_AUTH_CONSUMER"
AUTH_STREAM  = os.getenv("NATS_AUTH_STREAM") or _default_stream
AUTH_DURABLE = os.getenv("NATS_AUTH_DURABLE") or _default_durable
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
    uid = data.get("user_id") or data.get("id")
    if uid:
        try:
            return int(uid)
        except (ValueError, TypeError):
            pass
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
    user_obj = data.get("user", {})
    if isinstance(user_obj, dict):
        return str(user_obj.get("email", ""))
    return str(data.get("email", ""))


def _extract_email_from_updated(data: dict) -> str:
    changed = data.get("changed_fields", {})
    email_delta = changed.get("email", {})
    if isinstance(email_delta, dict):
        return str(email_delta.get("to", ""))
    return str(email_delta) if email_delta else ""


def _extract_roles_from_created(data: dict) -> list:
    roles = data.get("roles", [])
    if isinstance(roles, list):
        return roles
    return []


# ─── Event Handlers ──────────────────────────────────────────────────────────

async def handle_user_created(msg):
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
        upsert_user(id=user_id, email=email, role=_extract_bridge_role(roles))
        await msg.ack()

    except Exception:
        logger.exception("Failed to handle user.created event")
        try:
            await msg.nak()
        except Exception:
            pass


async def handle_user_updated(msg):
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
    try:
        data, event_type = _unwrap(msg)
        user_id = _extract_user_id(data)

        if not user_id:
            logger.error(f"role_changed: cannot extract user_id — raw_data={data}")
            await msg.ack()
            return

        roles = data.get("roles", [])
        if isinstance(roles, dict):
            roles = roles.get("to", [])
        if not isinstance(roles, list):
            roles = []

        logger.info(f"NATS {event_type}: user_id={user_id} roles={roles}")

        bridge_role = "user" if ("removed" in event_type and not roles) else _extract_bridge_role(roles)

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


# ─── Dispatcher — routes all events from the single consumer ─────────────────

async def dispatch_event(msg):
    """
    Single callback for all auth events received from WEBAI_AUTH_CONSUMER.
    Routes to the correct handler based on the message subject.
    """
    subject = msg.subject
    if f"{AUTH_PREFIX}.user.created" in subject:
        await handle_user_created(msg)
    elif f"{AUTH_PREFIX}.user.updated" in subject:
        await handle_user_updated(msg)
    elif f"{AUTH_PREFIX}.user.deleted" in subject:
        await handle_user_deleted(msg)
    elif f"{AUTH_PREFIX}.user.role." in subject:
        await handle_role_changed(msg)
    else:
        logger.warning(f"NATS: unhandled subject '{subject}' — acking to skip")
        await msg.ack()


# ─── Main JetStream subscriber ───────────────────────────────────────────────

async def start_nats_sync():
    """
    Connect to NATS JetStream and subscribe to all auth user events
    through a single durable consumer (WEBAI_AUTH_CONSUMER).
    Missed messages are replayed on reconnect via the durable bookmark.
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
        logger.error(f"NATS error: {type(e).__name__}: {e}")

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
        connect_kwargs["tls_handshake_first"] = True

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(
            f"NATS connected: {NATS_URL} | dev_mode={DEV_MODE} | "
            f"stream={AUTH_STREAM} | consumer={AUTH_DURABLE}"
        )

        js = nc.jetstream()

        await js.subscribe(
            f"{AUTH_PREFIX}.>",
            stream=AUTH_STREAM,
            durable=AUTH_DURABLE,
            cb=dispatch_event,
        )

        logger.info(
            f"JetStream subscribed | stream={AUTH_STREAM} | "
            f"consumer={AUTH_DURABLE} | prefix={AUTH_PREFIX}"
        )

        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")


def get_nats_status() -> bool:
    """Returns True if currently connected to NATS. Used by /health/nats."""
    return nats_connected
