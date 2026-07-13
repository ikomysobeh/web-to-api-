# Scaling Master Plan — Everything We Learned

This is the complete picture from all research. It combines caching, Ollama
tuning, database (pgvector), FastAPI workers, and hosted-API options into one
plan for your Hostinger KVM 2 (2 vCPU, 8 GB RAM).

Read this top to bottom. Nothing here is code — it's the strategy.

---

## THE MOST IMPORTANT NUMBER WE FOUND

> **"Latency can spike from 2 seconds to over 45 seconds with just five
> concurrent users"** on Ollama, because it processes embeddings
> **sequentially** (one at a time per model by default).

This confirms your worry was 100% correct. **Ollama is THE bottleneck.**
Everything in this plan is built around protecting or replacing it.

---

## THE 5 AREAS (and what we found for each)

```
1. Ollama          ← the bottleneck. Tune it or replace it.
2. Caching         ← avoid calling Ollama at all (60-80% of the time)
3. pgvector        ← make the DB search fast with the right index
4. FastAPI workers ← use both CPUs properly
5. Hosted API      ← the escape hatch if you outgrow the VPS
```

---

## AREA 1 — Ollama Tuning

### What we learned
- Ollama defaults to processing **1 request at a time** (sometimes 4 if it has
  memory). Extra requests **queue**.
- There is an environment variable: **`OLLAMA_NUM_PARALLEL`** that controls how
  many requests run at once.
- More parallel = more throughput BUT more CPU + RAM pressure.

### What to do on YOUR VPS
```
OLLAMA_NUM_PARALLEL=2     # match your 2 CPUs — no more
OLLAMA_FLASH_ATTENTION=1  # small speed boost
```
Setting it higher than your CPU count makes things WORSE (context switching).

### The critical pairing
`OLLAMA_NUM_PARALLEL=2` on Ollama's side **must be paired with a semaphore of 2
on the app side.** They are two halves of the same control:
- Semaphore (app) = "don't SEND more than 2 at once"
- `OLLAMA_NUM_PARALLEL` (Ollama) = "don't PROCESS more than 2 at once"

Together they guarantee Ollama never gets a queue that explodes to 45 seconds.

---

## AREA 2 — Caching (the biggest win, from last research)

Recap of the 3 layers (full detail in `RAG_OPTIMIZATION_RESEARCH.md`):

| Layer | Skips | Safety | When |
|---|---|---|---|
| 1. Embedding cache | Ollama call | 100% safe | Do first |
| 2. Search cache | pgvector | safe | Later |
| 3. Semantic response cache | Everything | tune threshold | Big win, later |

**Combined with the semaphore, caching means:** even if 50 users message at
once, ~35 are served from cache (no Ollama), and the ~15 real ones queue only
2-at-a-time through Ollama safely.

---

## AREA 3 — pgvector Index (NEW findings)

Right now your vector search may have no proper index, or the wrong one. The
research is clear:

### HNSW vs IVFFlat

| | HNSW | IVFFlat |
|---|---|---|
| Best for | **most apps (your case)** | 50M+ vectors, mostly static |
| Search speed | scales logarithmically (stays fast) | scales linearly (slows down) |
| Build time | slower | 5-6x faster |
| Accuracy | better | good |
| **Verdict for you** | ✅ **Use HNSW** | ❌ not needed at your scale |

### What to do
Create an **HNSW index** on your `document_chunks` embedding column. Key settings:
- `m` — connections per node (default 16 is fine)
- `ef_construction` — higher = better accuracy, slower build (default 64 fine)
- `hnsw.ef_search` — query-time knob; raise for accuracy, lower for speed

At your scale (thousands, not millions of chunks), a default HNSW index makes
vector search **near-instant** and removes pgvector from the list of worries
entirely.

---

## AREA 4 — FastAPI Workers (NEW findings)

### What we learned
- FastAPI runs on Uvicorn. Behind **Gunicorn** with multiple workers, throughput
  jumped from **320 → 1,210 requests/sec** in the benchmark, latency **85ms → 22ms**.
- Worker count rule:
  - **I/O-bound work** (DB calls, calling Gemini/Ollama over HTTP) → more workers OK
  - **CPU-bound work** → workers = CPU count

### What to do on YOUR VPS
Your bridge is almost entirely **I/O-bound** (it waits on Gemini, Ollama, DB).
So you can safely run a few workers even on 2 CPUs:
```
gunicorn main:app -k uvicorn.workers.UvicornWorker --workers 3 --bind 0.0.0.0:8000
```
> ⚠️ **Important caveat for you:** multiple workers = multiple processes. The
> **connection pool and any in-memory cache must be per-worker or shared via
> Redis.** This is exactly why the research recommends **Redis** for caching —
> so all workers share one cache instead of each having its own.

### Also from research
> "The single biggest win is writing endpoints as `async` whenever the work is
> I/O-bound."

Your chat/embedding endpoints already use `async` + `httpx.AsyncClient` — good.
Just make sure DB calls don't block. (Long-term: `asyncpg` instead of `psycopg2`.)

---

## AREA 5 — Hosted Embedding API (the escape hatch)

If you ever outgrow the VPS, move embeddings off Ollama. Real prices found:

