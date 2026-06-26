# NATS — Laravel vs Python Side-by-Side Comparison

This guide compares every piece of HiringPizza (Laravel) with the matching
piece in our WebAI Bridge (Python). Read the left side to understand the
concept, then the right side to see how we do it.

---

## Part 1 — The Big Picture

### What NATS is (simple explanation)

NATS is like a **post office for software**.

- A system that creates a user (Auth System) puts a letter in the post office
- The post office keeps it in a box called a **stream**
- Other systems (HiringPizza, our Bridge) pick up letters from that box
- Each system has its own box (called a **consumer**) so they each get their own copy

```
Auth System                NATS SERVER               Our Bridge (Python)
(creates user)             (post office)             (receives event)
     │                          │                          │
     │  publish event           │                          │
     ├─────────────────────────►│  AUTH_EVENTS stream      │
     │  auth.v1.user.created    │  ┌───────────────────┐   │
     │                          │  │ msg 1: user Alice  │   │
     │                          │  │ msg 2: user Bob    │   │
     │                          │  │ msg 3: user Carol  │   │
     │                          │  └───────────────────┘   │
     │                          │       ▲          │        │
     │                          │       │          │ deliver│
     │                          │  HIRING_AUTH_    │ to each│
     │                          │  CONSUMER        ▼ consumer
     │                          │  (HiringPizza)           │
     │                          │                 WEBAI_   │
     │                          │                 BRIDGE_  │
     │                          │                 AUTH_    │
     │                          │                 CONSUMER │
     │                          │                 (us)     │
```

**Both HiringPizza and our Bridge get the same messages independently.**
They don't share a consumer — each has their own separate copy.

---

## Part 2 — File-by-File Comparison

### 2.1 — Configuration

**Laravel (HiringPizza): `config/nats.php`**

This file holds all NATS settings. Laravel reads it with `config('nats.host')`.

```php
return [
    'host'  => env('NATS_HOST', '127.0.0.1'),
    'port'  => (int) env('NATS_PORT', 4222),
    'token' => env('NATS_TOKEN'),
    'user'  => env('NATS_USER'),
    'pass'  => env('NATS_PASS'),
    'dev_mode' => (int) env('DEV_MODE', 0) === 1,

    'streams' => [
        [
            'name'           => env('NATS_AUTH_STREAM', 'AUTH_EVENTS'),
            'durable'        => env('NATS_AUTH_DURABLE', 'HIRING_AUTH_CONSUMER'),
            'filter_subject' => 'auth.v1.>',
        ],
    ],
];
```

**Python (our Bridge): `.env` file**

Python doesn't have a config.php — we use environment variables read directly.

```env
# Same values, different format
NATS_URL=nats://127.0.0.1:4222
NATS_TOKEN=your_token_here
NATS_USER=
NATS_PASS=
DEV_MODE=0

NATS_AUTH_STREAM=AUTH_EVENTS
NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER
```

```python
# How Python reads them (in nats_sync.py)
import os
NATS_URL    = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN  = os.getenv("NATS_TOKEN", "")
NATS_USER   = os.getenv("NATS_USER", "")
NATS_PASS   = os.getenv("NATS_PASS", "")
DEV_MODE    = os.getenv("DEV_MODE", "0") == "1"
AUTH_STREAM = os.getenv("NATS_AUTH_STREAM", "AUTH_EVENTS")
AUTH_DURABLE= os.getenv("NATS_AUTH_DURABLE", "WEBAI_BRIDGE_AUTH_CONSUMER")
```

**Same concept, different language syntax.**

---

### 2.2 — Connecting to NATS

**Laravel: `NatsClientFactory.php`**

```php
// Creates ONE connection object with auth
$opts = ['host' => $host, 'port' => $port];
$opts['token'] = $token;              // OR
$opts['user'] = $user;                // user + pass
$opts['pass'] = $pass;
return new Client(new Configuration($opts));
```

**Python: `nats_sync.py` — `start_nats_sync()`**

