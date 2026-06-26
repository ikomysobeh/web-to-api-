# Resource Usage Guide — Uploads, Embeddings, and VPS Requirements

---

## What This Document Covers

When a user uploads a document, the system does a lot of work.
This document explains exactly what happens, how much RAM and CPU each step uses,
and what VPS size you need.

---

## The Upload Pipeline — Step by Step

When an admin uploads a file, here is the exact sequence of events:

```
1. Browser sends the file to the bridge
        ↓
2. Bridge receives the file in memory (RAM spike)
        ↓
3. Bridge extracts text from the file (CPU: low)
        ↓
4. Bridge splits text into chunks (~1500 chars each) (CPU: very low)
        ↓
5. Bridge loops through each chunk:
        → sends chunk text to Ollama (HTTP call)
        → Ollama runs the embedding model (CPU: HIGH per chunk)
        → Ollama returns 768 numbers
        → Bridge saves numbers to PostgreSQL
        ↓
6. Upload complete
```

The bottleneck is **Step 5** — Ollama has to process each chunk one by one.
The more chunks a document has, the longer it takes and the more CPU is used.

---

## How Many Chunks Does a Document Create?

Our chunk size is **1500 characters**. Here is what that means for real documents:

| Document Size | Approximate Characters | Approximate Chunks | Upload Time (estimate) |
|--------------|----------------------|--------------------|----------------------|
| 1-page TXT | ~3,000 | 2 | < 1 second |
| 5-page PDF | ~12,500 | 8–10 | 5–15 seconds |
| 20-page PDF | ~50,000 | 30–35 | 20–60 seconds |
| 100-page PDF | ~250,000 | 160–170 | 2–5 minutes |
| 500-page book | ~1,250,000 | 830+ | 15–30 minutes |

**Why does it take time?** Each chunk requires one round-trip call to Ollama.
Ollama processes one chunk at a time on CPU. Each chunk takes 50–200ms depending on your server CPU.

---

## RAM Usage — Full Stack Breakdown

This is how much RAM each part of the system uses when everything is running:

### The Whole Stack Together

| Service | RAM When Idle | RAM During Upload | Notes |
|---------|--------------|-------------------|-------|
| PostgreSQL + pgvector | 256 MB | 400–600 MB | Grows with more data in cache |
| NATS JetStream | 50 MB | 50 MB | Very lightweight |
| Bridge (Python FastAPI) | 150 MB | 200–300 MB | File held in memory during upload |
| Ollama (server itself) | 100 MB | 100 MB | Just the server process |
| nomic-embed-text model | 500 MB | 500–700 MB | Model stays loaded in RAM after first use |
| OS + Linux kernel | 300–500 MB | 300–500 MB | Always used |
| **TOTAL** | **~1.4 GB** | **~1.7–2.2 GB** | — |

### What "Model Stays Loaded" Means

The first time Ollama receives an embedding request, it loads the model into RAM.
That takes **10–30 seconds** and uses **~500MB RAM**.

After that, the model **stays in RAM forever** (until you restart Ollama).
Every subsequent call is fast (50–200ms) because the model is already loaded.

**Important:** If your VPS does not have enough free RAM, the OS will swap the model to disk.
This makes every embedding call extremely slow (30–120 seconds per chunk instead of 0.2 seconds).
If you see uploads taking 10+ minutes for a small document, this is why.

---

## CPU Usage — What Happens During Upload

### Idle (no uploads happening)

```
PostgreSQL: ~1–3% (background tasks)
NATS:       ~0.1%
Bridge:     ~0.1%
Ollama:     ~0% (waiting)
Total:      ~2–5%
```

### During a Document Upload

Every time a chunk is embedded, Ollama uses a burst of CPU:

```
Chunk embedding in progress:
  Ollama: 80–100% of ONE CPU core for 50–200ms
  Bridge: 5% (waiting for Ollama response)
  Total:  ~85–100% of 1 core, in short bursts

Between chunks:
  Total:  ~5%
```

**Example: 20-page PDF (35 chunks)**

```
Time 0s:    Upload received, text extracted
Time 1s:    Chunk 1 sent to Ollama → CPU spike → chunk stored
Time 3s:    Chunk 2 sent to Ollama → CPU spike → chunk stored
...
Time ~75s:  Chunk 35 stored, upload complete
```

The CPU spikes are short but happen repeatedly. On a 1-core VPS,
uploading a large document will make the CPU very busy for several minutes.

