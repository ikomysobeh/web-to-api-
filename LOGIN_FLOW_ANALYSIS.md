# Login Flow Analysis

**Date:** 2026-06-27

---

## What is happening now (the problem)

```
Browser ──POST /auth/login──▶ Bridge (:8000) ──proxy──▶ pizzasys (:8001)
                                                              │
                              Bridge returns pizzasys's ◀────┘
                              Sanctum token to browser
```

The frontend calls the **bridge** (`VITE_API_URL:8000/auth/login`).
The bridge proxies the request to pizzasys and forwards the response.
The browser gets back a **Sanctum token** (from pizzasys, not a bridge JWT).

This means the bridge is a middleman for login only — it adds no value for this step, it just forwards.

---

## What you want (correct design)

```
Browser ──POST /api/v1/auth/login──▶ pizzasys (:8001 / authtesting.lcportal.cloud)
              │
              │ gets Sanctum token back
              │
              ▼
Browser uses Sanctum token for all bridge (:8000) requests
Bridge verifies the Sanctum token with pizzasys on every request (Mode 1)
```

Login goes **directly** from the browser to pizzasys.
The bridge is not involved in login at all.
The bridge still verifies the token on every API call via `POST /api/v1/auth/token-verify`.

---

## Why the current approach was built this way

The bridge proxy was added to avoid a CORS problem: if the browser calls
pizzasys directly, pizzasys must have the frontend's origin in its CORS allowlist.
Server-to-server (bridge → pizzasys) has no CORS restriction.

**This is no longer a reason to keep the proxy** because:
- The Users page already calls pizzasys directly from the browser (CORS already required)
- `authtesting.lcportal.cloud` must already allow the frontend origin for Users to work
- So pizzasys CORS is already a requirement — login direct is fine

---

## Why you are getting 401 right now

```
Browser → Bridge /auth/login → pizzasys authtesting.lcportal.cloud → 422 (wrong credentials)
Bridge maps 422 → 401 and returns it to browser
```

Either the account credentials are wrong for that server, or the login
endpoint path is wrong. The bridge's mapping:

```python
if resp.status_code == 422:
    raise HTTPException(status_code=401, detail="Invalid email or password")
```

---

## What needs to change

### 1. Frontend `api.ts` — change `login()` to call pizzasys directly

**File:** `web2api-ui/src/services/api.ts`

**Current (wrong):**
```ts
const res = await fetch(`${BASE}/auth/login`, {   // ← goes to bridge :8000
  ...
});
```

**Must become:**
```ts
const res = await fetch(`${AUTH_BASE}/api/v1/auth/login`, {  // ← goes to pizzasys directly
  ...
});
```

### 2. Parse pizzasys response correctly

Pizzasys returns a Sanctum token in this shape:
```json
{
  "success": true,
  "token": "52|xxxxx",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "roles": [{ "name": "admin" }]
  }
}
```

The `unwrap()` helper in `api.ts` handles nested `data` responses, but
the token field is at the top level — not under `data`. The current
extraction `d.token ?? d.access_token` should work if `unwrap()` doesn't
strip it. **Verify the response shape from authtesting.lcportal.cloud.**

### 3. Bridge — `AUTH_SERVER_CALL_TOKEN` MUST be set

When the browser sends the Sanctum token to the bridge, the bridge verifies
it using Mode 1 (`verify_with_pizzasys`). Mode 1 only runs when **both**
`AUTH_SERVER_BASE_URL` and `AUTH_SERVER_CALL_TOKEN` are set.

If `AUTH_SERVER_CALL_TOKEN` is empty → bridge falls to Mode 2 (JWT decode)
→ Sanctum tokens fail JWT decode → **every request returns 401**.

Production `.env` must have:
```env
AUTH_SERVER_BASE_URL=https://authtesting.lcportal.cloud
AUTH_SERVER_CALL_TOKEN=<real service-client token from authtesting.lcportal.cloud>
```

### 4. pizzasys CORS must allow the frontend origin

Since the browser now calls pizzasys directly for login (and already for the
Users page), pizzasys must have the frontend origin in its CORS config.

For production:
- Frontend origin: `http://2.25.70.122:3000`
- Must be added to pizzasys's allowed origins in `config/cors.php` (or
  the `SANCTUM_STATEFUL_DOMAINS` / `CORS_ALLOWED_ORIGINS` env on that server)

### 5. `getMe` stays on the bridge

`GET /auth/me` is called after login to confirm the token is valid and get
the user's role. This stays on the bridge (port 8000) — no change needed.

---

## Required `.env` values on the production server

```env
# Bridge reaches pizzasys server-to-server
AUTH_SERVER_BASE_URL=https://authtesting.lcportal.cloud
AUTH_SERVER_CALL_TOKEN=<token from authtesting.lcportal.cloud service clients>
LARAVEL_AUTH_URL=https://authtesting.lcportal.cloud/api/v1/auth/login

# Frontend build-time (browser talks to these URLs directly)
VITE_API_URL=http://2.25.70.122:8000
VITE_AUTH_URL=https://authtesting.lcportal.cloud
```

---

## Summary of changes needed

| What | File | Change |
|------|------|--------|
| Login URL | `web2api-ui/src/services/api.ts` | `BASE/auth/login` → `AUTH_BASE/api/v1/auth/login` |
| Service-client token | `.env` on server | Set `AUTH_SERVER_CALL_TOKEN` to real value |
| pizzasys CORS | pizzasys server config | Add `http://2.25.70.122:3000` to allowed origins |
| Frontend rebuild | server | `docker compose up -d --build frontend` after `.env` change |

The bridge `/auth/login` endpoint in `main.py` can stay as-is — it just
won't be called anymore. No backend changes needed.