```python
# CURRENT code (only token)
connect_kwargs = {}
if NATS_TOKEN:
    connect_kwargs["token"] = NATS_TOKEN
await nc.connect(NATS_URL, **connect_kwargs)

# NEEDS TO BE (token OR user+pass, same as Laravel)
connect_kwargs = {}
if NATS_TOKEN:
    connect_kwargs["token"] = NATS_TOKEN
elif NATS_USER and NATS_PASS:
    connect_kwargs["user"]     = NATS_USER
    connect_kwargs["password"] = NATS_PASS
await nc.connect(NATS_URL, **connect_kwargs)
```

**Same logic. Laravel uses a class. Python uses a function.**

---

### 2.3 — The Main Loop (most important part)

This is the **biggest difference** between Laravel and our current Python code.

**Laravel: `JetStreamConsumer.php` — `runForever()`**

```
starts
  │
  └─ loop forever:
       │
       ├─ health check → reconnect if needed
       │
       └─ consumeStream()
            │
            ├─ pull up to 25 messages from NATS
            │   (JetStream PULL — ask NATS for messages)
            │
            ├─ for each message:
            │    ├─ handleMessage()
            │    │    ├─ check event_id in EventInbox table
            │    │    │   (skip if already processed — idempotency)
            │    │    ├─ route to correct handler
            │    │    ├─ handler runs → updates database
            │    │    └─ ACK, NAK, or TERM
            │    └─ sleep 250ms
            └─ repeat
```

**Python: `nats_sync.py` — `start_nats_sync()` (CURRENT)**

```
starts
  │
  └─ connect to NATS
       │
       └─ subscribe to subjects (core NATS — NOT JetStream)
            │
            messages arrive automatically when published
            (but LOST if bridge is offline)
            │
            └─ callback: handle_user_created()
                 └─ upsert_user() → writes to PostgreSQL
                    NO ACK/NAK needed (core NATS doesn't use them)
                    NO idempotency check
```

**What this means in practice:**

| Scenario | Laravel (JetStream) | Python (Core NATS — current) |
|---|---|---|
| Bridge is online | Gets message ✓ | Gets message ✓ |
| Bridge is offline | Message saved in stream → delivered when back online ✓ | Message LOST forever ✗ |
| Same message arrives twice | Checks EventInbox → skip duplicate ✓ | Runs handler twice — inserts/updates twice ✓ (safe for upsert, but wasteful) |
| Server restarts NATS | Reconnects → replays everything ✓ | Reconnects → but missed events gone ✗ |

---

### 2.4 — JetStream vs Core Subscribe (visual)

```
CORE NATS (what we currently use):

NATS server                    Our Bridge
    │                              │
    │  ←── subscribe ──────────────┤
    │                              │
    │  ──── push message ─────────►│  (bridge is online) ✓
    │                              │
    │  Bridge goes offline ─────── ✗
    │                              │
    │  new message published        │
    │  (NOBODY receives it)        │
    │  message is GONE             │
    │                              │
    │  Bridge comes back online ───┤
    │  ←── subscribe ──────────────┤
    │  (no replay, starts fresh)   │
    │                              │


JETSTREAM (what we need to use):

NATS server                    Our Bridge
    │                              │
    │  AUTH_EVENTS stream          │
    │  ┌──────────────────┐        │
    │  │ msg 1: Alice (✓) │        │
    │  │ msg 2: Bob   (✓) │        │
    │  │ msg 3: Carol (✓) │        │
    │  └──────────────────┘        │
    │                              │
    │  WEBAI_BRIDGE_AUTH_CONSUMER  │
    │  last_seen: msg 1            │
    │                              │
    │  Bridge goes offline ────────┤
    │                              │
    │  msg 2: Bob   published      │
    │  msg 3: Carol published      │
    │  (saved in stream)           │
    │                              │
    │  Bridge comes back ──────────┤
    │  ──── deliver msg 2 ────────►│ ✓
    │  ──── deliver msg 3 ────────►│ ✓
    │  (NATS remembers where       │
    │   we left off)               │
```