### Two Users Uploading at the Same Time

Ollama processes one embedding at a time. If two uploads happen simultaneously:
- One runs, the other waits
- Total time doubles
- CPU stays at ~100% of 1 core for longer

On a 2-core VPS, the second core still handles web requests during this time.
On a 1-core VPS, everything else slows down during heavy uploads.

---

## Disk Usage

| What | Size |
|------|------|
| nomic-embed-text model (downloaded) | 274 MB |
| PostgreSQL data (empty) | ~50 MB |
| PostgreSQL per 1,000 chunks stored | ~30–50 MB |
| PostgreSQL per 10,000 chunks stored | ~300–500 MB |
| NATS data | ~10 MB |
| Docker images (all services) | ~2–3 GB |

**1,000 chunks ≈ 30–40 documents of 20–30 pages each.**

---

## VPS Size Recommendations

### Minimum — 1 CPU, 2 GB RAM

```
Can run: Yes, but barely
Uploads: Slow — small files only (< 20 pages recommended)
Problem: RAM is very tight
         If all services run + Ollama model loaded = ~1.7GB used out of 2GB
         Almost no room left
Verdict: Only for testing. Not recommended for real use.
```

### Recommended — 2 CPU, 4 GB RAM

```
Can run: Yes, comfortably
Uploads: Medium files work well (up to 100 pages)
RAM left: ~1.8 GB free after everything loads
CPU: 2 cores means uploads don't block web requests
Verdict: Good for small production use (up to ~10 active users)
```

### Better — 4 CPU, 8 GB RAM

```
Can run: Yes, very well
Uploads: Large files work (500+ pages)
RAM left: ~5.8 GB free — PostgreSQL can cache a lot of data
CPU: 4 cores handles multiple uploads + web traffic
Verdict: Recommended for real production use
```

### Large — 8 CPU, 16 GB RAM

```
Can run: Excellent
Uploads: Any size, multiple at once
Verdict: Handles 50+ concurrent users and large document libraries
```

---

## What Happens When RAM Runs Out

This is the most important thing to understand.

When RAM is full, Linux uses **swap space** (writing RAM contents to disk).
Disk is 100x slower than RAM.

**Signs that your VPS is running out of RAM:**

| Symptom | Cause |
|---------|-------|
| Upload takes 10+ minutes for a 5-page file | Ollama model swapped to disk |
| Bridge becomes unresponsive after an upload | OS killed a process to free RAM |
| PostgreSQL returns errors | PostgreSQL killed by OOM killer |
| Docker container restarts randomly | Container exceeded memory limit |

**How to check RAM on your VPS:**

```bash
free -h
```

Example output:
```
              total  used   free   shared  buff/cache  available
Mem:          3.8Gi  2.1Gi  400Mi  50Mi    1.3Gi       1.7Gi
Swap:         1.0Gi  200Mi  800Mi
```

- `available` is the important number — how much RAM you can actually use
- If `available` is less than 500MB, you are in danger
- If `Swap` used is high, you are already swapping — things will be slow

---

## How to Monitor Resource Usage

### Check RAM and CPU in real time

```bash
htop
```

This shows every process, sorted by CPU or RAM. Press `q` to exit.

### Check Docker containers specifically

```bash
docker stats
```

This shows RAM and CPU for each container in real time:

```
CONTAINER        CPU %   MEM USAGE / LIMIT   MEM %
webai-bridge     0.1%    180MB / 4GB          4.5%
webai-postgres   0.5%    310MB / 4GB          7.7%
webai-nats       0.0%    52MB  / 4GB          1.3%
```

### Check disk usage

```bash
df -h
```

### Check if Ollama is using RAM

```bash
ollama ps
```

This shows which models are currently loaded in RAM:

```
NAME                  ID        SIZE   PROCESSOR  UNTIL
nomic-embed-text:...  abc123    562MB  CPU        4 minutes from now
```

**Note:** Ollama automatically unloads the model after 5 minutes of no requests.
This frees the ~500MB RAM. The next request will reload it (10–30 second delay).

---

## Tips to Reduce Resource Usage

### 1. Set a file size limit for uploads

In the bridge, add a maximum file size check before processing.
A 500-page PDF will use your CPU for 20+ minutes — that may not be acceptable.

