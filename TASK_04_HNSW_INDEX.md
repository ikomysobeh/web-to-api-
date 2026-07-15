# Task 4 — HNSW Vector Index ✅ DONE

## What This Task Fixed

Your vector search had an **IVFFlat** index. The research showed HNSW is the
better choice for your scale. This task **replaces IVFFlat with HNSW** so vector
search stays fast and accurate as your documents grow.

**Plain terms:** an index is what makes "find the 5 most similar chunks" fast.
Without a good index, PostgreSQL compares the query against *every* stored chunk
(slow). HNSW lets it jump straight to the likely matches.

---

## IVFFlat vs HNSW (why we switched)

| | IVFFlat (old) | HNSW (new) |
|---|---|---|
| Search speed as data grows | slows down **linearly** | stays fast (**logarithmic**) |
| Accuracy (recall) | good | **better** |
| Needs retraining? | **yes** — clusters go stale after many inserts | **no** — self-maintaining |
| Best for | 50M+ mostly-static rows | **most apps (you)** |

The killer reason: IVFFlat builds "clusters" from your data at index-creation
time. As you add/remove document chunks, those clusters become **stale** and
search quality drops until you manually `REINDEX`. HNSW has no such problem — it
stays accurate automatically.

---

## File Changed

### `webai-bridge/database.py` (in `init_db`)

**Before:**
```sql
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100)
```

**After:**
```sql
DROP INDEX IF EXISTS document_chunks_embedding_idx;   -- remove old IVFFlat

CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
ON document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
```

The `DROP INDEX IF EXISTS` line matters: existing databases already have the old
IVFFlat index. This removes it so you don't end up with two indexes competing.
On a fresh database the DROP simply does nothing.

---

## The Settings Explained

```
m = 16              → how many connections each node keeps in the graph.
                      Higher = more accurate but more memory/build time.
                      16 is the pgvector default and ideal for your scale.

ef_construction = 64 → how hard it works while BUILDING the index.
                      Higher = better quality index, slower to build.
                      64 is the default — good balance.
```

There is also a **query-time** knob, `hnsw.ef_search` (default 40):
- Higher = more accurate results, slightly slower search
- Lower = faster search, slightly less accurate
- The default (40) is fine for you. If you ever want more accuracy, you can raise
  it per query with `SET hnsw.ef_search = 100;` — not needed now.

---

## Will This Break Anything?

No.
- **Same query code** — `search_chunks()` doesn't change. It still runs
  `embedding <=> query::vector`. Only the index behind it changed.
- **Same results** — HNSW returns the same nearest chunks (with equal or better
  accuracy).
- **Safe on existing data** — at your scale (thousands of chunks) the index
  rebuilds instantly on next startup.
- **Requires pgvector 0.5.0+** — your Docker image `pgvector/pgvector:pg16`
  includes it. ✓

---

## How To Apply & Verify

1. Rebuild/restart the bridge (init_db runs on startup and swaps the index):
   ```bash
   docker compose up -d --build bridge
   ```
2. Confirm the new index exists in PostgreSQL:
   ```sql
   \d document_chunks
   ```
   You should see `document_chunks_embedding_hnsw_idx` using `hnsw`, and the old
   `document_chunks_embedding_idx` should be gone.

3. Search behaves the same for users — just faster and more accurate under growth.

---

## Where This Fits

This was the last **code** task in Phase 1 safety. Status so far:

| Task | Status |
|---|---|
| 1. DB connection pool | ✅ code done |
| 2. Ollama semaphore | ✅ code done |
| 3. OLLAMA_NUM_PARALLEL | ✅ server config (apply on VPS) |
| 4. HNSW index | ✅ code done |

**Phase 1 is complete.** After you rebuild and apply the Task 3 server config,
your KVM 2 is safe to launch for a few hundred users.

Phase 2 (Redis + caching + Gunicorn workers + rate limiting) is next — but only
when you actually have traffic. We can start it whenever you want.

---

## Status

✅ **Task 4 complete.** **Phase 1 (safety) finished.**