---

### 2.5 — Subject Routing

**Laravel: `EventRouter.php`**

Maps a subject string to a PHP class.

```php
$this->map = [
    "auth.v1.user.created" => UserCreatedHandler::class,
    "auth.v1.user.updated" => UserUpdatedHandler::class,
    "auth.v1.user.deleted" => UserDeletedHandler::class,
];

// Usage:
$handlerClass = $this->router->resolve($subject); // returns class name
$handler = app($handlerClass);                    // creates instance
$handler->handle($event);                         // runs it
```

**Python: `nats_sync.py`**

Python does the same thing but directly in the subscribe call:

```python
# Instead of a router class, we just pass the function directly
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
await nc.subscribe("auth.v1.user.updated", cb=handle_user_updated)
await nc.subscribe("auth.v1.user.deleted", cb=handle_user_deleted)

# When a message arrives on "auth.v1.user.created",
# NATS automatically calls handle_user_created(msg)
```

**Same result. Laravel uses a class+map. Python uses direct function references.**

---

### 2.6 — Event Handlers

**Laravel: `UserCreatedHandler.php`**

```php
public function handle(array $event): void
{
    // 1. Extract user data from payload (tries multiple paths)
    $userPayload = $this->extractUserPayload($event);
    $id    = $this->asInt(data_get($userPayload, 'id'));
    $email = (string) data_get($userPayload, 'email', '');
    $name  = (string) data_get($userPayload, 'name', 'Unknown');

    // 2. Write to database
    User::updateOrCreate(
        ['id' => $id],
        ['name' => $name, 'email' => $email]
    );
}

// Tries 3 different payload paths:
private function extractUserPayload(array $event): array
{
    $user = data_get($event, 'data.user');    // try 1: event.data.user
    if (is_array($user)) return $user;

    $user = data_get($event, 'user');          // try 2: event.user
    if (is_array($user)) return $user;

    $user = data_get($event, 'payload.user'); // try 3: event.payload.user
    if (is_array($user)) return $user;

    throw new Exception('user payload not found');
}
```

**Python: `nats_sync.py` — `handle_user_created()` (CURRENT)**

```python
async def handle_user_created(msg):
    data, event_type = _unwrap(msg)
    # _unwrap does: data = json.loads(msg.data)["data"]

    upsert_user(
        external_id = data["user_id"],    # ← assumes this key exists
        email       = data["email"],       # ← assumes this key exists
        role        = _extract_bridge_role(data.get("roles", []))
    )
```

**Problem:** Our Python assumes `data.user_id` exists. Laravel tries 3 fallback
paths. If the auth system sends `data.user.id` instead of `data.user_id`, our
Python silently fails (KeyError caught by except).

**What Python SHOULD do (same fallbacks as Laravel):**

```python
def _extract_user_id(data: dict) -> int:
    # Try 1: flat field — data.user_id
    uid = data.get("user_id") or data.get("id")
    if uid:
        return int(uid)
    # Try 2: nested — data.user.id
    user = data.get("user", {})
    if isinstance(user, dict) and user.get("id"):
        return int(user["id"])
    return 0

def _extract_email(data: dict) -> str:
    # Try 1: flat field — data.email
    email = data.get("email", "")
    if email:
        return email
    # Try 2: nested — data.user.email
    user = data.get("user", {})
    if isinstance(user, dict):
        return user.get("email", "")
    return ""
```

---

### 2.7 — Idempotency (preventing duplicate processing)

**"Idempotency" means: even if the same event arrives twice, process it only once.**

**Laravel: `EventInbox` table**