Recommended limits:
- Small VPS (2GB RAM): max 10MB file, max 50-page PDF
- Medium VPS (4GB RAM): max 50MB file, max 200-page PDF
- Large VPS (8GB RAM): no practical limit

### 2. Keep Ollama model loaded

By default, Ollama unloads the model after 5 minutes of no requests.
The next request waits 10–30 seconds for it to reload.

To keep the model always loaded, increase the keep-alive time.
Add this to Ollama's environment:
```
OLLAMA_KEEP_ALIVE=24h
```

This costs ~500MB RAM permanently but removes the reload delay.

### 3. Use a smaller model for low-RAM VPS

If you only have 2GB RAM, use `all-minilm` instead of `nomic-embed-text`:

```bash
ollama pull all-minilm
```

| | all-minilm | nomic-embed-text |
|--|-----------|-----------------|
| RAM used | ~100MB | ~500MB |
| Disk size | 46MB | 274MB |
| Dimensions | 384 | 768 |
| Quality | Good | Very good |
| **DB change needed** | YES — must change `vector(384)` | No change |

**Warning:** Changing models requires changing the `vector(768)` column to `vector(384)` in the database,
and re-uploading all documents (old embeddings are incompatible with a different model).

### 4. Run uploads at low-traffic times

If possible, schedule large document uploads during off-hours.
This avoids CPU competition with user chat requests.

### 5. Use HNSW index instead of IVFFlat for better performance

Our current index is `IVFFlat`. HNSW is faster for queries but uses more RAM.

```sql
-- Current (IVFFlat) — lower memory
CREATE INDEX document_chunks_embedding_idx
ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Alternative (HNSW) — faster queries, more memory
CREATE INDEX document_chunks_embedding_idx
ON document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

For a VPS with < 4GB RAM, keep IVFFlat (current setting).
For 4GB+ RAM, HNSW gives faster search responses.

---

## Real Numbers — Concrete Examples

### Example 1: Small company, 10 agents, each with 5 documents (20 pages each)

```
Documents: 10 × 5 = 50 documents
Chunks:    50 × ~35 chunks = ~1,750 chunks
RAM for vectors: ~50MB additional in PostgreSQL
Disk for vectors: ~80MB
Upload time per document: ~1 minute
Search time per query: < 100ms
```

→ **A 2GB VPS handles this fine.**

### Example 2: Medium company, 50 agents, each with 20 documents (100 pages each)

```
Documents: 50 × 20 = 1,000 documents
Chunks:    1,000 × ~165 chunks = ~165,000 chunks
RAM for vectors: ~2GB additional in PostgreSQL
Disk for vectors: ~5GB
Upload time per document: ~3 minutes
Search time per query: < 200ms
```

→ **Needs at least a 4GB VPS, preferably 8GB.**

### Example 3: One user uploads a 500-page PDF

```
Characters: ~1,250,000
Chunks:     ~830
Upload time: 15–30 minutes on a 2-core VPS
CPU during upload: ~100% of 1 core the entire time
RAM spike: +50MB (file in memory during extraction)
After upload: ~25MB extra stored in PostgreSQL
```

→ **This is a resource-intensive operation. Warn users before they try it.**

---

## Summary Table — Quick Reference

| VPS Size | Can It Run? | Max Doc Size | Max Users | Notes |
|----------|-------------|--------------|-----------|-------|
| 1 CPU, 2GB RAM | Barely | 20 pages | 1–2 | Testing only |
| 2 CPU, 4GB RAM | Yes | 100 pages | 5–10 | Good for small production |
| 4 CPU, 8GB RAM | Very well | 500 pages | 20–30 | Recommended |
| 8 CPU, 16GB RAM | Excellent | Any size | 50+ | Large production |

| Resource | Idle | Small Upload | Large Upload |
|----------|------|-------------|--------------|
| RAM | ~1.4 GB | +100 MB | +200 MB |
| CPU | ~5% | ~50% (1 core) | ~100% (1 core) |
| Disk write | Low | Medium | High |
| Time | — | < 1 min | 5–30 min |

---

## The Most Important Rule

> **Never run the full stack on a VPS with less than 3GB RAM available.**
>
> The Ollama model (500MB) + PostgreSQL (400MB) + Bridge (200MB) + NATS (50MB) + OS (400MB)
> already uses ~1.55GB just at idle. You need headroom for uploads and user requests.
>
> If your VPS only has 2GB total RAM, use the smaller `all-minilm` model (100MB) instead.