| Provider | Model | Price per 1M tokens | Quality |
|---|---|---|---|
| **Google** | text-embedding-005 | **$0.00625** (cheapest hosted) | good |
| OpenAI | text-embedding-3-small | $0.02 | very good |
| OpenAI | text-embedding-3-large | $0.13 | best |
| **Ollama (you now)** | nomic-embed-text | **$0 but uses your CPU** | matches OpenAI-large within 1.5 pts |

### The key insight
> Nomic-Embed-Text (what you use) **matches OpenAI's best model within 1.5
> points** on RAG accuracy, at **zero cost** and **zero data leakage**.

**So your model choice is already excellent.** The only reason to switch to a
hosted API is to **offload the CPU work**, not for quality. Since embeddings are
tiny questions, even at hundreds of users your monthly cost on Google's API
would be a **few cents to a couple dollars** — and it frees ~2 GB RAM + both CPUs.

---

## THE COMPLETE PICTURE — Request Flow (Target State)

```
User message
    │
    ▼
FastAPI (Gunicorn, 3 async workers)  ← uses both CPUs, shares Redis
    │
    ▼
Redis: semantic response cache?  ──YES──► return saved answer (0 Ollama, 0 Gemini)
    │ NO
    ▼
Redis: embedding cache?          ──YES──► reuse vector (0 Ollama)
    │ NO
    ▼
Semaphore(2) → Ollama (NUM_PARALLEL=2)   ← max 2 at once, never floods
    │
    ▼
pgvector HNSW index              ← near-instant search
    │
    ▼
Gemini (per-user session, capped at ~30-40)
    │
    ▼
Save answer + cache it in Redis
```

---

## FINAL PRIORITY LIST (what to actually do, in order)

### Phase 1 — Safety (do before launch)
1. ✅ **DB connection pool** (psycopg2.pool) — stops connection exhaustion
2. ✅ **Ollama semaphore (2)** + **`OLLAMA_NUM_PARALLEL=2`** — stops the 45s spike
3. ✅ **HNSW index** on document_chunks — fast search

### Phase 2 — Performance (when you get real traffic)
4. **Redis** container + **embedding cache** — cuts most Ollama calls
5. **Gunicorn 3 workers** — uses both CPUs fully
6. **Cap Gemini sessions** (~30-40) — protects RAM

### Phase 3 — Scale (only if you outgrow KVM 2)
7. **Semantic response cache** — the 60-80% reduction
8. **Move embeddings to Google API** — removes CPU bottleneck entirely
9. **Separate Ollama / DB onto their own VPS** — horizontal split

---

## ONE-LINE TAKEAWAYS

- **Ollama sequential processing is the real danger** — semaphore + NUM_PARALLEL fixes it.
- **Caching is the multiplier** — 60-80% of requests can skip Ollama entirely.
- **HNSW index** makes pgvector a non-issue at your scale.
- **Gunicorn workers + Redis** let you use both CPUs and share one cache.
- **Your embedding model is already great** — hosting it elsewhere is about CPU, not quality.
- **KVM 2 is enough to launch** with Phase 1 done. Google's API is your infinite-scale button later.

---

## Sources

**Ollama / concurrency**
- [How Ollama Handles Parallel Requests](https://www.glukhov.org/llm-performance/ollama/how-ollama-handles-parallel-requests/)
- [Optimizing Ollama Performance (Medium)](https://medium.com/@kapildevkhatik2/optimizing-ollama-performance-on-windows-hardware-quantization-parallelism-more-fac04802288e)
- [Ollama Embedded Models 2025 Guide (Collabnix)](https://collabnix.com/ollama-embedded-models-the-complete-technical-guide-to-local-ai-embeddings-in-2025/)

**pgvector indexing**
- [Tuning pgvector Performance (ParadeDB)](https://www.paradedb.com/learn/postgresql/tuning-pgvector)
- [IVFFlat vs HNSW in pgvector (DEV)](https://dev.to/philip_mcclarence_2ef9475/ivfflat-vs-hnsw-in-pgvector-which-index-should-you-use-305p)
- [Optimize with pgvector indexing (AWS)](https://aws.amazon.com/blogs/database/optimize-generative-ai-applications-with-pgvector-indexing-a-deep-dive-into-ivfflat-and-hnsw-techniques/)

**Embedding model comparison / pricing**
- [Local vs OpenAI Embeddings Benchmark](https://localaimaster.com/blog/local-vs-openai-embeddings)
- [Embedding Models: OpenAI vs Gemini vs Cohere](https://aimultiple.com/embedding-models)
- [OpenAI Embedding Pricing 2026 (TokenMix)](https://tokenmix.ai/blog/openai-embedding-pricing)

**FastAPI scaling**
- [Mastering Gunicorn and Uvicorn (Medium)](https://medium.com/@iklobato/mastering-gunicorn-and-uvicorn-the-right-way-to-deploy-fastapi-applications-aaa06849841e)
- [FastAPI production deployment best practices (Render)](https://render.com/articles/fastapi-production-deployment-best-practices)
- [Building High-Concurrency APIs with FastAPI + Uvicorn](https://medium.com/@majidbasharat21/building-high-concurrency-apis-using-fastapi-uvicorn-workers-a901981b3e36)
