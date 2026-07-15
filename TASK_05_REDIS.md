# Task 5 — Add Redis Container ✅ DONE

## What This Task Is

This is the **foundation for all caching** (Tasks 6, 10, 11). By itself it does
nothing visible — it just adds Redis and a safe cache helper. The next tasks
plug into it.

**Laravel comparison:** this is the exact same Redis you'd configure with
`CACHE_DRIVER=redis` in a Laravel app. Same tool, same purpose.

---

## Why Redis (and why now)

We need a place to store cached data (embeddings, answers) that:
1. Is **fast** (in-memory)
2. Is **shared across all Gunicorn workers** (Task 9 runs multiple worker
   processes — without a shared store, each worker would have its own separate
   cache, wasting memory and cutting hit rates)
3. Has **automatic expiry (TTL)** and **eviction** built in

Redis does all three. A Python dict can't do #2 or #3.

---

## Files Changed

### 1. `docker-compose.yml` — added the Redis service

```yaml
redis:
  image: redis:7-alpine
  container_name: webai-redis
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save ""
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    ...
```

The `command` line is the important part:
- `--maxmemory 256mb` → Redis will never use more than 256 MB of your 8 GB
- `--maxmemory-policy allkeys-lru` → when full, it drops the **least recently
  used** entries automatically (so it self-manages, never overflows)
- `--save ""` → disables saving to disk. This is a **cache**, not a database —
  if it restarts, entries are simply rebuilt on demand. Faster and simpler.

Also wired into the bridge:
```yaml
REDIS_URL: ${REDIS_URL:-redis://redis:6379/0}
depends_on:
  redis:
    condition: service_healthy
```

### 2. `webai-bridge/requirements.txt` — added the client

```
redis==5.2.1
```

### 3. `webai-bridge/cache.py` — NEW safe cache helper

The key design principle:

> **Caching is an optimization, never a dependency.**

If Redis is down, missing, or slow, every function in `cache.py` silently returns
"no cache" and the app works exactly as before. **Nothing here can ever crash a
request.** This is enforced everywhere:
```python
def cache_get_json(key):
    client = _get_client()
    if client is None:      # Redis not available
        return None         # → caller just does the real work
    try:
        ...
    except Exception:
        return None          # any error → treat as cache miss, never raise
```

Functions provided (used by the next tasks):
| Function | Purpose |
|---|---|
| `make_key(*parts)` | build a namespaced key (long parts auto-hashed) |
| `cache_get_json(key)` | read a cached value, or None on miss/error |
| `cache_set_json(key, value, ttl)` | store a value with an expiry |
| `cache_available()` | True if Redis is connected |

---

## What This Does NOT Do Yet

Task 5 **only sets up the plumbing**. No caching happens yet — that's Task 6
(embedding cache), Task 10 (response cache), Task 11 (search cache). This task
just makes sure the pipe is there and safe.

That separation is deliberate: adding Redis is low-risk and independent, so it
gets its own step. If anything about Redis were wrong, we'd catch it here before
building caching logic on top.

---

## The Safety Guarantee (important for peace of mind)

Because `cache.py` degrades gracefully:
- You can deploy this **now** even before you touch caching logic — zero risk.
- If you ever remove Redis or it crashes at 3am, the app keeps serving users
  (just without the speed boost). No outage from a cache failure.
- Locally, if you don't set `REDIS_URL`, the app runs exactly as it does today.

---

## How To Apply & Verify

1. Rebuild (Redis is a new container, so `up` not just restart):
   ```bash
   docker compose up -d --build
   ```
2. Check Redis is healthy:
   ```bash
   docker compose ps
   ```
   `webai-redis` should show `healthy`.
3. Check the bridge connected to it — look in the logs for:
   ```
   Redis cache connected: redis://redis:6379/0
   ```
   (If you see "cache disabled", Redis isn't reachable — but the app still works.)

4. Test Redis directly (optional):
   ```bash
   docker compose exec redis redis-cli ping
   # → PONG
   ```

---

## Memory Budget Check (your 8 GB VPS)

| Service | RAM |
|---|---|
| PostgreSQL | ~300–500 MB |
| Bridge | ~150 MB |
| WebAI-to-API + Gemini sessions | grows with users |
| **Redis (capped)** | **≤ 256 MB** |
| NATS | ~50 MB |
| Frontend | ~50 MB |
| (Ollama runs on host, ~2 GB) | — |

Redis is capped and small. It fits comfortably.

---

## Status

✅ **Task 5 complete.** Redis is running and the safe cache helper is ready.
Next up: **Task 6 — Embedding Cache**, the first real cache that actually cuts
Ollama calls. It plugs directly into `cache.py`.
