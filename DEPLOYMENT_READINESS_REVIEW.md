# Deployment Readiness Review — VPS / Docker

**Date:** 2026-06-26
**Scope:** `docker-compose.yml`, all three Dockerfiles, nginx config, env files, and supporting infra.

> **✅ UPDATE (2026-06-26): Fixes applied.** B1, B2, B3, B4, S1, S2, S3, and O1 have now been
> applied to `docker-compose.yml`, `.env.example`, and `webai-bridge/requirements.txt`. The
> compose file passes `docker compose config`. Items below are kept as the record of what was
> wrong and what changed. Remaining work is operational (set real `.env` values on the VPS) plus
> the optional items O2–O5.

---

## TL;DR — Verdict

**The Docker setup is ~80% correct and does NOT need a rewrite.** The architecture is good (healthchecks, restart policies, named volumes, private network, multi-stage frontend build, non-root bridge user). But there are **4 blocking issues** that will break features in production and **a few things to remove/clean up** before uploading to the VPS.

| Severity | Count | Effect if not fixed |
|----------|-------|---------------------|
| 🔴 Blocker | 4 | RAG, frontend API calls, and NATS auth will silently fail in production |
| 🟠 Should-fix | 3 | Security exposure + confusing config |
| 🟡 Optional | 5 | Hardening / cleanliness |

---

## ✅ What Is Already Correct (keep as-is)

- **Healthchecks** on db, nats, webai, bridge with proper `depends_on: condition: service_healthy`.
- **`restart: unless-stopped`** on all long-running services.
- **Named volumes** (`postgres_data`, `nats_data`) — data survives restarts.
- **Private bridge network** (`webai_network`) — services talk by name (`db`, `nats`, `webai`).
- **`pgvector/pgvector:pg16`** image — vector extension is prebuilt, no manual install.
- **Frontend multi-stage build** (node builder → nginx:alpine) — small final image.
- **Bridge runs as non-root** (`appuser`) — good security practice.
- **nginx port is consistent**: Dockerfile `EXPOSE 3000`, `nginx.conf listen 3000`, compose `3000:3000`. ✔ (no mismatch)
- **`.dockerignore` and `.gitignore`** correctly exclude `.env`, `venv/`, `node_modules/`, `config.conf`, `runtime/auth/`. Secrets won't get baked into images or committed.

---

## 🔴 Blocking Issues (must fix before deploy)

### B1 — Ollama URL is never passed to the bridge container → **RAG/embeddings will fail**

**Where:** `docker-compose.yml`, `bridge.environment` (lines 74–91)

The bridge environment block lists DATABASE_URL, NATS, AUTH_SERVER… but **`OLLAMA_URL` and `OLLAMA_MODEL` are missing entirely.** `vector.py` defaults to `http://localhost:11434`. Inside a container, `localhost` is the container itself — not the VPS host where Ollama runs. So every embedding call (document upload + chat RAG search) will fail to connect.

The VPS guide tells you to put `OLLAMA_URL` in `.env`, but **compose never forwards it**, so it has no effect.

**Fix (add to `bridge.environment`):**
```yaml
      OLLAMA_URL: ${OLLAMA_URL:-http://host-gateway:11434}
      OLLAMA_MODEL: ${OLLAMA_MODEL:-nomic-embed-text}
```

---

### B2 — Frontend API URL is hardcoded to `localhost:8000` → **the deployed site can't reach the backend**

**Where:** `docker-compose.yml`, `frontend.build.args` (lines 115–117)

```yaml
args:
  VITE_API_URL: http://localhost:8000          # ← hardcoded, ignores .env
  VITE_AUTH_URL: ${VITE_AUTH_URL:-http://localhost:8001}
```

Vite **bakes build args into the JS bundle at build time.** With `http://localhost:8000` baked in, every visitor's browser will try to call *their own* machine on port 8000, not your server. The chat/admin API will appear completely dead in production.

