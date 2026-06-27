# NATS Consumer Setup — What It Means & What To Do

**Date:** 2026-06-27

---

## Part 1 — What is all of this?

### Stream = a log of events

A NATS **Stream** stores every event that happens in the auth system.
Think of it like a ledger — every time a user is created, updated, deleted, or gets a role change, one line is added.

| Stream | What it contains |
|---|---|
| `AUTH_EVENTS` | Real events — production users |
| `AUTH_TESTING_EVENTS` | Test events — used during development |

### Consumer = a bookmark

A **Consumer** is a bookmark inside the stream. It remembers:
- Which messages have been delivered to a specific project
- Which have been acknowledged (processed successfully)
- Which are still pending

Every project that needs to receive user events gets its own consumer.
That way each project gets ALL events independently, without affecting others.

```
AUTH_EVENTS stream (225 messages)
    │
    ├── DATA_AUTH_CONSUMER          → Data project reads from here (its own bookmark)
    ├── HIRING_AUTH_CONSUMER        → Hiring project reads from here
    ├── MAINTENANCE_AUTH_CONSUMER   → Maintenance project reads from here
    ├── NOTIFICATIONS_AUTH_CONSUMER → Notifications project reads from here
    ├── QA_AUTH_CONSUMER            → QA project reads from here
    └── WEBAI_AUTH_CONSUMER         → WebAI bridge reads from here ← NEW
```

If one project is slow, it doesn't affect the others — they each have their own bookmark.

---

## Part 2 — What was wrong before

The bridge was creating **6 separate consumers**, one for each event type:

```
WEBAI_BRIDGE_AUTH_CONSUMER_CREATED
WEBAI_BRIDGE_AUTH_CONSUMER_UPDATED
WEBAI_BRIDGE_AUTH_CONSUMER_DELETED
WEBAI_BRIDGE_AUTH_CONSUMER_ROLE_ASSIGNED
WEBAI_BRIDGE_AUTH_CONSUMER_ROLE_REMOVED
WEBAI_BRIDGE_AUTH_CONSUMER_ROLE_SYNCED
```

This is wrong for two reasons:
1. It pollutes the NATS server with many consumers instead of one
2. All other projects use ONE consumer per project — the bridge must follow the same pattern

The manager removed these wrong consumers and created the correct ones:

| Consumer | Stream | Use when |
|---|---|---|
| `WEBAI_AUTH_CONSUMER` | `AUTH_EVENTS` | Production (`DEV_MODE=0`) |
| `WEBAI_AUTH_TESTING_CONSUMER` | `AUTH_TESTING_EVENTS` | Development (`DEV_MODE=1`) |

---

## Part 3 — Current status

```
WEBAI_AUTH_CONSUMER         → 225 unprocessed messages (all production history waiting)
WEBAI_AUTH_TESTING_CONSUMER → 18  unprocessed messages (all test history waiting)
```

These messages are waiting to be delivered to the bridge. The bridge is not yet
reading from them because the code still tries to use the old (deleted) consumers.

---

## Part 4 — What needs to change in the code

### The new approach: ONE consumer, ALL events, bridge routes internally

Instead of subscribing to each subject separately, the bridge subscribes to the
entire stream through ONE consumer and decides what to do based on the message subject.

```python
# OLD (wrong) — 6 subscriptions, 6 consumers
js.subscribe("auth.v1.user.created",      durable="WEBAI_BRIDGE_AUTH_CONSUMER_CREATED", ...)
js.subscribe("auth.v1.user.updated",      durable="WEBAI_BRIDGE_AUTH_CONSUMER_UPDATED", ...)
js.subscribe("auth.v1.user.deleted",      durable="WEBAI_BRIDGE_AUTH_CONSUMER_DELETED", ...)
# ... etc

# NEW (correct) — 1 subscription, 1 consumer, bridge routes by subject
js.subscribe("auth.v1.>", durable="WEBAI_AUTH_CONSUMER", stream="AUTH_EVENTS", cb=dispatch)

def dispatch(msg):
    if "user.created"      in msg.subject: handle_user_created(msg)
    elif "user.updated"    in msg.subject: handle_user_updated(msg)
    elif "user.deleted"    in msg.subject: handle_user_deleted(msg)
    elif "role."           in msg.subject: handle_role_changed(msg)
```

### Files that need to change

| File | What changes |
|---|---|
| `webai-bridge/nats_sync.py` | Replace 6 subscriptions with 1, add dispatch function |
| `.env` (local + server) | `NATS_AUTH_DURABLE=WEBAI_AUTH_CONSUMER` |
| `.env` (server only) | `NATS_AUTH_STREAM=AUTH_EVENTS` (already correct) |

### Environment variable mapping

| Variable | Production value | Testing value (DEV_MODE=1) |
|---|---|---|
| `NATS_AUTH_STREAM` | `AUTH_EVENTS` | `AUTH_TESTING_EVENTS` |
| `NATS_AUTH_DURABLE` | `WEBAI_AUTH_CONSUMER` | `WEBAI_AUTH_TESTING_CONSUMER` |
| `DEV_MODE` | `0` | `1` |

Currently `DEV_MODE=0` switches the subject prefix (`auth.v1` vs `auth.testing.v1`).
It also needs to switch the stream and consumer name.

---

## Part 5 — Action items

### On the VPS `.env` — update these two lines:
```env
NATS_AUTH_STREAM=AUTH_EVENTS
NATS_AUTH_DURABLE=WEBAI_AUTH_CONSUMER
```

### In the code — `webai-bridge/nats_sync.py`:
Replace the 6 `js.subscribe()` calls with one wildcard subscription
using `WEBAI_AUTH_CONSUMER` as the durable name.
The bridge already has all the handler functions — they just need to be
called from a single dispatcher instead of from 6 separate subscriptions.

### After code change:
1. Push to git
2. On VPS: `docker compose up -d --build bridge`
3. The bridge will connect to `WEBAI_AUTH_CONSUMER`, receive the 225 backlogged messages, and sync all users
4. From that point, every new user created on authtesting.lcportal.cloud will appear in the bridge DB within seconds

---

## Summary diagram

```
authtesting.lcportal.cloud
  creates/updates/deletes user
          │
          ▼
  AUTH_EVENTS stream on nats.lcportal.cloud
          │
          └── WEBAI_AUTH_CONSUMER (bookmark for WebAI)
                    │
                    ▼ (pull messages)
          webai-bridge on AI VPS
                    │
                    ├── user.created  → upsert user in DB
                    ├── user.updated  → update email in DB
                    ├── user.deleted  → delete from DB
                    └── role.*        → update role in DB
```
