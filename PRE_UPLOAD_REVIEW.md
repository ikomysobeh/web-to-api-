# Pre-Upload Production Review

**Date:** 2026-06-26
**Reviewed:** `docker-compose.yml`, all 3 Dockerfiles, `nginx.conf`, `.env`, `.dockerignore`/`.gitignore`, frontend `api.ts`, bridge `main.py` (CORS), git tracking.

> **✅ UPDATE — code fixes applied (2026-06-26).** B1 (CORS now env-driven), S1 (webai port
> bound to localhost), M1 (frontend Dockerfile defaults) are **done in the code**. The bridge was
> rebuilt and is healthy. The remaining items (B2, B3, S2, S3) are **operational** — they're set
> on the server at deploy time, not in the repo. They're marked below.

---

## TL;DR

The app runs locally and is structurally solid. Before it works **on the server**, there are **3 blockers** (things that will break for real users) and **3 security items** (ports exposed to the internet). Everything else is minor.

The single most important thing to understand:

> **Your browser talks to TWO servers directly: the bridge (port 8000) AND pizzasys (port 8001).**
> Login, chat, agents, documents → go to the **bridge**.
> The **Users list** (admin) → goes **straight to pizzasys** from the browser.
> So **both** must be publicly reachable **and** both must allow your frontend's address in CORS. If pizzasys stays on your laptop, the Users page will not load for anyone on the server.

| Severity | Count | Effect if not handled |
|----------|-------|----------------------|
| 🔴 Blocker | 3 | Login / API calls / Users page break in production |
| 🟠 Security | 3 | Internal services exposed to the internet |
| 🟡 Minor | 5 | Cleanliness / future hardening |

---

## 🔴 Blockers — must handle during deploy

### B1 — CORS in `webai-bridge/main.py` ✅ FIXED (now env-driven)
**File:** `webai-bridge/main.py`

CORS is no longer hardcoded. Localhost is always allowed, and **extra production origins
come from the `CORS_ORIGINS` env var** (comma-separated). No more editing Python on the server.

**What to do on the server:** in `/opt/webai/.env`, set:
```env
CORS_ORIGINS=http://2.25.70.122:3000
# or, with a domain:  CORS_ORIGINS=https://app.yourdomain.com
```
Then `docker compose up -d --build bridge`. (`CORS_ORIGINS` is already wired through
`docker-compose.yml` → bridge env, and documented in `.env.example`.)

---

### B2 — pizzasys must be PUBLIC and allow the frontend origin (CORS)
**Files:** `web2api-ui/src/services/api.ts` line 453 (`AUTH_BASE/api/v1/users`), `.env` `VITE_AUTH_URL`

The admin **Users page** calls pizzasys **directly from the browser** (not through the bridge). That means:
1. **pizzasys must be reachable from the public internet** (not `localhost:8001`, not your laptop). Browsers of your users cannot reach your laptop.
2. **pizzasys's own CORS** must allow your frontend origin (`http://2.25.70.122:3000` / `https://yourdomain.com`). This is a setting **inside the Laravel pizzasys project**, not in this repo.
3. `VITE_AUTH_URL` in `.env` must be set to pizzasys's **public** URL **before** building the frontend (it gets baked into the bundle).

> Login itself goes bridge→pizzasys (server-to-server), so login can survive with `host-gateway:8001` if pizzasys is on the VPS host. But the **Users page** is browser→pizzasys and **will fail** unless 1–3 above are done.

---

### B3 — `.env` still holds local-dev values
**File:** `.env`

These are fine for your laptop but **wrong for the server**:

| Variable | Current (dev) | Must become (prod) |
|----------|---------------|--------------------|
| `VITE_API_URL` | `http://localhost:8000` | public bridge URL, e.g. `http://2.25.70.122:8000` or `https://api.yourdomain.com` |
| `VITE_AUTH_URL` | `http://localhost:8001` | **public** pizzasys URL |
| `DB_PASSWORD` | `change_me_please` | a strong random password |
| `LARAVEL_AUTH_URL` | `http://host-gateway:8001/...` | real pizzasys login URL |
| `AUTH_SERVER_BASE_URL` | `http://host-gateway:8001` | real pizzasys base URL |
| `AUTH_SERVER_CALL_TOKEN` | (laptop pizzasys token) | a service-client token from the **production** pizzasys |

⚠️ **`VITE_API_URL` / `VITE_AUTH_URL` are baked in at build time.** After changing them you must **rebuild** the frontend (`docker compose up -d --build frontend`), not just restart.

⚠️ **Do NOT copy this laptop `.env` to the server as-is.** Generate fresh `SECRET_KEY`, `COOKIE_ENCRYPTION_KEY`, `WEBAI_INTERNAL_KEY`, `NATS_TOKEN` for production, and create a new `AUTH_SERVER_CALL_TOKEN` on the production pizzasys.

---

## 🟠 Security — internal services exposed to the internet

On a VPS, any port mapped as `0.0.0.0` (the default `"X:Y"` form) is open to the whole internet unless a firewall blocks it.

### S1 — `webai` (Gemini wrapper) publishes `6969` ✅ FIXED
**File:** `docker-compose.yml`
Now bound to `127.0.0.1:6969:6969` — reachable locally for debugging, **not exposed to the
internet**. The bridge still reaches it internally as `http://webai:6969`.

