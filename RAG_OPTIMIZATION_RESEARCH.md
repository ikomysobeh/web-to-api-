# RAG & Ollama Optimization — Research Results

**Goal:** reduce Ollama load and make the app fast + safe on a Hostinger KVM 2
(2 vCPU, 8 GB RAM), without breaking how it works.

This document is research + recommendations only. **No code changes yet.**

---

## The Core Fact (must understand first)

You cannot remove embedding on every message — RAG needs to embed the question
to search. BUT the research shows you can **avoid re-embedding the same or
similar questions** using caching. Real production systems reduce embedding/LLM
calls by **60–80%** this way.

So the winning strategy is not "remove Ollama" — it's **"only call Ollama when
you truly have a new, unseen question."**

---

## The 3 Layers of Caching (from the research)

Production RAG systems cache at 3 levels. Each one saves a different cost.

```
┌──────────────────────────────────────────────────────────┐
│  User asks a question                                     │
│         │                                                 │
│         ▼                                                 │
│  LAYER 3: Semantic response cache                         │
│   "Has someone asked something SIMILAR before?"           │
│   → if yes: return the saved answer instantly (skip ALL)  │
│         │ no                                              │
│         ▼                                                 │
│  LAYER 1: Embedding cache                                 │
│   "Have we embedded this EXACT text before?"              │
│   → if yes: reuse the vector (skip Ollama)                │
│         │ no → call Ollama once, then store it            │
│         ▼                                                 │
│  LAYER 2: Search-result cache                             │
│   "Did we already find chunks for this vector?"           │
│   → if yes: reuse the chunk list (skip pgvector)          │
│         │ no                                              │
│         ▼                                                 │
│  Run full pipeline, send to Gemini, save everything       │
└──────────────────────────────────────────────────────────┘
```

### Layer 1 — Embedding Cache (easiest, do first)

**What:** store the vector for each text you embed. If the identical text comes
again, reuse the vector instead of calling Ollama.

- **Key:** a hash of the exact question text
- **Skips:** the Ollama call
- **Best for:** identical repeated questions ("What are your opening hours?")
- **TTL suggested by research:** ~1 hour
- **Laravel comparison:** `Cache::remember('embed:'.md5($text), 3600, fn() => ...)`

### Layer 2 — Search-Result Cache

**What:** store which document chunks matched a given question. Skip the pgvector
search on a repeat.

- **Skips:** the database vector search
- **TTL suggested by research:** ~30 minutes (shorter, because documents can change)

### Layer 3 — Semantic Response Cache (most powerful)

**What:** store the full final answer. When a **similar** (not identical) question
comes, return the saved answer instantly — skipping Ollama, pgvector, AND Gemini.

- **How it decides "similar":** compares the new question's vector to cached
  question vectors using cosine similarity. If similarity > threshold (e.g. 0.95),
  it's a match.
- **Skips:** everything — the entire pipeline
- **Research result:** 61–69% cache hit rate, up to 80% latency reduction,
  ~3,600 fewer LLM calls per year in a typical app
- **Risk:** if the threshold is too loose, it may return a slightly-wrong answer
  for a different question. Keep the threshold **high** (strict).

---

## Performance Numbers From the Research

| Technique | Measured impact |
|---|---|
| Multi-level caching (Redis) | 2.5s → 400ms average response |
| Query caching | up to 70% latency reduction |
| Semantic caching | 61–69% of calls served from cache |
| RAGCache (advanced) | up to 80% latency reduction |

---

## What This Means For YOUR VPS

Your bottleneck is 2 CPUs doing Ollama embeddings. Caching directly attacks that:

```
Without cache:  every message → Ollama (CPU spike)
With cache:     ~65% of messages → served from RAM (no CPU)
                 only ~35% actually hit Ollama
```

**Effectively, caching triples the number of users your 2 CPUs can serve** —
because most messages never reach Ollama.

---

## Recommended Plan For You (in order)

### Tier 1 — Do these (cheap, high impact, safe)

1. **Semaphore on Ollama** — cap concurrent embeddings at 2–3 (matches 2 CPUs).
   Prevents the crash. This is the safety net.
