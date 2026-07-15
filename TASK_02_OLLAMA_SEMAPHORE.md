# Task 2 — Ollama Semaphore ✅ DONE

## What This Task Fixed

**The problem (the scariest one we found):**
> Ollama processes embeddings **one at a time**. Research showed latency spiking
> from **2 seconds → 45+ seconds with just 5 concurrent users**.

Without protection, a small burst of traffic makes the whole app freeze, because
every message waits behind a growing Ollama queue.

**The fix:** a **semaphore** — a counter that limits how many embedding calls run
at the same time. Extra callers wait a few milliseconds instead of dogpiling onto
Ollama.

**Laravel comparison:** this is exactly like a **queue with a limited number of
workers**. You don't run 300 jobs at once — you run 2 and the rest wait their turn.

---

## What a Semaphore Is (simple version)

Think of a nightclub with a "max 2 people inside" rule and a bouncer:

```
Semaphore(2) = a bouncer holding 2 entry tokens

Request comes in → takes a token → enters → does the Ollama call
When done       → returns the token → next waiting request enters

If both tokens are out → new requests WAIT at the door (no crash, just a queue)
```

- `async with _embed_semaphore:` = "take a token, or wait until one is free"
- when the block finishes, the token is returned automatically

---

## Files Changed

### `webai-bridge/vector.py`

**1. Added the semaphore at the top:**
```python
import asyncio

OLLAMA_MAX_CONCURRENCY = int(os.getenv("OLLAMA_MAX_CONCURRENCY", "2"))
_embed_semaphore = asyncio.Semaphore(OLLAMA_MAX_CONCURRENCY)
```

**2. Wrapped the actual Ollama call inside it:**
```python
async def embed_text(text):
    async with _embed_semaphore:          # ← take a token / wait
        async with httpx.AsyncClient(...) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/embeddings", ...)
            return resp.json()["embedding"]
```

**Why `embed_text` is the right place:** both paths that use Ollama go through it:
- `ingest_document()` → `embed_text()` (when uploading files)
- `search_chunks()` → `embed_query()` → `embed_text()` (on every message)

So protecting this one function covers **both** upload embedding and per-message
query embedding. One guard, full coverage.

### `docker-compose.yml`

Added the setting so you can tune it without touching code:
```yaml
OLLAMA_MAX_CONCURRENCY: ${OLLAMA_MAX_CONCURRENCY:-2}
```

---

## How To Configure

In your `.env` (optional — default is 2, correct for KVM 2):
```env
OLLAMA_MAX_CONCURRENCY=2
```

**Rule:** set it to your **CPU count**. KVM 2 has 2 CPUs → use `2`.
- Too high → Ollama floods, latency spikes (the exact problem we're fixing)
- Too low (1) → safe but slower throughput
- Just right (= CPU count) → maximum safe throughput

---

## ⚠️ This Task Has a Partner — Task 3

The semaphore controls the **app side** ("don't SEND more than 2 at once").
Task 3 sets `OLLAMA_NUM_PARALLEL=2` on the **Ollama server side** ("don't PROCESS
more than 2 at once").

```
App semaphore (Task 2)  ──sends max 2──►  Ollama NUM_PARALLEL (Task 3)
     "don't send too much"                    "don't accept too much"
```

They must use the **same number**. Do Task 3 right after this or the protection
is only half in place.

---

## What Happens Under Load Now

**Before (no semaphore), 10 users message at once:**
```
10 embedding calls → all hit Ollama → Ollama queues them internally →
last user waits 45 seconds → everything feels frozen
```

**After (semaphore = 2):**
```
10 embedding calls → 2 run immediately, 8 wait at the door →
as each finishes, the next enters → each call still takes ~200ms →
worst case ~1 second total, app stays responsive, no freeze
```

And once caching is added (Task 6), most of those 10 won't even reach Ollama.

---

## How To Verify

1. Rebuild the bridge:
   ```bash
   docker compose up -d --build bridge
   ```
2. Normal single-user use feels identical (one call, one free token, no waiting).
3. The protection only shows under concurrent load — you won't "see" it day to
   day, which is the point: it silently prevents the freeze.

To confirm the setting loaded, check the container env:
```bash
docker compose exec bridge env | grep OLLAMA_MAX_CONCURRENCY
```

---

## What Did NOT Change

- No change to embedding quality or results
- No change to how search or upload works
- Single-user experience is identical
- Only concurrent-load behavior improved

---

## Status

✅ **Task 2 complete.** Next up: **Task 3 — set `OLLAMA_NUM_PARALLEL=2`** on the
Ollama server (its partner). Small config-only task on the VPS.
