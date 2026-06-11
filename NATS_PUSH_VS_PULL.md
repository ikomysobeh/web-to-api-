# NATS — Why Pull? Push vs Pull vs Core Subscribe Explained

---

## The simple analogy

Think of NATS like a radio station and three different ways to listen:

| Method | Analogy |
|---|---|
| Core subscribe | Live radio — if you're not listening when it airs, it's gone |
| JetStream push consumer | Podcast — episodes are saved, delivered to you automatically when you reconnect |
| JetStream pull consumer | Podcast you manually sync — you ask "give me what I missed" |

---

## You're right that it's an "open channel"

Core NATS IS an open channel. You subscribe, messages flow in, you handle them.
That's exactly how our current code works:

```python
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
```

This works perfectly — **as long as the bridge is running 100% of the time**.

The moment the bridge restarts (docker restart, server reboot, deployment,
crash) — all events that fired while it was down are **gone forever**.

Example:
```
10:00  Bridge is running, listening
10:01  Laravel creates user Alice   → bridge receives it ✓
10:02  Bridge container restarts (deploy, crash, etc.)
10:03  Laravel creates user Bob     → nobody listening, lost ✗
10:04  Laravel creates user Carol   → nobody listening, lost ✗
10:05  Bridge comes back online
10:06  Laravel creates user Dave    → bridge receives it ✓
```

Bob and Carol now exist in Laravel but NOT in the bridge database.
The bridge and Laravel are out of sync. Silent data loss.

---

## What JetStream adds

JetStream saves every message to a stream (like a log file on disk).
The stream keeps every event in order, forever (or until an expiry you set).

When the bridge reconnects, the server knows where it left off and delivers
the missed messages:

```
10:00  Bridge is running, listening
10:01  Laravel creates user Alice   → delivered to bridge ✓
       Stream log: [Alice]
10:02  Bridge goes offline
10:03  Laravel creates user Bob     → saved to stream [Alice, Bob]
10:04  Laravel creates user Carol   → saved to stream [Alice, Bob, Carol]
10:05  Bridge comes back online
       Server: "you left off at Alice, here's Bob and Carol"
10:05  Bridge receives Bob          ✓
10:05  Bridge receives Carol        ✓
10:06  Laravel creates Dave         → delivered instantly ✓
```

No data loss. The bridge is always in sync even after restarts.

---

## Push consumer vs Pull consumer — your actual question

You asked: "why do I need to poll? it's an open channel."

**You don't have to pull. JetStream has a push consumer too.**

| | Core subscribe | JetStream push | JetStream pull |
|---|---|---|---|
| How messages arrive | Server pushes automatically | Server pushes automatically | You ask for them |
| Misses messages when offline | YES — lost forever | No — replayed on reconnect | No — replayed on reconnect |
| Complexity | Simple | Medium | Medium |
| Good for | Real-time only | Our use case | Worker queues, rate control |

**JetStream push consumer** works like what you're thinking —
the server still pushes messages to you the moment they arrive,
AND replays everything you missed when you were offline.

It's the same "open channel" feeling, but with a memory.

**JetStream pull consumer** is for cases where YOU control the pace —
e.g. "only give me 10 messages at a time, I'll ask for more when ready."
Useful for slow processing or worker queues. Not necessary for our case.

---

## So what should we actually use?

For our bridge, **JetStream push consumer** is the right choice:
- Messages arrive automatically (like core subscribe — no polling loop)
- Server remembers our position, replays missed messages on reconnect
- Simple to implement — one `subscribe()` call with JetStream context

The code change vs what we have now is small:

```python
# Current (core NATS — loses messages when offline)
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)

# Better (JetStream push consumer — never loses messages)
js = nc.jetstream()
await js.subscribe(
    "auth.v1.user.created",
    durable="WEBAI_BRIDGE_AUTH_CONSUMER",
    cb=handle_user_created
)
```

The `durable` name is the key — it tells the server "remember my position
under this name so I can resume after a restart".

---

## Why I described pull in the guide

I described pull because it's the same approach Laravel uses internally
(`pull` section in the Laravel config). But for the bridge, push is simpler
and achieves the same result.

Pull would only be needed if:
- We want to process messages at a controlled rate (e.g. not overwhelm the DB)
- Multiple bridge instances are running and should share the load

For a single bridge container syncing users, push consumer is the right pick.

---

## One-line summary

> Core subscribe = live radio (miss it if you're offline).
> JetStream push consumer = podcast auto-delivery (catch up when you're back).
> JetStream pull consumer = manual sync (you ask for episodes yourself).
>
> We want JetStream push — same open-channel feel, but with memory.
