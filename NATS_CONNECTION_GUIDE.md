# Connecting to the Real NATS Server — Understanding Guide

This file explains what the Laravel config means, what our current code does,
what is different between the two, and what needs to change. No code changes yet.

---

## Part 1 — What is NATS and What Does Laravel Do With It

NATS is a message broker — like a post office. Services publish messages to
"subjects" (like addresses), and other services subscribe to receive them.

Your Laravel project uses a feature called **JetStream**, which is the
"persistent mail" version of NATS:
- Normal NATS: if nobody is listening when a message is sent, it is lost
- JetStream: messages are saved to a **Stream** on disk — subscribers can read
  them later, even if they were offline when the message arrived

### What Laravel's config tells us

```php
'streams' => [
    [
        'name'           => 'AUTH_EVENTS',           // the stream name (like a mailbox)
        'durable'        => 'DATA_AUTH_CONSUMER',    // who is reading from it
        'filter_subject' => 'auth.v1.>',             // what subjects go into this stream
    ],
    ...
],
```

**Stream = AUTH_EVENTS**
A persistent log of all auth-related events. Every time a user is created,
updated, deleted, or a role changes in Laravel, a message is written here.
Messages stay saved until they expire or are manually deleted.

**Filter subject = `auth.v1.>`**
The `>` is a wildcard meaning "everything under auth.v1". So these subjects
all go into the same stream:
- `auth.v1.user.created`
- `auth.v1.user.updated`
- `auth.v1.user.deleted`
- `auth.v1.assignment.role.assigned`
- `auth.v1.assignment.role.removed`

**Durable consumer = DATA_AUTH_CONSUMER**
This is Laravel's own "bookmark" — it tracks how far along it has read in the
stream. Think of it like a read cursor. Laravel reads new messages and advances
this cursor.

**Dev mode vs production**
When `DEV_MODE=1` in Laravel's `.env`, all subjects get a `testing.` prefix:
- Production: `auth.v1.user.created`
- Dev:        `auth.testing.v1.user.created`
And stream names change: `AUTH_EVENTS` → `AUTH_TESTING_EVENTS`

**Auth in Laravel's NATS config**
```php
'user'  => env('NATS_USER'),
'pass'  => env('NATS_PASS'),
'token' => env('NATS_TOKEN'),
```
Laravel supports three auth methods: username+password OR a single token.
Our current code only supports token. This needs to be extended.

---

## Part 2 — What Our Current Code Does (and What's Wrong)

Our `nats_sync.py` connects to NATS and uses `nc.subscribe()`:

```python
await nc.subscribe("auth.v1.user.created",  cb=handle_user_created)
await nc.subscribe("auth.v1.user.updated",  cb=handle_user_updated)
...
```

This is **core NATS subscription** — it listens for new messages as they arrive.

### The problem

Laravel publishes to **JetStream subjects** (the `AUTH_EVENTS` stream). When a
message is published to a JetStream subject, NATS does two things:
1. Saves it to the stream (persistent)
2. Also delivers it to any core NATS subscribers currently connected

So `nc.subscribe()` WILL work **if the bridge is online** when Laravel sends
the message. But if the bridge is offline or restarting, it misses everything
that happened while it was down.

**With JetStream pull consumer**, messages are saved and the bridge can catch up
on everything it missed. This is the correct approach.

### Summary: what we have vs what we need

| Thing | Current code | What it should be |
|---|---|---|
| Subscribe method | Core NATS (`nc.subscribe`) | JetStream pull consumer |
| Misses messages when offline | Yes | No — catches up on reconnect |
| Auth | Token only | Token OR username+password |
| Dev/prod subjects | Hardcoded `auth.v1.*` | Reads `DEV_MODE` env var |
| Local NATS container | Running in docker-compose | Should connect to your real NATS |
| Consumer name | N/A | Should be unique (e.g. `WEBAI_BRIDGE_CONSUMER`) |

---

## Part 3 — How the Real Connection Should Work

Instead of `nc.subscribe()`, we need to:

1. Connect to NATS with proper auth (token OR user/pass)
2. Get the JetStream context
3. Create (or reuse) a **durable consumer** on the `AUTH_EVENTS` stream
   — with a unique name like `WEBAI_BRIDGE_CONSUMER` so it doesn't conflict
   with Laravel's `DATA_AUTH_CONSUMER`
