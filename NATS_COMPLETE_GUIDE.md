# NATS Complete Guide — WebAI Bridge + HiringPizza

Everything you need to understand, what needs to change, and how to test before production.

---

## Table of Contents

1. [The Big Picture — How Everything Connects](#1-the-big-picture)
2. [What HiringPizza Does (Laravel Side)](#2-what-hiringpizza-does)
3. [What Our Python Bridge Does (Current Code)](#3-what-our-python-bridge-does)
4. [Critical Problems with Our Current Code](#4-critical-problems)
5. [Event Payload Format — What the Auth System Sends](#5-event-payload-format)
6. [What We Need to Change in `nats_sync.py`](#6-what-we-need-to-change)
7. [Environment Variables to Add](#7-environment-variables)
8. [Files to Change and Files to Ignore](#8-files-to-change-and-ignore)
9. [How to Test Before Production](#9-how-to-test)
10. [Troubleshooting Reference](#10-troubleshooting)

---

## 1. The Big Picture

There are **3 separate projects** talking to each other through NATS:

```
┌─────────────────────────────────────────────────────────────────┐
│                        NATS SERVER                              │
│                    (shared infrastructure)                      │
│                                                                 │
│  Streams:                                                       │
│   AUTH_EVENTS      ← auth.v1.user.* events live here           │
│   HIRING_EVENTS    ← hiring.v1.* events live here              │
│   NOTIFICATIONS_EVENTS ← notifications.v1.* live here          │
└──────────────┬────────────────────────────────────────┬─────────┘
               │                                        │
    PUBLISHES  │                          CONSUMES      │
               ▼                                        ▼
┌──────────────────────┐              ┌──────────────────────────┐
│    AUTH SYSTEM       │              │    HiringPizza (Laravel) │
│  (your manager's     │              │    + WebAI Bridge (our   │
│   other project)     │              │      Python project)     │
│                      │              │                          │
│  Sends events when:  │              │  Both listen to:         │
│  - user created      │              │  auth.v1.user.created    │
│  - user updated      │              │  auth.v1.user.updated    │
│  - user deleted      │              │  auth.v1.user.deleted    │
│  - role changed      │              │                          │
└──────────────────────┘              └──────────────────────────┘
```

**Key point:** The Auth System publishes events. Both HiringPizza AND our Bridge
consume the same events from the same NATS stream. We don't talk to HiringPizza
directly — we both independently listen to NATS.

---

## 2. What HiringPizza Does

HiringPizza is a production-grade example of how to consume NATS events correctly.
This is what your manager showed you as the reference.

### The Flow (Laravel side)

```
NATS server
   │
   │  php artisan nats:consume (runs forever)
   ▼
JetStreamConsumer.php
   │  pull batch of messages every 250ms
   ▼
EventRouter.php
   │  routes by subject → correct handler class
   ▼
UserCreatedHandler.php  /  UserUpdatedHandler.php  /  UserDeletedHandler.php
   │  writes user data to MySQL database
   ▼
EventInbox table
   │  records event_id for idempotency (never process same event twice)
   ▼
ACK/NAK/TERM back to NATS
   │  ACK = success, NAK = retry later, TERM = give up
```

### Key files in HiringPizza

| File | What it does |
|---|---|
| `config/nats.php` | All NATS settings: host, port, auth, stream names |
| `Services/Nats/NatsClientFactory.php` | Creates NATS connection with token OR user/pass |
| `Services/EventConsume/JetStreamConsumer.php` | Main consumer loop — pulls messages, handles retries |
| `Services/EventConsume/EventRouter.php` | Maps subject → handler class |
| `Services/EventConsume/Handlers/UserCreatedHandler.php` | Handles `auth.v1.user.created` |
| `Services/EventConsume/Handlers/UserUpdatedHandler.php` | Handles `auth.v1.user.updated` |
| `Services/EventConsume/Handlers/UserDeletedHandler.php` | Handles `auth.v1.user.deleted` |
| `Models/EventInbox.php` | Database model for idempotency tracking |
| `Console/Commands/NatsConsumeCommand.php` | `php artisan nats:consume` command |

### What HiringPizza does right

1. **JetStream pull consumer** — Never loses messages even when server restarts
2. **EventInbox table** — Each event has a unique ID; never processed twice
3. **Retry logic** — NAK sends the message back for retry (up to 5 times)
4. **Dead-letter handling** — After 5 failures, mark as "parked" and TERM it
5. **ACK/NAK/TERM protocol** — Tells NATS what happened to each message
6. **Dev mode subjects** — `auth.testing.v1.*` for dev, `auth.v1.*` for prod

---

## 3. What Our Python Bridge Does

Our current `nats_sync.py` is much simpler — and has several critical problems.

### Current Python flow

```
NATS server
   │
   │  start_nats_sync() (runs forever in background)
   ▼
Core NATS subscribe (NOT JetStream)
   │  events are pushed to us as they arrive
   ▼
handle_user_created / handle_user_updated / handle_user_deleted / handle_role_changed
   │  writes to PostgreSQL via upsert_user() or delete_user_by_external_id()
   ▼
No ACK/NAK — core NATS doesn't need them
   │
No idempotency — same event can be processed multiple times
```

### Current `nats_sync.py` subscribes to these subjects

```python
await nc.subscribe("auth.v1.user.created",             cb=handle_user_created)
await nc.subscribe("auth.v1.user.updated",             cb=handle_user_updated)
await nc.subscribe("auth.v1.user.deleted",             cb=handle_user_deleted)
await nc.subscribe("auth.v1.assignment.role.assigned", cb=handle_role_changed)
await nc.subscribe("auth.v1.assignment.role.removed",  cb=handle_role_changed)
```

### Current data extraction in Python

```python
# In handle_user_created and handle_user_updated:
data, event_type = _unwrap(msg)   # data = envelope["data"]
upsert_user(
    external_id=data["user_id"],  # ← expects data.user_id
    email=data["email"],          # ← expects data.email
    role=_extract_bridge_role(data.get("roles", []))  # ← expects data.roles
)
```

---

## 4. Critical Problems

### Problem 1 — WRONG: Core Subscribe instead of JetStream

**This is the biggest problem.**

```python
# CURRENT CODE (broken for production)
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
```

Core subscribe = live radio. If the bridge container restarts (deploy, crash,
Docker update), all events that fired while it was down are **permanently lost**.

```
Timeline:
10:00  Bridge running, listening
10:01  Auth creates user Alice → bridge receives ✓
10:02  Bridge container restarts (new deploy)
10:03  Auth creates user Bob   → LOST ✗
10:04  Auth creates user Carol → LOST ✗
10:05  Bridge comes back online
10:06  Auth creates user Dave  → bridge receives ✓

Result: Bob and Carol exist in Laravel but NOT in our database.
```

**Fix:** Use JetStream subscribe with a durable consumer.
When the bridge reconnects, NATS replays Bob and Carol automatically.

---

### Problem 2 — Payload path might be wrong

HiringPizza's `UserCreatedHandler` expects the user object at `data.user`:
```json
{ "data": { "user": { "id": 123, "email": "a@b.com" } } }
```

Our Python code expects flat fields at `data`:
```json
{ "data": { "user_id": 123, "email": "a@b.com", "roles": ["user"] } }
```

We don't know for sure what format the auth system sends because we don't have
access to that code. But HiringPizza's handler tries multiple fallbacks:
```
data.user.id       ← first try
user.id            ← second try
payload.user.id    ← third try
```

Our Python code doesn't have any fallbacks. If the format is wrong, it fails
silently with a KeyError (the `except Exception` catches it and logs it).

**Fix:** Add the same fallback logic to our Python handlers.

---

### Problem 3 — No dev mode support

HiringPizza uses different subject prefixes for dev vs prod:
```
Production:  auth.v1.user.created
Development: auth.testing.v1.user.created
```

Our Python code always subscribes to `auth.v1.*` — it has no `DEV_MODE` support.

In production this is fine. But if the team tests with dev-mode subjects, we
will miss those events entirely.

---

### Problem 4 — No user/pass auth support

Our Python code only supports token auth:
```python
if NATS_TOKEN:
    connect_kwargs["token"] = NATS_TOKEN
```

HiringPizza supports both token AND user+pass. If the production NATS server
uses user+pass authentication, our bridge cannot connect.

---

### Problem 5 — No stream/consumer config

JetStream requires knowing:
- The **stream name** (e.g., `AUTH_EVENTS`)
- The **durable consumer name** (e.g., `WEBAI_BRIDGE_AUTH_CONSUMER`)

These must match what is configured on the NATS server. Our current code has
no concept of streams — it just connects and subscribes to subjects.

---

## 5. Event Payload Format

This is the format both HiringPizza and our bridge receive from the auth system.

### CloudEvents v1.0 envelope (outer wrapper)

```json
{
  "specversion": "1.0",
  "id": "01JBXXX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "auth.v1.user.created",
  "time": "2026-06-11T10:00:00Z",
  "datacontenttype": "application/json",
  "data": { ... },
  "meta": {
    "correlation_id": "uuid",
    "actor_user_id": 1
  }
}
```

### User Created event — `data` field

We don't have the auth system source code, but based on how HiringPizza's
`UserCreatedHandler` reads the payload, the most likely format is:

```json
{
  "data": {
    "user": {
      "id": 123,
      "email": "user@example.com",
      "name": "User Name",
      "roles": ["user"]
    }
  }
}
```

OR it might be a flat structure:
```json
{
  "data": {
    "user_id": 123,
    "email": "user@example.com",
    "name": "User Name",
    "roles": ["user"]
  }
}
```

**We must confirm the exact format before going to production.**
See section 9 (Testing) for how to check.

### User Updated event — `data` field

Based on HiringPizza's `UserUpdatedHandler` which looks for `data.changed_fields`:

```json
{
  "data": {
    "user_id": 123,
    "changed_fields": {
      "name": { "from": "Old Name", "to": "New Name" },
      "email": { "from": "old@a.com", "to": "new@b.com" }
    }
  }
}
```

### User Deleted event — `data` field

```json
{
  "data": {
    "user_id": 123
  }
}
```

---

## 6. What We Need to Change

### File to change: `webai-bridge/nats_sync.py`

Only this one file. Nothing else in the Python project needs to change.

### Change 1 — Switch from core subscribe to JetStream

```python
# BEFORE (core subscribe — loses messages when offline)
async def start_nats_sync():
    nc = NATS()
    await nc.connect(NATS_URL, ...)
    await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
    await nc.subscribe("auth.v1.user.updated", cb=handle_user_updated)
    await nc.subscribe("auth.v1.user.deleted", cb=handle_user_deleted)

# AFTER (JetStream durable — replays missed messages on reconnect)
async def start_nats_sync():
    nc = NATS()
    await nc.connect(NATS_URL, ...)
    js = nc.jetstream()

    stream_name = os.getenv("NATS_AUTH_STREAM", "AUTH_EVENTS")
    durable = os.getenv("NATS_AUTH_DURABLE", "WEBAI_BRIDGE_AUTH_CONSUMER")
    dev_mode = os.getenv("DEV_MODE", "0") == "1"
    prefix = "auth.testing.v1" if dev_mode else "auth.v1"

    await js.subscribe(
        f"{prefix}.user.created",
        stream=stream_name,
        durable=durable + "_CREATED",
        cb=handle_user_created,
    )
    await js.subscribe(
        f"{prefix}.user.updated",
        stream=stream_name,
        durable=durable + "_UPDATED",
        cb=handle_user_updated,
    )
    await js.subscribe(
        f"{prefix}.user.deleted",
        stream=stream_name,
        durable=durable + "_DELETED",
        cb=handle_user_deleted,
    )
```

### Change 2 — Add user/pass auth support

```python
# BEFORE (token only)
if NATS_TOKEN:
    connect_kwargs["token"] = NATS_TOKEN

# AFTER (token OR user/pass)
NATS_USER = os.getenv("NATS_USER", "")
NATS_PASS = os.getenv("NATS_PASS", "")

if NATS_TOKEN:
    connect_kwargs["token"] = NATS_TOKEN
elif NATS_USER and NATS_PASS:
    connect_kwargs["user"] = NATS_USER
    connect_kwargs["password"] = NATS_PASS
```

### Change 3 — Fix payload extraction with fallbacks

```python
# BEFORE (breaks silently if format is wrong)
data["user_id"]   # KeyError if field name is different
data["email"]

# AFTER (same fallbacks as HiringPizza)
def _get_user_id(data: dict) -> int:
    # Try flat: data.user_id
    uid = data.get("user_id") or data.get("id")
    if uid:
        return int(uid)
    # Try nested: data.user.id
    user = data.get("user", {})
    if isinstance(user, dict):
        return int(user.get("id", 0))
    return 0

def _get_email(data: dict) -> str:
    email = data.get("email", "")
    if email:
        return email
    user = data.get("user", {})
    if isinstance(user, dict):
        return user.get("email", "")
    return ""

def _get_roles(data: dict) -> list:
    roles = data.get("roles", [])
    if roles:
        return roles
    user = data.get("user", {})
    if isinstance(user, dict):
        return user.get("roles", [])
    return []
```

### Change 4 — Add dev mode support

```python
DEV_MODE = os.getenv("DEV_MODE", "0") == "1"
AUTH_PREFIX = "auth.testing.v1" if DEV_MODE else "auth.v1"

# Then use AUTH_PREFIX in subscriptions:
await js.subscribe(f"{AUTH_PREFIX}.user.created", ...)
```

---

## 7. Environment Variables

### Add these to `webai-bridge/.env`

```env
# ── NATS Connection ──────────────────────────
NATS_URL=nats://your-nats-server:4222

# Auth method — use ONE of these:
NATS_TOKEN=your_token_here
# OR:
# NATS_USER=your_username
# NATS_PASS=your_password

# ── NATS Stream Config ───────────────────────
# Stream name on NATS server that holds auth events
NATS_AUTH_STREAM=AUTH_EVENTS

# Durable consumer name — must be unique for our bridge
# DO NOT use the same durable name as HiringPizza
NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER

# ── Dev Mode ─────────────────────────────────
# 0 = production subjects (auth.v1.*)
# 1 = test subjects (auth.testing.v1.*)
DEV_MODE=0
```

### Add these to `docker-compose.yml` (bridge service environment)

```yaml
bridge:
  environment:
    - NATS_URL=nats://your-nats-server:4222
    - NATS_TOKEN=your_token_here
    - NATS_AUTH_STREAM=AUTH_EVENTS
    - NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER
    - DEV_MODE=0
```

### Questions to ask your manager before going to production

| Question | Why you need it |
|---|---|
| What is the NATS server address? | `NATS_URL` |
| Is auth token or user+pass? | `NATS_TOKEN` or `NATS_USER`/`NATS_PASS` |
| What is the AUTH stream name? | `NATS_AUTH_STREAM` — must match exactly |
| What is the durable consumer name to use? | `NATS_AUTH_DURABLE` |
| What DEV_MODE value for staging vs production? | `DEV_MODE` |
| Can you share one example event payload? | To verify the `data.*` field paths |

---

## 8. Files to Change and Ignore

### Files we need to change

| File | What to change |
|---|---|
| `webai-bridge/nats_sync.py` | Switch to JetStream, add user/pass, fix payload paths, add dev mode |
| `webai-bridge/.env` | Add new env vars (NATS_AUTH_STREAM, NATS_AUTH_DURABLE, DEV_MODE, NATS_USER/PASS) |
| `docker-compose.yml` | Add same env vars to bridge service |

### Files in HiringPizza we do NOT need

Everything in HiringPizza is PHP/Laravel. We are Python/FastAPI.
We do NOT copy any of those files. HiringPizza is only a reference to understand
the architecture — specifically:
- What event format the auth system sends
- What stream/consumer names are used
- What subjects to subscribe to

**We ignore these HiringPizza files entirely:**
- `app/Services/HiringEvents/*` — These PUBLISH hiring events. We don't publish.
- `app/Jobs/PublishOutboxEventJob.php` — We don't use Laravel queue jobs
- `app/Console/Commands/PublishPendingOutboxCommand.php` — We don't publish
- `app/Services/Nats/JetStreamPublisher.php` — We don't publish
- `database/migrations/create_hiring_outbox_events_table.php` — We don't need outbox
- Store event handlers (`StoreCreatedHandler`, etc.) — We don't sync stores
- `Models/HiringOutboxEvent.php` — We don't have outbox events
- All `app/Http/Controllers/Api/V1/*` — These are Laravel API routes, not ours
- All `routes/*` — These are Laravel routes, not ours

**The only HiringPizza patterns we adapt to Python:**
- `JetStreamConsumer.php` → adapt to Python in `nats_sync.py`
- `UserCreatedHandler.php` → our `handle_user_created()` in `nats_sync.py`
- `EventRouter.php` → our subject-to-handler mapping in `nats_sync.py`
- `config/nats.php` → our env vars in `.env`

---

## 9. How to Test Before Production

Your manager said "it will work in production" — but here are ways to test
before deploying to production.

### Option A — Local NATS server (best option — free, 5 minutes to set up)

Run a real NATS server locally with JetStream enabled:

```yaml
# Add to docker-compose.yml
nats:
  image: nats:latest
  command: ["-js", "-m", "8222"]
  ports:
    - "4222:4222"   # NATS client port
    - "8222:8222"   # NATS monitoring UI
```

Start it:
```bash
docker compose up nats
```

Check it's running at http://localhost:8222

Then point your bridge at it:
```env
NATS_URL=nats://localhost:4222
# No token needed for local testing
```

---

### Option B — Create a test stream and publish fake events

After the local NATS is running, use `nats-box` to create the stream and
publish test events manually:

```bash
# 1. Open a shell into nats-box (a NATS CLI tool container)
docker run --rm -it --network host natsio/nats-box

# 2. Create the AUTH_EVENTS stream (if it doesn't exist)
nats stream add AUTH_EVENTS \
  --subjects "auth.v1.>" \
  --storage file \
  --retention limits \
  --max-msgs -1 \
  --max-age 24h

# 3. Create the durable consumer for our bridge
nats consumer add AUTH_EVENTS WEBAI_BRIDGE_AUTH_CONSUMER \
  --pull \
  --durable WEBAI_BRIDGE_AUTH_CONSUMER \
  --deliver all \
  --ack explicit \
  --filter "auth.v1.>"

# 4. Publish a fake "user created" event
nats pub auth.v1.user.created '{
  "specversion": "1.0",
  "id": "test-001",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "auth.v1.user.created",
  "data": {
    "user_id": 999,
    "email": "testuser@example.com",
    "name": "Test User",
    "roles": ["user"]
  }
}'
```

Then check your PostgreSQL database:
```sql
SELECT id, email, role, external_id FROM users WHERE external_id = 999;
-- Should see the test user appear
```

---

### Option C — Test with DEV_MODE subjects

If the production NATS server has a `AUTH_TESTING_EVENTS` stream,
you can test against the real server without touching production data:

```env
DEV_MODE=1
NATS_AUTH_STREAM=AUTH_TESTING_EVENTS
NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_TESTING_CONSUMER
```

Your bridge will listen to `auth.testing.v1.*` instead of `auth.v1.*`.
The auth system (if also in dev mode) will publish to those test subjects.

---

### What to verify in testing

Work through this checklist:

```
□ Bridge connects to NATS without error
□ Bridge appears in NATS monitoring (http://localhost:8222/connz)
□ Publish user.created → user appears in PostgreSQL users table
□ Publish user.created AGAIN with same event ID → only one record in DB (idempotency)
□ Publish user.updated → email/name updates in DB
□ Publish user.deleted → user row removed from DB
□ Stop the bridge container → publish 3 events
□ Restart the bridge container → all 3 events appear in DB (JetStream replay)
□ /health/nats endpoint returns connected=true
```

The last test (stop → publish → restart → check replay) is the most important.
It proves JetStream is working correctly. Core subscribe FAILS this test.

---

### How to check event payload format (critical)

Before going to production, you need to know the exact JSON structure the
auth system publishes. Three ways to find out:

**Way 1 — Ask your manager for a sample payload**
Ask: "Can you give me one example JSON of what `auth.v1.user.created` looks like?"

**Way 2 — Subscribe and log the raw payload**

Add this temporary debug handler to `nats_sync.py`:
```python
async def debug_handler(msg):
    raw = msg.data.decode()
    logger.info(f"RAW EVENT on {msg.subject}: {raw}")
```

Then subscribe to it:
```python
await js.subscribe("auth.testing.v1.>", durable="WEBAI_DEBUG", cb=debug_handler)
```

Run the bridge, then ask someone to create a test user in the auth system.
The raw JSON will appear in your logs.

**Way 3 — Use NATS monitoring**

If you have access to the production NATS monitoring URL (port 8222):
http://your-nats-server:8222/jsz?streams=true

This shows all streams and message counts — confirms the stream names.

---

## 10. Troubleshooting Reference

### Error: `NATS auth not configured`

```
Exception: NATS auth not configured (set token OR user/pass)
```

**Fix:** Set either `NATS_TOKEN` or both `NATS_USER` + `NATS_PASS` in `.env`

---

### Error: `stream not found`

```
nats: stream not found
```

**Fix:** The `NATS_AUTH_STREAM` value in your `.env` doesn't match the actual
stream name on the server. Confirm the exact stream name with your manager.

---

### Error: `consumer not found`

```
nats: consumer not found
```

**Fix:** The durable consumer doesn't exist yet on the server. Either:
1. Create it manually using the NATS CLI (see Option B above), or
2. Ask your manager to create it, or
3. The JetStream subscribe in Python will create it if `create` mode is used

---

### Events arrive but database doesn't update

Check the bridge logs:
```bash
docker logs webai-bridge --tail 100
```

Look for `KeyError` or `Failed to handle` — this means the payload format
is different from what we expect. Add debug logging (Way 2 above) to see the raw payload.

---

### Bridge connects but role.assigned events are ignored

Our current code subscribes to `auth.v1.assignment.role.assigned` — but this
subject might not exist in the AUTH_EVENTS stream filter. Check:
1. Ask your manager if this event type exists
2. Check the stream filter subject (it might only filter `auth.v1.user.*`)

---

### `/health/nats` returns `connected: false` in production

The bridge cannot reach the NATS server. Check:
1. `NATS_URL` is correct and reachable from the bridge container
2. Firewall / security group allows port 4222
3. Auth credentials are correct (wrong token → connection refused)

---

## Summary — What To Do Before Production

1. **Ask your manager** for:
   - NATS server address and port
   - Auth method (token or user/pass) and credentials
   - Stream name for auth events
   - Example JSON payload for `user.created`

2. **Test locally** using Option A + Option B above to verify the code works

3. **Update `nats_sync.py`** with the 4 changes in section 6

4. **Update `.env`** with the new variables in section 7

5. **Run the rebuild**: `docker compose up --build bridge`

6. **Verify** using the checklist in section 9, especially the stop→publish→restart test
