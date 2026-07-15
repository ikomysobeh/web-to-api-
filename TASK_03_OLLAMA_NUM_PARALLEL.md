# Task 3 — Set OLLAMA_NUM_PARALLEL ✅ (config on the server)

## What This Task Is

This is the **partner of Task 2**. No code changes — it's a one-line setting on
the Ollama server itself.

```
Task 2 (app side):     semaphore = 2   → "don't SEND more than 2 at once"
Task 3 (Ollama side):  NUM_PARALLEL = 2 → "don't PROCESS more than 2 at once"
```

Both use the **same number (2 = your CPU count)**. Together they guarantee Ollama
never gets overwhelmed.

## Why Both Are Needed

- **Semaphore alone** stops the app from sending too much — but if Ollama's own
  default changes or another client hits it, Ollama could still overload.
- **NUM_PARALLEL alone** caps Ollama — but the app might still pile up requests
  waiting badly.
- **Together** = the app sends at most 2, and Ollama is configured to handle
  exactly 2 cleanly. Perfectly matched.

## What OLLAMA_NUM_PARALLEL Does

It tells Ollama how many requests to process **at the same time** per model.
Default is auto (1 or 4 depending on memory). We pin it to **2** so it matches
our 2 CPUs and our semaphore.

Also setting `OLLAMA_FLASH_ATTENTION=1` — a small free speed boost.

---

# HOW TO APPLY IT

## On the VPS (Linux — production)

Ollama runs as a systemd service. Add the env vars via an override:

```bash
# 1. Open the override editor
sudo systemctl edit ollama
```

This opens an editor. Add these lines **between** the marked comment lines:

```ini
[Service]
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_HOST=0.0.0.0"
```

> `OLLAMA_HOST=0.0.0.0` is the one you already set earlier so Docker can reach
> Ollama — keep it here too so all settings live in one place.

Save and exit, then reload:

```bash
# 2. Reload systemd and restart Ollama
sudo systemctl daemon-reload
sudo systemctl restart ollama

# 3. Verify the settings are active
systemctl show ollama | grep Environment
```

You should see `OLLAMA_NUM_PARALLEL=2` in the output.

---

## On Windows (local testing — optional)

If you also want it locally where you test, set a user environment variable:

```powershell
# Set it permanently for your user
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "2", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "1", "User")
```

Then **fully restart Ollama** (quit from the system tray and reopen) so it picks
up the new variables.

Verify:
```powershell
$env:OLLAMA_NUM_PARALLEL   # after restarting your terminal, should print 2
```

---

## How To Verify End-to-End

After both Task 2 (app) and Task 3 (Ollama) are in place:

1. The app's semaphore caps outgoing embedding calls at 2.
2. Ollama itself is configured to process 2 at a time.
3. Under a burst of traffic, requests queue **briefly and safely** instead of
   spiking to 45 seconds.

Quick health check that Ollama still answers:
```bash
curl http://localhost:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"hello"}'
```
Should return a vector of numbers.

---

## The Matching Rule (remember this)

| Setting | Where | Value | Meaning |
|---|---|---|---|
| `OLLAMA_MAX_CONCURRENCY` | app (`.env` / compose) | 2 | app sends max 2 |
| `OLLAMA_NUM_PARALLEL` | Ollama server (systemd) | 2 | Ollama processes max 2 |

**These two numbers must always match**, and both should equal your CPU count
(2 on KVM 2). If you upgrade to a 4-CPU VPS later, set both to 4.

---

## Status

✅ **Task 3 defined** (apply the commands above on your VPS when you deploy).
Phase 1 safety tasks that touch code are now: **Task 1 ✓, Task 2 ✓**.
Next up: **Task 4 — HNSW index** on `document_chunks` (a code change in
`database.py`).
