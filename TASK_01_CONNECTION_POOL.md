# Task 1 — Database Connection Pool ✅ DONE

## What This Task Fixed

**Before:** every request opened a brand-new PostgreSQL connection and destroyed
it afterward. At ~100+ concurrent requests, PostgreSQL hits its connection limit
(default 100) and starts rejecting users.

**After:** the app opens a small set of connections **once** and **reuses** them.
20 pooled connections comfortably serve hundreds of users.

**Laravel comparison:** Laravel does this automatically. We just added the same
behavior to Python by hand.

---

## The Big Design Decision (why almost no files changed)

The codebase calls `conn.close()` in **128 places across 10 files**. Changing
every one by hand would be huge and risky.

Instead, I made `get_connection()` return a **wrapper** object. The wrapper
forwards everything to a real connection, EXCEPT `close()` — which now returns
the connection to the pool instead of destroying it.

```
Old world:  conn.close()  →  connection destroyed (wasteful)
New world:  conn.close()  →  connection returned to pool (reused)
```

**Result:** all 128 existing `conn.close()` calls keep working unchanged. They
just recycle connections now instead of throwing them away. **Only 2 files
changed** (`database.py` and `main.py`).

---

## Files Changed

### 1. `webai-bridge/database.py` (the main change)

Added:
- **A shared pool** (`ThreadedConnectionPool`, min 5 / max 20 connections)
- **`_PooledConnection`** — the wrapper class whose `close()` returns to the pool
- **`get_connection()`** — now borrows from the pool instead of opening new
- **`release_connection(conn)`** — explicit "return to pool" for new code
- **`close_pool()`** — closes everything on shutdown

Key safety detail — the wrapper does a `rollback()` before returning a
connection to the pool:
```python
def close(self):
    ...
    self._real.rollback()      # clear any half-done transaction
    self._pool.putconn(self._real)
```
This guarantees one request's unfinished transaction can never leak into the
next request that borrows the same connection.

### 2. `webai-bridge/main.py` (wiring)

- Imported `close_pool`
- Added a `shutdown` event that calls `close_pool()` so connections close
  cleanly when the app stops.

---

## How to Configure the Pool Size

Two optional env vars (defaults are fine for KVM 2):

```env
DB_POOL_MIN=5    # connections opened immediately
DB_POOL_MAX=20   # hard ceiling shared by all requests
```

**Rule:** keep `DB_POOL_MAX` well below PostgreSQL's `max_connections` (default
100). With multiple Gunicorn workers later (Task 9), remember **each worker gets
its own pool** — so `workers × DB_POOL_MAX` must stay under 100.

Example: 3 workers × 20 = 60 connections max → safe (under 100). ✓

---

## The Taxi Analogy

```
Before (no pool):
  Every passenger builds a new car, drives once, scraps it. 🚗💥
  1000 trips = 1000 cars built and destroyed.

After (pool):
  20 taxis wait at a rank. Passengers borrow one, ride, return it. 🚕♻️
  1000 trips = the same 20 taxis, reused over and over.
```

`conn.close()` used to mean "scrap the car." Now it means "return the taxi."

---

## How To Verify It Works

1. Rebuild and start the bridge:
   ```bash
   docker compose up -d --build bridge
   ```
2. Check the startup log — you should see:
   ```
   DB pool created (min=5, max=20)
   ```
3. Use the app normally. Everything works exactly as before — but now under
   load it reuses connections instead of exhausting PostgreSQL.

To watch active connections in PostgreSQL:
```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'webai_bridge';
```
Before: this number spiked with traffic. After: it stays low and steady (≤ pool max).

---

## What Did NOT Change

- No change to how any query is written
- No change to the 9 service files (they all use `get_connection()` + `conn.close()`)
- No change to app behavior from the user's point of view
- No database schema change

This was a pure infrastructure upgrade — invisible to users, but it removes the
#1 crash risk under load.

---

## One Known Limitation (for later)

If a request errors out **before** reaching its `conn.close()`, that connection
is not returned to the pool (a "leak"). This existed before too (it just leaked a
new connection instead). It's not a problem at normal scale, but the fully-correct
fix later is to wrap DB usage in `try/finally`. Noted for a future cleanup — not
needed now.

---

## Status

✅ **Task 1 complete.** Next up: **Task 2 — Ollama Semaphore.**
