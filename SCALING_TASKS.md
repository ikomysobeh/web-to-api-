# Scaling Tasks — Ordered Checklist

This is the do-list built from all our research (`SCALING_MASTER_PLAN.md` +
`RAG_OPTIMIZATION_RESEARCH.md`). Tasks are ordered: **do the top ones first.**

Legend:
- 🔴 **Critical** — do before real users arrive
- 🟡 **Important** — do when traffic grows
- 🟢 **Later** — only if you outgrow the VPS
- Effort: ⏱️ small / ⏱️⏱️ medium / ⏱️⏱️⏱️ large

---

## PHASE 1 — Safety (before launch) 🔴

These stop the app from crashing. Cheap and safe.

### ☐ Task 1 — Database Connection Pool 🔴 ⏱️
- **File:** `webai-bridge/database.py`
- **What:** replace `get_connection()` (opens new connection every time) with
  `psycopg2.pool.ThreadedConnectionPool` (min 5, max 20). Add `release_connection()`.
- **Also:** change every `conn.close()` in the codebase to `release_connection(conn)`.
- **Why first:** without it, ~100+ concurrent requests exhaust PostgreSQL and
  users get errors. This is the #1 real risk.
- **Risk if skipped:** hard failures under load.

### ☐ Task 2 — Ollama Semaphore 🔴 ⏱️
- **File:** `webai-bridge` (wherever `search_chunks` / embeddings are called)
- **What:** wrap the Ollama embedding call in `asyncio.Semaphore(2)`.
- **Why:** Ollama processes sequentially — 5 concurrent calls = 45-second spikes.
  The semaphore caps it at 2 so it never floods.
- **Risk if skipped:** the whole app freezes when a few users message at once.

### ☐ Task 3 — Set OLLAMA_NUM_PARALLEL 🔴 ⏱️
- **File:** Ollama service config on the VPS (systemd override or env)
- **What:** `OLLAMA_NUM_PARALLEL=2` and `OLLAMA_FLASH_ATTENTION=1`.
- **Why:** the other half of Task 2 — tells Ollama itself not to process more
  than 2 at once. Must match the semaphore number.
- **Note:** Task 2 (app) and Task 3 (Ollama) work as a pair.

### ☐ Task 4 — HNSW Index on document_chunks 🔴 ⏱️
- **File:** `webai-bridge/database.py` (in `init_db`) or a one-time SQL run
- **What:** create an HNSW index on the embedding column of `document_chunks`.
- **Why:** makes vector search near-instant; removes pgvector as a bottleneck.
- **Risk if skipped:** search gets slow as documents grow.

**✅ After Phase 1: KVM 2 can safely launch for a few hundred users.**

---

## PHASE 2 — Performance (when traffic grows) 🟡

These make it fast and let you use both CPUs fully.

### ☐ Task 5 — Add Redis Container 🟡 ⏱️
- **File:** `docker-compose.yml`
- **What:** add a `redis` service (~50 MB RAM). This is the shared cache store.
- **Why:** needed before Tasks 6, 7, 8. Also required so multiple Gunicorn
  workers (Task 9) share ONE cache instead of separate copies.

### ☐ Task 6 — Embedding Cache (Layer 1) 🟡 ⏱️⏱️
- **File:** `webai-bridge` embedding function
- **What:** before calling Ollama, check Redis for `embed:<hash(text)>`. If found,
  reuse the vector. If not, embed once and store it (TTL ~1 hour).
- **Why:** identical questions skip Ollama entirely. 100% safe (exact match only).
- **Depends on:** Task 5.

### ☐ Task 7 — Cap Gemini Sessions 🟡 ⏱️⏱️
- **File:** WebAI-to-API session manager
- **What:** limit active Gemini sessions to ~30-40; evict the least-recently-used.
- **Why:** each session uses RAM; 300 sessions would exhaust 8 GB.
- **Risk if skipped:** out-of-memory crash with many connected users.

### ☐ Task 8 — Rate Limiting 🟡 ⏱️
- **File:** `webai-bridge/main.py`
- **What:** add `slowapi` limiter, e.g. `20/minute` per user on the chat endpoint.
- **Why:** stops one user from starving everyone else.

### ☐ Task 9 — Gunicorn Workers 🟡 ⏱️
- **File:** bridge Dockerfile / start command
- **What:** run `gunicorn main:app -k uvicorn.workers.UvicornWorker --workers 3`.
- **Why:** uses both CPUs; benchmark showed 320 → 1,210 req/s.
- **⚠️ Depends on:** Task 1 (pool must be per-worker-safe) + Task 5 (shared Redis
  cache) — do NOT do this before those or each worker gets its own cache/pool.

---

## PHASE 3 — Scale (only if you outgrow KVM 2) 🟢

### ☐ Task 10 — Semantic Response Cache (Layer 3) 🟢 ⏱️⏱️⏱️
- **What:** cache full answers; return them for *similar* questions (cosine
  similarity > 0.95, per-agent, with TTL).
- **Why:** the big win — research shows 60-80% fewer Ollama+Gemini calls.
- **⚠️ Care:** loose threshold can return wrong answers. Tune with real traffic.

### ☐ Task 11 — Search-Result Cache (Layer 2) 🟢 ⏱️⏱️
- **What:** cache which chunks matched a vector (TTL ~30 min).
- **Why:** skips pgvector on repeats. Lower priority (Task 4 already made it fast).

### ☐ Task 12 — Move Embeddings to Google API 🟢 ⏱️⏱️
- **What:** replace Ollama with Google `text-embedding-005` ($0.00625/1M tokens).
- **Why:** removes the CPU bottleneck entirely; frees ~2 GB RAM + both CPUs.
- **When:** the day the VPS feels maxed. Cost is cents/month at your scale.

### ☐ Task 13 — Split Services to Separate VPS 🟢 ⏱️⏱️⏱️
- **What:** move Ollama and/or PostgreSQL onto their own machine.
- **Why:** true horizontal scaling. Only needed at thousands of active users.

---

## QUICK REFERENCE — What To Do Right Now

| Order | Task | Phase | Effort |
|---|---|---|---|
| 1 | DB connection pool | 🔴 | ⏱️ |
| 2 | Ollama semaphore | 🔴 | ⏱️ |
| 3 | OLLAMA_NUM_PARALLEL=2 | 🔴 | ⏱️ |
| 4 | HNSW index | 🔴 | ⏱️ |
| — | *(launch here — safe for hundreds of users)* | | |
| 5 | Redis container | 🟡 | ⏱️ |
| 6 | Embedding cache | 🟡 | ⏱️⏱️ |
| 7 | Cap Gemini sessions | 🟡 | ⏱️⏱️ |
| 8 | Rate limiting | 🟡 | ⏱️ |
| 9 | Gunicorn workers | 🟡 | ⏱️ |
| 10+ | Semantic cache, hosted API, split | 🟢 | later |

---

## Dependency Notes (important)

- **Task 2 + Task 3 are a pair** — same number (2). Do together.
- **Task 9 needs Task 1 + Task 5 first** — multiple workers must share the pool
  and cache, or each worker duplicates them.
- **Tasks 6, 10, 11 all need Task 5 (Redis)** first.

---

## Recommendation

Do **Tasks 1–4 now** (all small, all safe, all critical). That's your launch
readiness. Everything else waits until you can watch real traffic and add only
what you actually need.