```
event_inbox table:
┌────────┬──────────────┬────────────────────────┬──────────────┐
│ id     │ event_id     │ subject                │ processed_at │
├────────┼──────────────┼────────────────────────┼──────────────┤
│ 1      │ 01JBXXX001   │ auth.v1.user.created   │ 2026-06-11   │
│ 2      │ 01JBXXX002   │ auth.v1.user.updated   │ 2026-06-11   │
│ 3      │ 01JBXXX003   │ auth.v1.user.deleted   │ 2026-06-11   │
└────────┴──────────────┴────────────────────────┴──────────────┘

When message arrives:
  1. Look up event_id in this table
  2. If found AND processed_at is set → skip (already done) → ACK
  3. If not found → create row → process → set processed_at → ACK
```

**Python: NO idempotency check (current)**

Our Python just runs `upsert_user()` every time a message arrives. This is
actually OK because `upsert_user` does `ON CONFLICT DO UPDATE` — running it
twice has the same result as running it once. But it's not perfect.

**Do we need an EventInbox table in Python?**

For our use case (user sync) — not urgently required, because our database
operations are safe to run twice (upsert = insert-or-update). But it would
be good to add for correctness and for debugging.

For now: we accept the current behavior. It won't cause data corruption.

---

### 2.8 — ACK / NAK / TERM Protocol

This is JetStream-specific. Core NATS doesn't have this.

**What they mean:**

| Signal | Meaning | NATS does |
|---|---|---|
| **ACK** | "I processed this message successfully" | Remove from pending, mark delivered |
| **NAK** | "I failed, please retry later" | Re-deliver after a delay (default 30s) |
| **TERM** | "This message is broken, stop retrying" | Mark as terminated, never re-deliver |

**Laravel: always sends one of these three**

```php
// Success:
$this->ackSafe($msg, ...);    // sends +ACK

// Failure, will retry:
$this->nackWithDelaySafe($msg, ..., 2, ...);  // sends -NAK with 2 second delay

// Failure, give up (poison message):
$this->termSafe($msg, ...);   // sends +TERM
```

**Python: MUST also send ACK/NAK/TERM when using JetStream**

```python
# In Python with nats.py library:
async def handle_user_created(msg):
    try:
        data, _ = _unwrap(msg)
        upsert_user(...)
        await msg.ack()          # ← tell NATS: success

    except Exception:
        logger.exception("Failed")
        await msg.nak()          # ← tell NATS: retry me
```

**Current Python code does NOT send ACK/NAK because it uses core NATS.**
When we switch to JetStream, we MUST add `await msg.ack()` and `await msg.nak()`.

---

### 2.9 — Dev Mode (test subjects vs production subjects)

**Laravel: automatic prefix switching**

```php
// config/nats.php
$devMode = (int) env('DEV_MODE', 0) === 1;

$authPrefix = $devMode
    ? 'auth.testing.v1'   // DEV: auth.testing.v1.user.created
    : 'auth.v1';           // PROD: auth.v1.user.created
```

**Python: current code ALWAYS uses auth.v1 (no dev mode)**

```python
# CURRENT — hardcoded, no dev mode
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)

# NEEDS TO BE:
DEV_MODE     = os.getenv("DEV_MODE", "0") == "1"
AUTH_PREFIX  = "auth.testing.v1" if DEV_MODE else "auth.v1"
await js.subscribe(f"{AUTH_PREFIX}.user.created", ...)
```

---

## Part 3 — The Full Picture Side by Side

