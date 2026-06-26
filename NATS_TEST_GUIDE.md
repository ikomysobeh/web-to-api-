# NATS Full Testing Guide

How to test the complete pipeline locally before going to production.
Also includes a reusable Docker setup for any future project that uses NATS.

---

## Table of Contents

1. [What We Now Know — Exact Payload Formats](#1-exact-payload-formats)
2. [How the Test Will Work](#2-how-the-test-will-work)
3. [Step 1 — Start Local NATS Server](#3-step-1--start-local-nats-server)
4. [Step 2 — Create the Stream and Consumer](#4-step-2--create-stream-and-consumer)
5. [Step 3 — Configure Pizzasys to Publish Here](#5-step-3--configure-pizzasys)
6. [Step 4 — Configure Our Bridge to Consume Here](#6-step-4--configure-our-bridge)
7. [Step 5 — Run the Test](#7-step-5--run-the-test)
8. [Step 6 — Verify Everything Worked](#8-step-6--verify-everything-worked)
9. [The Bug We Found — Fix nats_sync.py](#9-the-bug-we-found--fix-nats_syncpy)
10. [Reusable Docker Template for Future Projects](#10-reusable-docker-template)
11. [Quick Reference Card](#11-quick-reference-card)

---

## 1. Exact Payload Formats

We read the pizzasys source code. Now we know the exact JSON it sends.
**This solved the mystery from the previous guide.**

### `auth.v1.user.created`

```json
{
  "specversion": "1.0",
  "id": "01JBXXXXXXXXXXXXX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "auth.v1.user.created",
  "time": "2026-06-11T10:00:00Z",
  "datacontenttype": "application/json",
  "data": {
    "user": {
      "id": 42,
      "name": "Ali Hassan",
      "email": "ali@example.com",
      "email_verified_at": "2026-06-11T10:00:00Z",
      "created_at": "2026-06-11T10:00:00Z",
      "updated_at": "2026-06-11T10:00:00Z"
    },
    "roles": ["user"],
    "permissions_direct": []
  }
}
```

**Key point:** The user's `id` and `email` are INSIDE `data.user.id` and `data.user.email`.
Our Python currently reads `data["user_id"]` and `data["email"]` — **BOTH WRONG**.
Fix is in Section 9.

---

### `auth.v1.user.updated`

```json
{
  "data": {
    "user_id": 42,
    "changed_fields": {
      "name":  { "from": "Ali Hassan", "to": "Ali H" },
      "email": { "from": "ali@old.com", "to": "ali@new.com" }
    }
  }
}
```

**Key point:** `data.user_id` is flat here (not nested). `data.changed_fields` is a delta.

---

### `auth.v1.user.deleted`

```json
{
  "data": {
    "user_id": 42,
    "email": "ali@example.com",
    "deleted_at": "2026-06-11T10:05:00Z"
  }
}
```

**Key point:** `data.user_id` flat. Our Python reads this correctly already.

---

### `auth.v1.user.role.assigned` / `role.removed`

```json
{
  "data": {
    "user_id": 42,
    "roles": ["admin"]
  }
}
```

---

## 2. How the Test Will Work

```
YOUR LAPTOP — all local, all Docker

┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  pizzasys (XAMPP / PHP)      NATS Server (Docker)              │
│  C:\xampp\htdocs\projacet\   localhost:4222                    │
│  pizzasys                    JetStream enabled                  │
│                              AUTH_EVENTS stream                 │
│  When you create a user:                                        │
│  → publishes to localhost:4222                                  │
│  → event lands in AUTH_EVENTS stream                            │
│                                     │                           │
│                                     ▼                           │
│                          Our Bridge (Docker)                    │
│                          reads from AUTH_EVENTS                 │
│                          writes to PostgreSQL                   │
│                                                                 │
│  You verify: user exists in our PostgreSQL DB ← success        │
│                                                                 │
│  NATS Monitoring UI: http://localhost:8222                      │
│  (shows messages, streams, consumers in browser)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Prerequisites:**
- Docker running (you already use this)
- pizzasys running in XAMPP (C:\xampp\htdocs\projacet\pizzasys)
- Our bridge project at C:\New folder

---

## 3. Step 1 — Start Local NATS Server

### Option A — Add to your existing docker-compose.yml (recommended)

Open `C:\New folder\docker-compose.yml` and add this service:

```yaml
  nats:
    image: nats:latest
    container_name: webai-nats
    command: ["--jetstream", "--store_dir=/data", "--http_port=8222"]
    ports:
      - "4222:4222"   # NATS client port (apps connect here)
      - "8222:8222"   # NATS monitoring web UI
    volumes:
      - nats_data:/data
    networks:
      - webai-network

volumes:
  nats_data:
```

Then start it:
```bash
docker compose up -d nats
```

### Option B — Run it standalone (if you don't want to touch docker-compose.yml)

```bash
docker run -d \
  --name webai-nats-test \
  -p 4222:4222 \
  -p 8222:8222 \
  nats:latest --jetstream --http_port=8222
```

### Verify NATS is running

Open your browser: **http://localhost:8222**

You should see a NATS monitoring page with stats.

Also test with:
```bash
docker exec webai-nats nats-server --version
```

---

## 4. Step 2 — Create the Stream and Consumer

NATS needs to know about the `AUTH_EVENTS` stream before anyone can publish or
subscribe. We use `nats-box` — a small CLI tool for managing NATS.

### 4a — Open a nats-box shell

```bash
docker run -it --rm --network host natsio/nats-box
```

You are now inside a container with the NATS CLI. The `--network host` lets it
connect to your localhost:4222.

### 4b — Create the AUTH_EVENTS stream

```bash
nats stream add AUTH_EVENTS \
  --subjects "auth.v1.>" \
  --storage file \
  --retention limits \
  --max-msgs=-1 \
  --max-age=24h \
  --replicas=1 \
  --defaults
```

**What this means:**
- `AUTH_EVENTS` — the stream name (must match `NATS_AUTH_STREAM` in .env)
- `auth.v1.>` — capture ALL subjects starting with `auth.v1.` (> = wildcard for everything after)
- `storage file` — save messages to disk (survives NATS restart)
- `max-age=24h` — keep messages for 24 hours (enough for testing)

### 4c — Create the durable consumer for our bridge

```bash
nats consumer add AUTH_EVENTS WEBAI_BRIDGE_AUTH_CONSUMER \
  --pull \
  --durable WEBAI_BRIDGE_AUTH_CONSUMER \
  --deliver all \
  --ack explicit \
  --filter "auth.v1.>" \
  --defaults
```

**What this means:**
- `WEBAI_BRIDGE_AUTH_CONSUMER` — our consumer name (must match `NATS_AUTH_DURABLE`)
- `--pull` — pull mode (HiringPizza uses pull; we will switch to push, but the consumer type is set server-side)
- `--deliver all` — deliver ALL messages from the beginning (so replay works)
- `--ack explicit` — we must ACK each message (no auto-ACK)

### 4d — Verify stream and consumer exist

```bash
nats stream ls         # should show AUTH_EVENTS
nats consumer ls AUTH_EVENTS   # should show WEBAI_BRIDGE_AUTH_CONSUMER
```

Type `exit` to leave the nats-box container.

---

## 5. Step 3 — Configure Pizzasys

Pizzasys needs to know to publish to your LOCAL NATS instead of production.

### Edit `C:\xampp\htdocs\projacet\pizzasys\.env`

Find these lines and set them:

```env
NATS_HOST=127.0.0.1
NATS_PORT=4222
# No token needed for local NATS (no auth configured)
NATS_TOKEN=
NATS_USER=
NATS_PASS=
NATS_AUTH_STREAM=AUTH_EVENTS
```

**Important:** Local NATS has no authentication by default. Leave token/user/pass empty.

### Start the Laravel queue worker

The pizzasys outbox pattern works like this:
1. API creates user → saves to `auth_outbox_events` table
2. Queue job runs → reads from that table → publishes to NATS

You need the queue worker running to actually publish events:

```bash
cd C:\xampp\htdocs\projacet\pizzasys
php artisan queue:listen --tries=3
```

Keep this terminal open. You will see output each time an event is published.

---

## 6. Step 4 — Configure Our Bridge

Our bridge needs to point to the local NATS and use JetStream.

**First apply the code fix** (Section 9 explains what changed and why).
Then update the `.env`:

### Edit `C:\New folder\webai-bridge\.env`

Add/update these lines:

```env
NATS_URL=nats://localhost:4222
NATS_TOKEN=
NATS_USER=
NATS_PASS=
NATS_AUTH_STREAM=AUTH_EVENTS
NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER
DEV_MODE=0
```

If running the bridge inside Docker (which it is), use the Docker network name:

```env
# If NATS is in the same docker-compose:
NATS_URL=nats://webai-nats:4222

# If NATS is running standalone with --network host:
NATS_URL=nats://host.docker.internal:4222
```

### Restart the bridge

```bash
docker compose up --build bridge
```

Check it connected:
```bash
docker logs webai-bridge --tail 30
# Should see: "NATS connected: nats://..."
# Should see: "JetStream subscribed on stream=AUTH_EVENTS"
```

---

## 7. Step 5 — Run the Test

Now trigger real events from pizzasys.

### Test A — Create a user

Use Postman or curl to call the pizzasys API:

```bash
curl -X POST http://localhost/projacet/pizzasys/public/api/v1/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test NATS User",
    "email": "nats-test@example.com",
    "password": "password123",
    "roles": ["user"]
  }'
```

What happens next (in order):
1. Pizzasys creates the user in MySQL
2. Pizzasys writes to `auth_outbox_events` table
3. Queue worker picks it up (watch the terminal)
4. Queue worker publishes `auth.v1.user.created` to NATS
5. NATS delivers it to our bridge consumer
6. Our bridge calls `handle_user_created()`
7. Our bridge writes user to PostgreSQL

### Test B — Update a user (use the ID from Test A)

```bash
curl -X PUT http://localhost/projacet/pizzasys/public/api/v1/users/42 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated NATS User"
  }'
```

### Test C — Delete a user

```bash
curl -X DELETE http://localhost/projacet/pizzasys/public/api/v1/users/42 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Test D — Crash test (the most important test)

This proves JetStream works correctly:

```bash
# 1. Stop the bridge
docker compose stop bridge

# 2. Create 2 more users in pizzasys (via API)
#    Events will be published to NATS but nobody is consuming yet

# 3. Start the bridge again
docker compose start bridge

# 4. Watch the bridge logs
docker logs webai-bridge -f --tail 20
# Should see the 2 missed users being processed immediately
```

If both users appear in PostgreSQL → JetStream is working.
If they don't → we still have core NATS (something went wrong with the fix).

---

## 8. Step 6 — Verify Everything Worked

### Check via PostgreSQL

Connect to the bridge's PostgreSQL and run:

```sql
-- See all NATS-synced users (external_id is set for NATS users)
SELECT id, email, role, external_id, synced_at
FROM users
WHERE external_id IS NOT NULL
ORDER BY synced_at DESC;
```

You should see the users you created in pizzasys.

### Check via NATS monitoring UI

Open: **http://localhost:8222/jsz?streams=true&consumers=true**

You will see:
- `AUTH_EVENTS` stream → how many messages received
- `WEBAI_BRIDGE_AUTH_CONSUMER` → how many messages pending / delivered / ACKed

A healthy consumer shows:
```
num_pending: 0        ← all messages processed
num_ack_pending: 0    ← no messages waiting for ACK
```

### Check via bridge logs

```bash
docker logs webai-bridge --tail 50
```

Look for:
```
INFO: NATS auth.v1.user.created: user_id=42 email=nats-test@example.com
INFO: NATS auth.v1.user.updated: user_id=42
INFO: NATS auth.v1.user.deleted: user_id=42
```

No `KeyError` or `Failed to handle` lines = success.

---

## 9. The Bug We Found — Fix nats_sync.py

By reading the pizzasys source code, we found 3 bugs in our Python code.

### Bug 1 — `user.created` payload path is wrong

```
Pizzasys sends:
  data.user.id    ← nested inside data.user object
  data.user.email ← nested inside data.user object
  data.roles      ← array of role name strings

Our Python reads:
  data["user_id"] ← WRONG — this key does not exist
  data["email"]   ← WRONG — this key does not exist
```

### Bug 2 — `user.updated` doesn't extract email from changed_fields

```
Pizzasys sends:
  data.user_id                          ← the user's ID
  data.changed_fields.email.to          ← the new email value

Our Python reads:
  data["user_id"]   ← correct ✓
  data["email"]     ← WRONG — this key does not exist in user.updated
```

For `user.updated` we should read the new email from `changed_fields`, not
from a flat `email` field.

### Bug 3 — Core NATS instead of JetStream

Already explained in the comparison guide. Messages are lost when bridge restarts.

---

### The Fixed `nats_sync.py`

Replace the entire contents of `C:\New folder\webai-bridge\nats_sync.py`:

```python
# nats_sync.py
import asyncio
import json
import logging
import os
from nats.aio.client import Client as NATS
from database import upsert_user, delete_user_by_external_id

logger = logging.getLogger("nats-sync")

# ─── Config from .env ────────────────────────────────────────────────────────
NATS_URL     = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN   = os.getenv("NATS_TOKEN", "")
NATS_USER    = os.getenv("NATS_USER", "")
NATS_PASS    = os.getenv("NATS_PASS", "")
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
    This function handles both.
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
    """
    Extract email from user.created event.
    Pizzasys sends: data.user.email
    """
    user_obj = data.get("user", {})
    if isinstance(user_obj, dict):
        return str(user_obj.get("email", ""))
    return str(data.get("email", ""))


def _extract_email_from_updated(data: dict) -> str:
    """
    Extract new email from user.updated event.
    Pizzasys sends: data.changed_fields.email.to
    Returns empty string if email was not changed.
    """
    changed = data.get("changed_fields", {})
    email_delta = changed.get("email", {})
    if isinstance(email_delta, dict):
        return str(email_delta.get("to", ""))
    return str(email_delta) if email_delta else ""


def _extract_roles_from_created(data: dict) -> list:
    """
    Extract roles from user.created event.
    Pizzasys sends: data.roles = ["user", "admin"]
    """
    roles = data.get("roles", [])
    if isinstance(roles, list):
        return roles
    return []


# ─── Event Handlers ──────────────────────────────────────────────────────────

async def handle_user_created(msg):
    """auth.v1.user.created → INSERT or UPDATE user in local DB"""
    try:
        data, event_type = _unwrap(msg)

        user_id = _extract_user_id(data)     # reads data.user.id
        email   = _extract_email_from_created(data)  # reads data.user.email
        roles   = _extract_roles_from_created(data)  # reads data.roles

        if not user_id or not email:
            logger.error(
                f"user.created: cannot extract user_id or email. "
                f"user_id={user_id} email={repr(email)} raw_data={data}"
            )
            await msg.nak()
            return

        logger.info(f"NATS {event_type}: user_id={user_id} email={email} roles={roles}")
        upsert_user(
            external_id=user_id,
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
    """auth.v1.user.updated → UPDATE email in local DB (only if email changed)"""
    try:
        data, event_type = _unwrap(msg)

        user_id   = _extract_user_id(data)           # reads data.user_id (flat)
        new_email = _extract_email_from_updated(data) # reads data.changed_fields.email.to

        if not user_id:
            logger.error(f"user.updated: cannot extract user_id. raw_data={data}")
            await msg.nak()
            return

        logger.info(
            f"NATS {event_type}: user_id={user_id} "
            f"changed_fields={list(data.get('changed_fields', {}).keys())}"
        )

        if new_email:
            # Email changed — update it in our DB
            upsert_user(
                external_id=user_id,
                email=new_email,
                role="user"  # role is preserved by upsert ON CONFLICT
            )
        else:
            # No email change in this event (e.g. only name changed)
            # We don't store name, so nothing to do
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

        user_id = _extract_user_id(data)  # reads data.user_id

        if not user_id:
            logger.error(f"user.deleted: cannot extract user_id. raw_data={data}")
            await msg.nak()
            return

        logger.info(f"NATS {event_type}: user_id={user_id}")
        deleted = delete_user_by_external_id(user_id)
        logger.info(f"User removed from local DB: user_id={user_id}, found={deleted}")
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
    Pizzasys sends: data.user_id, data.roles = ["admin", "user"]
    """
    try:
        data, event_type = _unwrap(msg)

        user_id = _extract_user_id(data)
        if not user_id:
            logger.error(f"role_changed: cannot extract user_id. raw_data={data}")
            await msg.ack()
            return

        roles = data.get("roles", [])

        # For synced events, roles is a dict {from, to, added, removed}
        # We want the final list
        if isinstance(roles, dict):
            roles = roles.get("to", [])

        if not isinstance(roles, list):
            roles = []

        logger.info(f"NATS {event_type}: user_id={user_id} roles={roles}")

        if "removed" in event_type and not roles:
            # All roles removed → downgrade to user
            bridge_role = "user"
        else:
            bridge_role = _extract_bridge_role(roles)

        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET role = %s, synced_at = NOW() WHERE external_id = %s",
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

    # Build auth options — token takes priority, then user+pass
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
    # else: no auth (fine for local development)

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(f"NATS connected: {NATS_URL} | dev_mode={DEV_MODE} | stream={AUTH_STREAM}")

        # Get JetStream context
        js = nc.jetstream()

        # Subscribe with durable consumer
        # durable = server remembers our position after restart
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

        # Keep alive — the callbacks handle all events
        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")


def get_nats_status() -> bool:
    """Returns True if currently connected to NATS. Used by /health/nats."""
    return nats_connected
```

---

## 10. Reusable Docker Template

This is a standalone NATS test environment you can use for any future project.
Copy and reuse it.

### `docker-compose.nats-test.yml`

This file lives at `C:\New folder\docker-compose.nats-test.yml`.

```yaml
version: "3.9"

# Standalone NATS test environment.
# Start with: docker compose -f docker-compose.nats-test.yml up -d
# Stop with:  docker compose -f docker-compose.nats-test.yml down

services:

  nats:
    image: nats:latest
    container_name: nats-test-server
    command: >
      --jetstream
      --store_dir=/data
      --http_port=8222
      --name=nats-test
    ports:
      - "4222:4222"    # Client connections
      - "8222:8222"    # Monitoring UI
    volumes:
      - nats_test_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8222/healthz"]
      interval: 5s
      timeout: 3s
      retries: 5

  # NATS setup — runs once to create streams and consumers
  nats-setup:
    image: natsio/nats-box:latest
    container_name: nats-test-setup
    depends_on:
      nats:
        condition: service_healthy
    # Creates AUTH_EVENTS stream and consumer, then exits
    entrypoint: /bin/sh
    command: |
      -c "
        set -e
        echo 'Creating AUTH_EVENTS stream...'
        nats --server nats:4222 stream add AUTH_EVENTS \
          --subjects 'auth.v1.>' \
          --storage file \
          --retention limits \
          --max-msgs=-1 \
          --max-age=24h \
          --replicas=1 \
          --defaults 2>/dev/null || echo 'Stream already exists'

        echo 'Creating WEBAI_BRIDGE durable consumers...'
        for SUFFIX in CREATED UPDATED DELETED ROLE_ASSIGNED ROLE_REMOVED ROLE_SYNCED; do
          nats --server nats:4222 consumer add AUTH_EVENTS WEBAI_BRIDGE_AUTH_CONSUMER_$SUFFIX \
            --pull \
            --durable WEBAI_BRIDGE_AUTH_CONSUMER_$SUFFIX \
            --deliver all \
            --ack explicit \
            --filter 'auth.v1.>' \
            --defaults 2>/dev/null || echo \"Consumer \$SUFFIX already exists\"
        done

        echo 'NATS setup complete!'
        nats --server nats:4222 stream ls
        nats --server nats:4222 consumer ls AUTH_EVENTS
      "

volumes:
  nats_test_data:
```

### How to use this template for any future project

1. Copy `docker-compose.nats-test.yml` to your new project
2. Change `WEBAI_BRIDGE_AUTH_CONSUMER` to your new project's consumer name
3. Change `auth.v1.>` to your project's subject pattern if different
4. Start with: `docker compose -f docker-compose.nats-test.yml up -d`
5. NATS is ready at `localhost:4222`

---

## 11. Quick Reference Card

### Start everything for testing

```bash
# 1. Start NATS
docker compose up -d nats

# 2. Create stream + consumers (run once)
docker run -it --rm --network host natsio/nats-box
  nats stream add AUTH_EVENTS --subjects "auth.v1.>" --storage file --max-age=24h --defaults
  nats consumer add AUTH_EVENTS WEBAI_BRIDGE_AUTH_CONSUMER_CREATED --pull --durable WEBAI_BRIDGE_AUTH_CONSUMER_CREATED --deliver all --ack explicit --defaults
  exit

# 3. Configure pizzasys .env: NATS_HOST=127.0.0.1, NATS_TOKEN=(empty)
# 4. Start pizzasys queue worker
cd C:\xampp\htdocs\projacet\pizzasys
php artisan queue:listen --tries=3

# 5. Start our bridge
cd C:\New folder
docker compose up --build bridge
```

### Verify commands

```bash
# NATS monitoring
open http://localhost:8222

# Bridge logs
docker logs webai-bridge -f --tail 30

# PostgreSQL — check synced users
docker exec -it webai-postgres psql -U youruser -d yourdb -c \
  "SELECT id, email, role, external_id, synced_at FROM users WHERE external_id IS NOT NULL ORDER BY synced_at DESC LIMIT 10;"
```

### Test payload format (manual publish to test your handler)

```bash
docker run -it --rm --network host natsio/nats-box

# Publish a fake user.created
nats pub auth.v1.user.created '{
  "specversion":"1.0",
  "id":"test-001",
  "type":"auth.v1.user.created",
  "source":"auth-system",
  "subject":"auth.v1.user.created",
  "data":{
    "user":{"id":9001,"name":"Test User","email":"test@nats.local","email_verified_at":null,"created_at":null,"updated_at":null},
    "roles":["user"],
    "permissions_direct":[]
  }
}'

# Publish a fake user.deleted
nats pub auth.v1.user.deleted '{
  "specversion":"1.0",
  "id":"test-002",
  "type":"auth.v1.user.deleted",
  "source":"auth-system",
  "subject":"auth.v1.user.deleted",
  "data":{"user_id":9001,"email":"test@nats.local","deleted_at":"2026-06-11T10:00:00Z"}
}'
```

### Production checklist (when manager provides server details)

```
□ Set NATS_URL=nats://production-server:4222
□ Set NATS_TOKEN=<token from manager>   OR   NATS_USER + NATS_PASS
□ Set NATS_AUTH_STREAM=<stream name from manager>
□ Set NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER (our unique name)
□ Set DEV_MODE=0
□ Ask manager to create durable consumer WEBAI_BRIDGE_AUTH_CONSUMER_* on production NATS
□ Run crash test: stop bridge → create users → start bridge → verify replay
□ Monitor http://production-nats:8222 for num_pending=0
```
