# Embedding 404 Error — Root Cause & Fix

## What the error says

```
HTTP/1.1 404 Not Found for url
'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=...'

Ingestion complete for 'acme_product_knowledge_base.pdf': stored=0, failed=5
```

Every chunk failed to embed. Zero chunks were stored. The document upload appeared to
succeed (HTTP 200 was returned to the browser) but nothing was actually saved to the
vector database.

---

## Root Cause — 3 problems stacked in one line

**File:** `webai-bridge/vector.py` lines 15–16

```python
# BEFORE (broken)
EMBED_MODEL = "models/text-embedding-004"
EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/{EMBED_MODEL}:embedContent?key={GEMINI_API_KEY}"
```

### Problem 1 — Wrong API version: `v1beta` should be `v1`

Google moved the stable embedding models from `v1beta` to the `v1` endpoint.  
`v1beta` still exists but `text-embedding-004` was removed from it.  
Using `v1beta` with a current API key returns `404 Not Found`.

**Before:** `.../v1beta/models/text-embedding-004:embedContent`  
**After:**  `.../v1/models/text-embedding-005:embedContent`

### Problem 2 — Outdated model: `text-embedding-004` should be `text-embedding-005`

Google released `text-embedding-005` in early 2025. It supersedes `004`.  
`text-embedding-004` is deprecated and no longer accessible through the `v1` endpoint.  
`text-embedding-005` still produces **768-dimension vectors** — the database schema
(`vector(768)`) does NOT need to change.

### Problem 3 — URL built once at module load time (secondary bug)

```python
# This line runs ONCE when Python imports vector.py
EMBED_URL = f"...?key={GEMINI_API_KEY}"
```

`GEMINI_API_KEY` is read from the environment at the moment the module loads.
If the variable is empty at import time, the URL is permanently broken for that
container run — even if the env var is fixed later. The URL is frozen.

---

## The Fix — what changed in `vector.py`

```python
# AFTER (fixed)
EMBED_MODEL = "models/text-embedding-005"   # v1 stable model

def _embed_url() -> str:
    """Build URL at call time so key changes take effect without restart."""
    key = os.getenv("GEMINI_API_KEY", "")
    return f"https://generativelanguage.googleapis.com/v1/{EMBED_MODEL}:embedContent?key={key}"
```

Every call to `embed_text()` and `embed_query()` now calls `_embed_url()` instead of
using the frozen `EMBED_URL` constant. This fixes all three problems at once:
- `v1` endpoint ✓
- `text-embedding-005` ✓
- Key read fresh on every call ✓

---

## Files Changed

| File | Line(s) | Change |
|---|---|---|
| `webai-bridge/vector.py` | 15–16 | Replaced `EMBED_MODEL` + `EMBED_URL` constant with `_embed_url()` function |
| `webai-bridge/vector.py` | 80 | `EMBED_URL` → `_embed_url()` in `embed_text()` |
| `webai-bridge/vector.py` | 105 | `EMBED_URL` → `_embed_url()` in `embed_query()` |

No other files need to change. The database schema (`vector(768)`) is compatible with
`text-embedding-005` because it still outputs 768 dimensions.

---

## How to Apply the Fix

The code is already patched. Rebuild just the bridge container:

```bash
docker compose up --build bridge
```

> No need to wipe the database (`-v`). The schema is unchanged.

---

## How to Test the Fix

### 1. Watch the logs while uploading

In one terminal:
```bash
docker compose logs -f bridge
```

In another terminal (or through the admin UI), upload a document to an agent.

### 2. You should see this in the logs (success)

```
INFO | Ingesting 'your-file.pdf' for agent <uuid>: 5 chunks
INFO | Ingestion complete for 'your-file.pdf': stored=5, failed=0
```

`stored=5, failed=0` means all chunks were embedded and saved.

### 3. If you still see 404

Check three things:

**a) Is GEMINI_API_KEY set?**
```bash
docker exec webai-bridge env | grep GEMINI
```
Should print: `GEMINI_API_KEY=AIza...` or `GEMINI_API_KEY=AQ...`  
If it prints `GEMINI_API_KEY=` (empty), the key is missing from your `.env` file.

**b) Is the key valid?**
Test the key directly:
```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1/models/text-embedding-005:embedContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"models/text-embedding-005","content":{"parts":[{"text":"hello"}]}}'
```
A working key returns JSON with `"embedding": {"values": [...]}`.  
A bad key returns `{"error": {"code": 400, "status": "INVALID_ARGUMENT"}}`.  
A wrong endpoint returns `{"error": {"code": 404}}`.

**c) Where to get a free GEMINI_API_KEY**  
Go to https://aistudio.google.com/apikey → Create API key → copy the value.  
Add it to your `.env` file:
```
GEMINI_API_KEY=your_key_here
```
Then: `docker compose up --build bridge`

---

## Re-upload Documents After Fixing

Previously uploaded documents that show `0 chunks` in the admin panel need to be
deleted and re-uploaded — the failed embedding runs stored nothing, so there is no
data to search over.

In the admin panel:
1. Go to **Admin → Agents → [your agent] → Documents**
2. Delete each document that was uploaded before the fix (chunk count = 0)
3. Re-upload the same files
4. Confirm chunk count is now > 0