```
HIRINGPIZZA (Laravel)                    OUR BRIDGE (Python)
═══════════════════════════════          ═══════════════════════════════
config/nats.php                          .env file
  - host, port, token/user+pass           - NATS_URL, NATS_TOKEN
  - stream names, durable names           - NATS_AUTH_STREAM
  - dev_mode flag                         - DEV_MODE
      │                                       │
      ▼                                       ▼
NatsClientFactory.php                    start_nats_sync() in nats_sync.py
  - creates NATS connection                - creates NATS connection
  - handles token OR user+pass auth        - handles token only ← NEEDS FIX
      │                                       │
      ▼                                       ▼
JetStreamConsumer.php                    start_nats_sync() (continued)
  - pull loop (asks NATS every 250ms)     - subscribe (NATS pushes to us)
  - reconnect if connection drops          - auto-reconnect ✓
  - force refresh every 10 min            - no force refresh ← minor gap
      │                                       │
      ▼                                       ▼
EventRouter.php                          direct subscribe callbacks
  - maps subject → handler class          - maps subject → function
  - supports dev mode prefix              - NO dev mode ← NEEDS FIX
      │                                       │
      ▼                                       ▼
UserCreatedHandler.php                   handle_user_created()
  - extracts data with 3 fallback paths   - extracts data, 1 path ← NEEDS FIX
  - writes to MySQL                       - writes to PostgreSQL ✓
      │                                       │
      ▼                                       ▼
EventInbox table                         NO idempotency table
  - prevents duplicate processing         - upsert is safe anyway ← OK for now
      │                                       │
      ▼                                       ▼
ACK / NAK / TERM                         NO ACK/NAK/TERM
  - tells NATS what happened              - needed when using JetStream ← NEEDS FIX
  - NAK = retry, TERM = give up
```

---

## Part 4 — What the Event JSON Looks Like

When the Auth System creates a user, it publishes this JSON to NATS.
Both HiringPizza and our Bridge receive this same JSON.

### The outer envelope (CloudEvents format)

```json
{
  "specversion": "1.0",
  "id": "01JBX3KP0ZQVN5GWDTD7M9K2FX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "auth.v1.user.created",
  "time": "2026-06-11T10:00:00Z",
  "datacontenttype": "application/json",
  "data": {
    ... (this is what we need to extract)
  }
}
```

### The `data` field — what's inside

We don't know the exact format yet (need to confirm with manager).
Based on HiringPizza's code, two possible formats:

**Format A — Nested user object:**
```json
"data": {
  "user": {
    "id": 123,
    "email": "ali@example.com",
    "name": "Ali Hassan",
    "roles": ["user"]
  }
}
```

**Format B — Flat fields:**
```json
"data": {
  "user_id": 123,
  "email": "ali@example.com",
  "name": "Ali Hassan",
  "roles": ["user"]
}
```

### What Python currently does with this

```python
def _unwrap(msg):
    envelope = json.loads(msg.data.decode())  # parse the whole JSON
    return envelope["data"], envelope.get("type")
    # envelope["data"] = the "data" field above

async def handle_user_created(msg):
    data, _ = _unwrap(msg)
    # data is now: {"user_id": 123, "email": "..."} OR {"user": {"id": 123}}

    upsert_user(
        external_id = data["user_id"],   # ← works for Format B, FAILS for Format A
        email       = data["email"],      # ← works for Format B, FAILS for Format A
        ...
    )
```

### What Python SHOULD do (handle both formats)

```python
async def handle_user_created(msg):
    data, _ = _unwrap(msg)

    user_id = _extract_user_id(data)   # tries flat, then nested
    email   = _extract_email(data)     # tries flat, then nested

    if not user_id or not email:
        logger.error(f"Cannot extract user from payload: {data}")
        await msg.nak()   # retry later
        return

    upsert_user(external_id=user_id, email=email, role=role)
    await msg.ack()       # tell NATS: done
```

---

## Part 5 — Current State of `nats_sync.py`

Let me map every line of our current file and explain it:

