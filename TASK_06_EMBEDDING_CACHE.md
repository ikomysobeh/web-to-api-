# Task 6 — Embedding Cache ✅ DONE

## What This Task Does

This is the **first real cache** — it actually cuts Ollama calls. When the same
text needs embedding again, we reuse the stored vector instead of asking Ollama
to compute it again.

**Why it's safe:** the same text + same model **always** produces the same
vector. So reusing it can never be wrong. This is the safest possible cache
(exact match only — no "similar" guessing).

---

## Where It Helps

Remember, `embed_text()` is used in two places:

| Caller | When | Does the cache help? |
|---|---|---|
| `ingest_document()` | uploading a file | Rarely (each chunk is usually unique) |
| `search_chunks()` → `embed_query()` | **every user message** | **Yes — a lot** |

The big win is on **repeated questions**. Real users ask the same things:
- "What are your opening hours?"
- "How do I reset my password?"
- "What is the return policy?"

The first time, Ollama embeds it. Every time after, it's served from cache
instantly — **zero Ollama load** for that question.

---

## File Changed

### `webai-bridge/vector.py`

**1. Imported the cache helpers:**
```python
from cache import make_key, cache_get_json, cache_set_json
```

**2. Added a TTL setting:**
```python
EMBED_CACHE_TTL = int(os.getenv("EMBED_CACHE_TTL", "86400"))  # 24 hours
```

**3. Wrapped `embed_text()` with a cache check:**
```python
async def embed_text(text):
    # 1. Look in cache first
    cache_key = make_key("embed", OLLAMA_MODEL, text)
    cached = cache_get_json(cache_key)
    if cached is not None:
        return cached           # ← HIT: skip Ollama entirely

    # 2. Miss → call Ollama (still under the semaphore from Task 2)
    ... embedding = resp.json()["embedding"] ...

    # 3. Store it for next time
    cache_set_json(cache_key, embedding, EMBED_CACHE_TTL)
    return embedding
```

---

## The Flow (before vs after)

**Before (Task 2 only):**
```
Every message → semaphore → Ollama → vector
(Ollama runs for every single message, even repeats)
```

**After (Task 6):**
```
Message → cache?
   ├─ HIT  → return vector instantly (no Ollama, no semaphore wait)
   └─ MISS → semaphore → Ollama → vector → store in cache
```

On a repeated question, the entire Ollama step disappears.

---

## Why the Key Includes the Model

```python
make_key("embed", OLLAMA_MODEL, text)
```

The key is `embed:<model>:<text>`. Including the model name means: if you ever
switch embedding models (e.g. to a hosted API in Task 12), old cached vectors
from the previous model are automatically ignored — they have different keys. No
stale-vector bugs.

Also, `make_key` automatically hashes long text so Redis keys stay short and tidy.

---

## Safety Recap

- **Exact match only** — the cache returns a vector only for the identical text.
  It never guesses or approximates. Zero risk of a wrong result.
- **Degrades gracefully** — if Redis is down, `cache_get_json` returns None
  (treated as a miss) and `cache_set_json` does nothing. The app just calls
  Ollama like before. No crash, no error.
- **Self-cleaning** — entries expire after 24h, and Redis's LRU eviction (from
  Task 5) drops old ones if memory fills. The cache can't grow forever.

---

## How To Configure

Optional env var (default 24h is fine):
```env
EMBED_CACHE_TTL=86400   # seconds a cached embedding stays valid
```

---

## How To Verify

1. Rebuild the bridge:
   ```bash
   docker compose up -d --build bridge
   ```
2. Ask an agent the **same question twice**.
3. Check Redis has the cached vector:
   ```bash
   docker compose exec redis redis-cli KEYS "embed:*"
   ```
   You should see keys appear after the first ask.
4. (Optional) Watch the bridge logs — on the second identical question there is
   **no** "Ollama embed" activity because it's served from cache.

---

## Expected Impact

- Identical repeated questions: **100% of the Ollama work removed** for them.
- The more your users repeat common questions (they always do), the more Ollama
  load drops. Combined with the semaphore (Task 2), Ollama stays healthy even
  under bursts.
- The bigger win — matching *similar* (not identical) questions — comes later in
  Task 10 (semantic response cache). This task is the safe, exact-match layer.

---

## Status

✅ **Task 6 complete.** Next up: **Task 7 — Cap Gemini Sessions** (protects RAM
by limiting how many live Gemini sessions exist at once).