`src/services/api.ts` uses `VITE_API_URL` as the base and calls bridge paths directly (`/api/conversations`, `/auth/me`, `/admin/...`). So `VITE_API_URL` must be your **public** bridge URL (e.g. `https://yourdomain.com`), and nginx must proxy `/api/`, `/auth/`, `/admin/` to the bridge (the VPS guide's nginx config already does this).

**Fix:**
```yaml
args:
  VITE_API_URL: ${VITE_API_URL:-http://localhost:8000}
  VITE_AUTH_URL: ${VITE_AUTH_URL:-http://localhost:8001}
```
…and set `VITE_API_URL=https://yourdomain.com` in the VPS `.env`. **Remember:** changing this requires a **rebuild** (`docker compose up -d --build frontend`), not just a restart, because it's compile-time.

---

### B3 — NATS auth token is hardcoded to `localdev` and not wired to `.env` → **prod NATS auth mismatch**

**Where:** `docker-compose.yml`, `nats.command` (line 30)

```yaml
command: ["--jetstream", "--store_dir=/data", "--http_port", "8222", "--auth", "localdev"]
```

The NATS **server** always demands the token `localdev`, but the **bridge** authenticates with `${NATS_TOKEN}` from `.env`. They only line up if you happen to leave `NATS_TOKEN=localdev`. Two problems:
1. `localdev` is a dev password and should not be used on an internet-exposed port (4222 is open per the guide so pizzasys can connect).
2. If you set a strong `NATS_TOKEN` in `.env`, the **server** still wants `localdev` → bridge + pizzasys fail to connect.

**Fix (interpolate the same var the clients use):**
```yaml
command: ["--jetstream", "--store_dir=/data", "--http_port", "8222", "--auth", "${NATS_TOKEN:?set NATS_TOKEN in .env}"]
```
Then `NATS_TOKEN` must match in three places: VPS `.env`, the bridge (already reads it), and pizzasys `.env`.

---

### B4 — `AUTH_SERVER_BASE_URL` is hardcoded to `host-gateway:8001`, overriding `.env`

**Where:** `docker-compose.yml`, `bridge.environment` (line 88)

```yaml
AUTH_SERVER_BASE_URL: http://host-gateway:8001
```

This assumes pizzasys runs **on the VPS host** at port 8001. But pizzasys currently lives on your laptop (`C:\xampp`), and the VPS guide itself says it may live at a public domain. Because this is hardcoded, setting `AUTH_SERVER_BASE_URL` in `.env` does nothing — token verification will hit the wrong host and **logins via pizzasys will fail**.

**Fix:**
```yaml
AUTH_SERVER_BASE_URL: ${AUTH_SERVER_BASE_URL:-http://host-gateway:8001}
```
Then set the real value in `.env` (e.g. `https://your-pizzasys-domain.com`).

---

## 🟠 Should-Fix (security / correctness)

### S1 — PostgreSQL port is published to the host → **DB exposed**

**Where:** `docker-compose.yml`, `db.ports` (lines 12–13) → `"5432:5432"`

On a VPS this opens Postgres to the server's network interface. The VPS guide explicitly says *"Do NOT expose 5432."* The bridge reaches the DB over the internal `webai_network` by hostname `db`, so the published port is unnecessary.

**Fix:** delete the `ports:` block from the `db` service (keep it only if you need to connect a DB GUI from outside — and then firewall it).

### S2 — Root `.env.example` is incomplete → **deployers will miss required vars**

**Where:** `.env.example`

It only contains `DB_USER`, `DB_PASSWORD`, `SECRET_KEY`, `COOKIE_ENCRYPTION_KEY`, `WEBAI_INTERNAL_KEY`. But `docker-compose.yml` references many more: `NATS_TOKEN`, `AUTH_SERVER_CALL_TOKEN`, `AUTH_SERVER_BASE_URL`, `VITE_API_URL`, `VITE_AUTH_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`, `LARAVEL_AUTH_URL`, `DEV_MODE`, `NATS_AUTH_STREAM`, `NATS_AUTH_DURABLE`. Anyone copying `.env.example` will produce a broken deploy.

**Fix:** expand `.env.example` to list every variable compose reads (see the consolidated list in the [Required .env Variables](#required-env-variables) section below).

### S3 — `bcrypt==4.1.3` triggers a passlib warning on every registration

**Where:** `webai-bridge/requirements.txt` (line 25)

Produces `AttributeError: module 'bcrypt' has no attribute '__about__'` in logs (you saw this earlier). Hashing still works, so it's not fatal, but it's noise.

**Fix:** pin `bcrypt==4.0.1` (compatible with `passlib 1.7.4`).

---

## 🟡 Optional Hardening / Cleanup

| # | Item | Where | Note |
|---|------|-------|------|
| O1 | `webai` depends on `db` health, but WebAI-to-API uses **SQLite**, not Postgres | compose lines 57–59 | Remove `depends_on: db` from `webai` — it just delays startup. |
| O2 | `extra_hosts: "host-gateway:host-gateway"` is unconventional | compose lines 72–73 | The usual form is `"host.docker.internal:host-gateway"`. Current form works (creates a host entry literally named `host-gateway`) but is confusing. Leave it *only if* all your URLs use `host-gateway` as the hostname (they do). |
| O3 | No resource limits / log rotation | compose | On a 2 GB VPS, add `logging:` (json-file max-size/max-file) to stop logs filling disk. |
| O4 | No healthcheck on `frontend` | compose | Optional; nginx is reliable. |
| O5 | Stray blank lines | compose lines 64–65 | Cosmetic. |

---

## 🗑️ What to REMOVE / NOT Upload to the VPS

1. **`HiringPizza/`** — this is a separate Laravel consumer app, **not part of `docker-compose.yml`**. Don't upload it as part of the bridge stack. Deploy it separately if needed.
2. **`pizzasys`** — lives at `C:\xampp\htdocs\projacet\pizzasys`, outside this repo. It is **not** in compose and runs on its own server. Just point the bridge/frontend at its URL.
3. **`docker-compose.nats-test.yml`** — test-only. Do **not** run it in production. It pre-creates differently-named consumers (`WEBAI_BRIDGE_AUTH_CONSUMER_CREATED`, etc.); the bridge creates its own durable (`WEBAI_BRIDGE_AUTH_CONSUMER`) at runtime, so the test file is redundant in prod.
4. **`TASKS.zip`, `TASKS/`, and the many loose `*.md` analysis files** — harmless, but no reason to ship them. Optional `.gitignore`/exclude.
5. **Committed `.env` files** (`webai-bridge/.env`, `WebAI-to-API/.env`) — these contain **real secret values** (SECRET_KEY, COOKIE_ENCRYPTION_KEY) in your working tree. They're git-ignored ✔, but: (a) on the VPS, Docker uses the **root `.env`** via compose, not these; (b) treat the laptop values as compromised and **generate fresh secrets** for production. The bridge/WebAI per-folder `.env` files are only used when running those apps *outside* Docker.

---

## Required `.env` Variables (consolidated)

These are every variable `docker-compose.yml` reads. Create `/opt/webai/.env` on the VPS with all of them:

```env
# ── Database ──────────────────────────────────────────────
DB_USER=webai_user
DB_PASSWORD=<strong-random>

# ── Shared secrets (generate: python -c "import secrets; print(secrets.token_hex(32))") ──
SECRET_KEY=<random-64-hex>
COOKIE_ENCRYPTION_KEY=<random-64-hex>
WEBAI_INTERNAL_KEY=<random-64-hex>     # MUST match between bridge and webai

# ── NATS (token must match nats server + pizzasys) ────────
NATS_TOKEN=<strong-random>             # NOT "localdev" in prod
NATS_AUTH_STREAM=AUTH_EVENTS
NATS_AUTH_DURABLE=WEBAI_BRIDGE_AUTH_CONSUMER
DEV_MODE=0

# ── Auth server (pizzasys) ────────────────────────────────
AUTH_SERVER_BASE_URL=https://your-pizzasys-domain.com
AUTH_SERVER_CALL_TOKEN=<pizzasys-service-client-token>
LARAVEL_AUTH_URL=

# ── Ollama (host, reached via host-gateway from container) ─
OLLAMA_URL=http://host-gateway:11434
OLLAMA_MODEL=nomic-embed-text

# ── Frontend (build-time; rebuild on change) ──────────────
VITE_API_URL=https://yourdomain.com
VITE_AUTH_URL=https://your-pizzasys-domain.com
```

> ⚠️ For these to take effect, blockers **B1–B4** must be applied to `docker-compose.yml` first — otherwise `OLLAMA_URL`, `VITE_API_URL`, `NATS_TOKEN`, and `AUTH_SERVER_BASE_URL` from `.env` are ignored.

---

## Per-Service Status

| Service | Image / Build | Status | Action needed |
|---------|---------------|--------|---------------|
| **db** (Postgres+pgvector) | `pgvector/pgvector:pg16` | 🟠 | Remove published `5432` port (S1) |
| **nats** | `nats:2.10-alpine` | 🔴 | Wire `--auth` to `${NATS_TOKEN}` (B3) |
| **webai** (WebAI-to-API) | local Dockerfile (py3.12) | 🟡 | Drop unused `depends_on: db` (O1) |
| **bridge** (webai-bridge) | local Dockerfile (py3.11) | 🔴 | Add Ollama envs (B1); un-hardcode AUTH_SERVER_BASE_URL (B4) |
| **frontend** (web2api-ui) | multi-stage → nginx | 🔴 | Un-hardcode `VITE_API_URL` build arg (B2) |

---

## Pre-Flight Checklist (in order)

1. [ ] Apply B1–B4 to `docker-compose.yml`.
2. [ ] Remove `db` published port (S1).
3. [ ] Expand `.env.example` (S2); create the real `/opt/webai/.env` on the VPS with fresh secrets.
4. [ ] (Optional) pin `bcrypt==4.0.1` (S3); drop `webai → db` dependency (O1).
5. [ ] Install Ollama on the VPS host + `ollama pull nomic-embed-text`, confirm `http://localhost:11434` responds.
6. [ ] `docker compose up -d --build` — verify all 5 containers are healthy.
7. [ ] Confirm Ollama reachability from the bridge container, e.g. `docker compose exec bridge curl -s http://host-gateway:11434/api/tags`.
8. [ ] nginx + Certbot SSL (per VPS guide); firewall 22/80/443/4222 only.
9. [ ] Set pizzasys `NATS_URL` → VPS IP with the matching `NATS_TOKEN`.
10. [ ] Smoke test: site loads over HTTPS → login (pizzasys) → upload a doc (`stored>0, failed=0`) → chat with the agent answering from the doc → create a user in pizzasys and confirm it appears in the bridge DB (NATS sync).

---

## Bottom Line

- **Is Docker correct?** Structurally yes. But **four hardcoded/missing values (B1–B4)** mean RAG, the frontend↔backend connection, NATS auth, and pizzasys login will not work in production until fixed. These are small edits, not a redesign.
- **Do we need to remove things?** Yes — don't ship `HiringPizza/`, the `nats-test` compose, `TASKS*`, or the laptop `.env` secrets; remove the public Postgres port.
- **Is everything else good?** Healthchecks, volumes, networking, non-root bridge, multi-stage frontend, and `.dockerignore`/`.gitignore` hygiene are all in good shape.