```python
# Line 1-8: imports and config
NATS_URL = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN = os.getenv("NATS_TOKEN", "")
# ← MISSING: NATS_USER, NATS_PASS, DEV_MODE, AUTH_STREAM, AUTH_DURABLE

# Line 14: tracks connection state
nats_connected = False          # used by /health/nats endpoint

# Line 17-18: admin role mapping
ADMIN_ROLES = {"super-admin", "admin"}

# Line 21-28: _extract_bridge_role()
# Maps ["super-admin", "user"] → "admin"
# Maps ["user"] → "user"
# ✓ This is correct

# Line 31-40: _unwrap()
# Takes raw NATS message → returns (data_dict, event_type)
# data_dict = envelope["data"]
# ✓ This is correct

# Line 45-56: handle_user_created()
# Gets called when auth.v1.user.created arrives
# Extracts user_id, email, roles from data
# Calls upsert_user() to write to PostgreSQL
# ⚠ Problem: only tries data["user_id"], no fallback

# Line 59-70: handle_user_updated()
# Same as created — just updates email/role
# ⚠ Same problem: no fallback paths

# Line 73-80: handle_user_deleted()
# Deletes user from our DB by external_id
# ✓ This is mostly correct

# Line 84-115: handle_role_changed()
# Handles role.assigned / role.removed events
# ⚠ These subjects might not exist in the real stream

# Line 120-175: start_nats_sync()  ← THE MAIN FUNCTION
# Connects to NATS
# Subscribes to subjects
# Runs forever
# ⚠ BIG PROBLEM: uses core subscribe, not JetStream
# ⚠ Only supports token auth, not user+pass

# Line 173-175: get_nats_status()
# Returns nats_connected bool
# Used by GET /health/nats endpoint
# ✓ This is correct
```

---

## Part 6 — The Exact Changes Needed

### Change 1 — Top of file: add new env vars

```python
# CURRENT (line 10-11)
NATS_URL   = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN = os.getenv("NATS_TOKEN", "")

# REPLACE WITH:
NATS_URL     = os.getenv("NATS_URL", "nats://localhost:4222")
NATS_TOKEN   = os.getenv("NATS_TOKEN", "")
NATS_USER    = os.getenv("NATS_USER", "")
NATS_PASS    = os.getenv("NATS_PASS", "")
DEV_MODE     = os.getenv("DEV_MODE", "0") == "1"
AUTH_STREAM  = os.getenv("NATS_AUTH_STREAM", "AUTH_EVENTS")
AUTH_DURABLE = os.getenv("NATS_AUTH_DURABLE", "WEBAI_BRIDGE_AUTH_CONSUMER")
AUTH_PREFIX  = "auth.testing.v1" if DEV_MODE else "auth.v1"
```

### Change 2 — Add fallback extraction helpers

```python
# ADD these functions after _unwrap()

def _extract_user_id(data: dict) -> int:
    uid = data.get("user_id") or data.get("id")
    if uid:
        try:
            return int(uid)
        except (ValueError, TypeError):
            pass
    user = data.get("user", {})
    if isinstance(user, dict):
        uid = user.get("id")
        if uid:
            try:
                return int(uid)
            except (ValueError, TypeError):
                pass
    return 0

def _extract_email(data: dict) -> str:
    email = data.get("email", "")
    if email:
        return str(email)
    user = data.get("user", {})
    if isinstance(user, dict):
        return str(user.get("email", ""))
    return ""

def _extract_roles(data: dict) -> list:
    roles = data.get("roles", [])
    if roles:
        return roles
    user = data.get("user", {})
    if isinstance(user, dict):
        return user.get("roles", [])
    return []
```

### Change 3 — Update handlers to use fallbacks + add ack

```python
# CURRENT handle_user_created
async def handle_user_created(msg):
    try:
        data, event_type = _unwrap(msg)
        upsert_user(
            external_id=data["user_id"],      # ← breaks if wrong format
            email=data["email"],
            role=_extract_bridge_role(data.get("roles", []))
        )
    except Exception:
        logger.exception("Failed to handle user.created event")

# REPLACE WITH:
async def handle_user_created(msg):
    try:
        data, event_type = _unwrap(msg)
        user_id = _extract_user_id(data)
        email   = _extract_email(data)
        roles   = _extract_roles(data)

        if not user_id or not email:
            logger.error(f"user.created: cannot extract user — raw data: {data}")
            await msg.nak()
            return

        logger.info(f"NATS {event_type}: user_id={user_id} email={email}")
        upsert_user(
            external_id=user_id,
            email=email,
            role=_extract_bridge_role(roles)
        )
        await msg.ack()

    except Exception:
        logger.exception("Failed to handle user.created event")
        await msg.nak()
```