2. **Embedding cache (Layer 1)** — reuse vectors for identical text.
   Biggest bang for the least code.
3. **DB connection pool** — (from the earlier scaling doc) safety essential.

### Tier 2 — Add when you have real traffic

4. **Semantic response cache (Layer 3)** — the big win, but needs a threshold
   you tune carefully. Add once you can watch real usage.
5. **Search-result cache (Layer 2)** — nice extra, lower priority.

### Tier 3 — Only if you outgrow the VPS

6. **Move embeddings to a hosted API** (Google / OpenAI embeddings) — removes
   the CPU load from your VPS entirely, scales infinitely, costs fractions of a
   cent per call.

---

## Where To Store The Cache

The research uses **Redis** for all caching. For your setup:

| Option | Pros | Cons |
|---|---|---|
| **Redis** (recommended) | fast, shared across restarts, has TTL + LRU built in, one Docker container | one more service (~50 MB RAM) |
| **Python in-memory dict / `lru_cache`** | zero setup | lost on restart, not shared between workers |
| **PostgreSQL table** | already have it | slower than Redis, more DB load |

**Recommendation:** you already run Docker — adding a Redis container is easy and
it's the standard tool. In Laravel terms, this is the exact same Redis you'd use
for `CACHE_DRIVER=redis`.

---

## A Warning From The Research (important)

> "Fixed similarity thresholds may not generalize across all use cases,
> potentially missing nuanced query variations."

Meaning: the **semantic cache (Layer 3)** can occasionally return a cached answer
for a question that looks similar but actually needs a different answer. Mitigate
by:
- Keeping the similarity threshold **strict** (0.95+)
- Making the cache **per-agent** (never share answers between different agents)
- Setting a **TTL** so answers refresh over time

The **embedding cache (Layer 1)** has no such risk — it only matches *identical*
text, so it's always safe. That's why it's the recommended first step.

---

## Bottom Line

1. **You don't remove Ollama — you cache around it.**
2. **Start with: semaphore + embedding cache + connection pool.** Cheap, safe,
   and enough for your KVM 2 to comfortably serve a few hundred users.
3. **Add the semantic response cache later** for the 60–80% reduction, once you
   have real traffic to tune the threshold against.
4. **If you ever outgrow the box, move embeddings to a hosted API** and the CPU
   problem disappears.

---

## Sources

- [RAG Latency Optimization End-to-End](https://dasroot.net/posts/2026/02/rag-latency-optimization-vector-database-caching-hybrid-search/)
- [Understanding Caching in RAG Systems (Medium)](https://medium.com/@shekhar.manna83/understanding-caching-in-retrieval-augmented-generation-rag-systems-implementation-d5d1918cc4bd)
- [RAG in Production: Deployment Strategies (Coralogix)](https://coralogix.com/ai-blog/rag-in-production-deployment-strategies-and-practical-considerations/)
- [Caching Strategies to Reduce RAG Latency and Cost (Ailog)](https://app.ailog.fr/en/blog/guides/caching-strategies-rag)
- [Semantic Caching for RAG Systems — The Production Gap](https://boringbot.substack.com/p/semantic-caching-for-rag-systems)
- [RAG Caching Strategies (apxml)](https://apxml.com/courses/optimizing-rag-for-production/chapter-4-end-to-end-rag-performance/caching-strategies-rag)
- [GPT Semantic Cache (arXiv)](https://arxiv.org/html/2411.05276v2)
- [From Exact Hits to Close Enough: Semantic Caching for LLM Embeddings (arXiv)](https://arxiv.org/html/2603.03301v1)
- [How to Reduce Cost and Latency Using Semantic LLM Caching (MarkTechPost)](https://www.marktechpost.com/2025/11/11/how-to-reduce-cost-and-latency-of-your-rag-application-using-semantic-llm-caching/)
- [Semantic Caching in RAG Systems & AI Agents (DEV)](https://dev.to/sreeni5018/semantic-caching-in-rag-systems-ai-agents-2gal)