### S2 — `nats` publishes `4223:4222` to the internet
**File:** `docker-compose.yml` line 33
NATS only has token auth. Exposing 4223 to the whole internet is risky. It needs to be reachable **only by pizzasys**. → Firewall it to pizzasys's IP, or keep it closed until you wire pizzasys↔NATS.

⚠️ **Port number changed:** NATS is now mapped to host port **4223** (changed locally to avoid a clash with your `pizza-nats` container). On the VPS there is no clash, so you can either:
- revert this line to `"4222:4222"` on the server (then pizzasys connects to `nats://VPS_IP:4222`), **or**
- keep `4223` and have pizzasys connect to `nats://VPS_IP:4223` and open **4223** (not 4222) in the firewall.
The `START_HERE_VPS_SETUP.md` guide says open `4222` — adjust to match whichever you pick.

### S3 — `bridge` publishes `8000:8000`
**File:** `docker-compose.yml` line 99
This one **does** need to be public (the browser calls it). Short-term that's OK behind the firewall. Proper setup: put it behind nginx + HTTPS (see the domain step in the VPS guide) and only expose 80/443.

> ✅ `db` is already correct — bound to `127.0.0.1:5433`, not public.

---

## 🟡 Minor / cleanup

### M1 — Frontend Dockerfile default ARGs ✅ FIXED
**File:** `web2api-ui/Dockerfile`
Defaults corrected to `VITE_API_URL=http://localhost:8000` and `VITE_AUTH_URL=http://localhost:8001`.
(Still overridden by compose from `.env` — this just removes the misleading values.)

### M2 — `webai` container has no volume (ephemeral snapshots)
The Gemini wrapper's SQLite conversation snapshots live inside the container and are lost on rebuild. **Your Gemini cookies are safe** (they're stored encrypted in Postgres via the bridge, which has the `postgres_data` volume). Snapshots rebuild on use, so this is low impact — add a volume only if you want them to persist.

### M3 — No healthcheck on `frontend`
nginx is reliable, so this is optional.

### M4 — Don't upload these to the server
`HiringPizza/`, `TASKS/`, `TASKS.zip`, `docker-compose.nats-test.yml`, and the loose `*.md` analysis files. They aren't part of the stack. (Most are already in `.gitignore`.) `pizzasys` lives outside this repo and is deployed separately.

### M5 — `extra_hosts: "host-gateway:host-gateway"`
Unconventional but functional. It's what lets the bridge reach Ollama and (optionally) pizzasys **on the VPS host**. Only relevant if those run on the host rather than as public URLs.

---

## ✅ What's already correct (don't touch)

- **No secrets in git** — only `.env.example` / `config.conf.example` are tracked; all real `.env` files are git-ignored.
- **`.dockerignore` excludes `.env`** in all three images — secrets won't bake into the built images.
- **DB not public** — `127.0.0.1:5433:5432`.
- **bcrypt pinned to 4.0.1** — the passlib warning is fixed.
- **Healthchecks + `depends_on: service_healthy`** on db, nats, webai, bridge.
- **`restart: unless-stopped`**, named volumes (`postgres_data`, `nats_data`), private `webai_network`, **non-root** bridge user.
- **UUID validation** on conversation/message routes; **per-user Gemini client + registry isolation**.

---

## Deploy checklist (in order)

**Already done in the code (no action needed):**
```
[x] B1  CORS is env-driven via CORS_ORIGINS
[x] S1  webai 6969 bound to localhost (not public)
[x] M1  frontend Dockerfile defaults corrected
```

**To do on the server (operational — set at deploy time):**
```
[ ] B3  Create /opt/webai/.env with PRODUCTION values + fresh secrets
[ ] B3  Set VITE_API_URL + VITE_AUTH_URL to PUBLIC URLs (then rebuild frontend)
[ ] B1  Set CORS_ORIGINS=<your frontend public URL> in .env  (e.g. http://2.25.70.122:3000)
[ ] B2  Host pizzasys publicly; add frontend origin to pizzasys CORS; create a prod service-client token
[ ] S2  Decide NATS host port (4222 vs 4223); firewall it to pizzasys only
[ ] S3  Expose bridge 8000 behind firewall now; nginx + HTTPS later
[ ] M4  Don't upload HiringPizza/, TASKS*, nats-test compose, loose *.md
[ ] --  docker compose up -d --build  → confirm all 5 containers healthy
[ ] --  Browser test: login → chat → upload doc → Users page loads (proves pizzasys CORS)
```

---

## The two-origin architecture (reference)

```
Browser ──(VITE_API_URL, :8000)──▶  bridge   ──internal──▶ webai (:6969), db, nats
   │                                  │
   │                                  └──server-to-server──▶ pizzasys (login + token-verify)
   │
   └──(VITE_AUTH_URL, :8001)────────▶ pizzasys   (ONLY the admin Users list calls this directly)
```
- **Bridge** must be public + CORS-allow the frontend. (B1)
- **pizzasys** must be public + CORS-allow the frontend, because the browser hits it directly for the Users list. (B2)
- Everything else (webai, db, nats) stays on the private network.
```