### Change 4 — Switch start_nats_sync to JetStream

```python
# CURRENT (core subscribe — loses messages)
async def start_nats_sync():
    nc = NATS()
    await nc.connect(NATS_URL, token=NATS_TOKEN, ...)
    await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
    await nc.subscribe("auth.v1.user.updated", cb=handle_user_updated)
    await nc.subscribe("auth.v1.user.deleted", cb=handle_user_deleted)
    while True:
        await asyncio.sleep(30)

# REPLACE WITH (JetStream — never loses messages):
async def start_nats_sync():
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

    # Build auth options
    connect_kwargs = dict(
        disconnected_cb=disconnected_cb,
        reconnected_cb=reconnected_cb,
        max_reconnect_attempts=-1,
    )
    if NATS_TOKEN:
        connect_kwargs["token"] = NATS_TOKEN
    elif NATS_USER and NATS_PASS:
        connect_kwargs["user"]     = NATS_USER
        connect_kwargs["password"] = NATS_PASS

    try:
        await nc.connect(NATS_URL, **connect_kwargs)
        nats_connected = True
        logger.info(f"NATS connected: {NATS_URL}")

        # Get JetStream context
        js = nc.jetstream()

        # Subscribe using JetStream with durable consumer
        # durable = server remembers our position even after restart
        await js.subscribe(
            f"{AUTH_PREFIX}.user.created",
            stream=AUTH_STREAM,
            durable=AUTH_DURABLE + "_CREATED",
            cb=handle_user_created,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.updated",
            stream=AUTH_STREAM,
            durable=AUTH_DURABLE + "_UPDATED",
            cb=handle_user_updated,
        )
        await js.subscribe(
            f"{AUTH_PREFIX}.user.deleted",
            stream=AUTH_STREAM,
            durable=AUTH_DURABLE + "_DELETED",
            cb=handle_user_deleted,
        )

        logger.info(f"JetStream subscribed on stream={AUTH_STREAM} durable={AUTH_DURABLE}")

        while True:
            await asyncio.sleep(30)

    except Exception:
        nats_connected = False
        logger.exception("NATS sync failed to start")
```

---

## Part 7 — Summary Table

| Concept | Laravel has it | Python has it (current) | Python needs it |
|---|---|---|---|
| NATS config file | `config/nats.php` | `.env` | Add more env vars |
| Token auth | ✓ | ✓ | ✓ done |
| User+pass auth | ✓ | ✗ | Add it |
| Dev mode subjects | ✓ | ✗ | Add it |
| JetStream subscribe | ✓ | ✗ (core only) | Switch to JetStream |
| ACK on success | ✓ | ✗ | Add `await msg.ack()` |
| NAK on failure | ✓ | ✗ | Add `await msg.nak()` |
| Auto-reconnect | ✓ | ✓ | ✓ done |
| Multiple payload paths | ✓ (3 fallbacks) | ✗ (1 path) | Add fallbacks |
| Idempotency table | ✓ EventInbox | ✗ | Not urgent (upsert is safe) |
| User created handler | ✓ | ✓ | Fix payload paths |
| User updated handler | ✓ | ✓ | Fix payload paths |
| User deleted handler | ✓ | ✓ | Fix payload paths |
| Role changed handler | ✗ (not in Laravel) | ✓ | Keep or remove |

---

## Questions to Ask Your Manager Before Changing the Code

1. What is the NATS server address? → `NATS_URL`
2. Token auth or user+pass? If token, what is it?
3. What is the AUTH stream name? (`AUTH_EVENTS` or something else?)
4. What durable consumer name should we use for our bridge?
5. Can you share ONE example JSON payload for `user.created`?
   (so we know if it's Format A or Format B from Part 4)
6. Is `DEV_MODE=1` for staging and `DEV_MODE=0` for production?