4. Run a pull loop: every N seconds, pull the next batch of messages, process
   them, and acknowledge them (tell the server "I've read this")

### Why a unique consumer name matters

Each durable consumer on a stream gets its **own independent read cursor**.
Laravel's `DATA_AUTH_CONSUMER` is at position X.
Our `WEBAI_BRIDGE_CONSUMER` starts at 0 and advances independently.
Both get every message. Neither blocks the other.

If we used the same name as Laravel's consumer, we would compete with it —
sometimes Laravel reads a message, sometimes the bridge does, but never both.

---

## Part 4 — Environment Variables to Set

To connect to the real NATS server instead of the local Docker one, these
`.env` values need to be set:

```env
# The real NATS server address (ask your team for this)
NATS_URL=nats://your-nats-server-host:4222

# Auth — use ONE of these two methods:
NATS_TOKEN=your_token_here
# OR
NATS_USER=your_username
NATS_PASS=your_password

# Whether to use dev subjects (auth.testing.v1.*) or prod (auth.v1.*)
# Set to 1 if you're connecting to the dev/staging NATS
NATS_DEV_MODE=0
```

---

## Part 5 — The Local NATS Container in docker-compose.yml

Right now `docker-compose.yml` starts a local NATS server:

```yaml
nats:
  image: nats:2.10-alpine
  ports:
    - "4222:4222"
  command: ["--jetstream"]
```

And the bridge connects to it via `NATS_URL=nats://nats:4222`.

Once you connect to the real NATS server, you have two options:

**Option A — Remove the local NATS service**
Delete the `nats:` section from `docker-compose.yml` and remove `nats` from
the bridge's `depends_on`. Set `NATS_URL` in `.env` to the real server.

**Option B — Keep it for local development**
Leave it in docker-compose but point `NATS_URL` to the real server in your
real `.env`. The local NATS stays in case you want to test offline.

---

## Part 6 — What the Message Payload Looks Like

Our current code expects a **CloudEvents envelope**:

```json
{
  "type": "auth.v1.user.created",
  "data": {
    "user_id": 42,
    "email": "alice@example.com",
    "roles": ["user"]
  }
}
```

**Important:** We need to confirm with the Laravel team exactly what the
payload looks like. Specifically:
- Is it a CloudEvents envelope (`{ "type": ..., "data": ... }`) or raw JSON?
- Is the user ID field called `user_id` or `id`?
- Are roles an array of strings `["admin"]` or objects `[{"name":"admin"}]`?

If the payload format is different, `_unwrap()` in `nats_sync.py` will fail
silently (logs an error, skips the message).

---

## Part 7 — Checklist Before We Write the Code

Before coding the JetStream pull consumer, confirm these with your team:

| Question | Why it matters |
|---|---|
| What is the NATS server address? | The `NATS_URL` to put in `.env` |
| Token or user+pass auth? | Which auth fields to set |
| Is `DEV_MODE` on for your current environment? | Changes subject prefixes |
| What is the exact payload shape of auth events? | Our `_unwrap()` may need updating |
| Should we create a new consumer `WEBAI_BRIDGE_CONSUMER` or reuse an existing one? | Avoid competing with Laravel's consumer |
| Does the AUTH_EVENTS stream already exist? | If not, we may need to create it |

---

## Summary

| Topic | Current state | What needs to change |
|---|---|---|
| NATS server | Local Docker container | Connect to real server via `NATS_URL` |
| Subscribe method | Core NATS (misses messages offline) | JetStream pull consumer (catches up) |
| Auth | Token only | Support user+pass too |
| Subjects | Hardcoded `auth.v1.*` | Read `NATS_DEV_MODE` to toggle prefix |
| Consumer name | None | Create `WEBAI_BRIDGE_CONSUMER` (unique, independent) |
| docker-compose | Runs local NATS | Remove or keep as dev fallback |

The code change itself is not huge — the main part that changes is
`start_nats_sync()` in `nats_sync.py`. Instead of `nc.subscribe()`, it will
use `js.pull_subscribe()` with a durable consumer name and loop with `fetch()`.
Everything else (the event handlers, the database calls) stays the same.
