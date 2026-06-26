# WebAI Bridge — Auth Flow Guide
## Current State, What Needs to Change, and How

---

## Current Auth Flow (What We Have Now)

```
Frontend
  │
  ├─ POST http://localhost:8000/auth/login   ← goes to BRIDGE
  │      bridge calls pizzasys internally
  │      bridge issues its OWN JWT
  │      frontend stores the bridge JWT
  │
  └─ Every other request:
       Header: Authorization: Bearer <bridge-JWT>
       Bridge decodes its own JWT internally (no call to pizzasys)
```

### What auth.py Does Right Now

| Function | What It Does |
|----------|-------------|
| `validate_with_laravel()` | Calls pizzasys `POST /api/v1/auth/login` — only at login time |
| `create_token()` | Creates bridge's OWN JWT after login |
| `decode_token()` | Decodes the bridge JWT on every request |
| `get_current_user()` | Reads JWT + looks up user in local DB |
| `require_admin()` | Checks role == "admin" from the JWT payload |

### The Problem With the Current Approach

The bridge issues its own JWT after login. This means:
- If a user is deleted or their role changes in pizzasys → bridge JWT is still valid until it expires (7 days)
- The bridge has its own token system separate from pizzasys
- Frontend must know TWO base URLs: bridge for auth, pizzasys for user management

---

## The Better Pattern (HiringPizza-Style)

This is what we want to move to:

```
Frontend
  │
  ├─ POST http://localhost:8001/api/v1/auth/login   ← goes to PIZZASYS directly
  │      pizzasys returns Sanctum token
  │      frontend stores the pizzasys Sanctum token
  │
  ├─ GET  http://localhost:8001/api/v1/auth/me       ← goes to PIZZASYS directly
  ├─ POST http://localhost:8001/api/v1/auth/logout   ← goes to PIZZASYS directly
  ├─ GET  http://localhost:8001/api/v1/users         ← goes to PIZZASYS directly
  │
  └─ Every bridge API request:
       Header: Authorization: Bearer <pizzasys-Sanctum-token>
       Bridge calls pizzasys token-verify to check the token
       Bridge proceeds if valid
```

---

## What Needs to Change

There are **3 areas** to change:

---

## Area 1 — Frontend: 4 Endpoints Move to pizzasys

These 4 endpoints currently talk to the bridge. They need to go directly to pizzasys:

| Endpoint | Currently | Must Become |
|----------|-----------|-------------|
| login | `POST http://localhost:8000/auth/login` | `POST http://localhost:8001/api/v1/auth/login` |
| logout | `POST http://localhost:8000/api/user/logout` | `POST http://localhost:8001/api/v1/auth/logout` |
| me | `GET http://localhost:8000/auth/me` | `GET http://localhost:8001/api/v1/auth/me` |
| users list | `GET http://localhost:8000/admin/users` | `GET http://localhost:8001/api/v1/users` |

These 4 must use a config variable, not hardcoded URLs:

```javascript
// .env.local (local dev)
VITE_AUTH_URL=http://localhost:8001
VITE_BRIDGE_URL=http://localhost:8000

// .env.production
VITE_AUTH_URL=https://authtesting.lcportal.cloud
VITE_BRIDGE_URL=https://your-bridge-domain.com
```

Then in your API service file:
```javascript
const AUTH_URL  = import.meta.env.VITE_AUTH_URL
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL

// Login → pizzasys
fetch(`${AUTH_URL}/api/v1/auth/login`, { method: 'POST', body: ... })

// Me → pizzasys
fetch(`${AUTH_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })

// Logout → pizzasys
fetch(`${AUTH_URL}/api/v1/auth/logout`, { method: 'POST', ... })

// Users list → pizzasys
fetch(`${AUTH_URL}/api/v1/users`, { headers: { Authorization: `Bearer ${token}` } })

// Everything else → bridge
fetch(`${BRIDGE_URL}/api/chat`, { headers: { Authorization: `Bearer ${token}` } })
fetch(`${BRIDGE_URL}/api/agents`, ...)
fetch(`${BRIDGE_URL}/admin/agents`, ...)
```

The token returned by pizzasys login is stored in the frontend and used for BOTH pizzasys and bridge requests.

---

## Area 2 — Bridge Backend: auth.py Changes

The bridge `auth.py` needs a new function that calls pizzasys `token-verify` on every request.

### What needs to be ADDED to auth.py

```python
# New env vars to add
AUTH_SERVER_BASE_URL     = os.getenv("AUTH_SERVER_BASE_URL", "")
AUTH_SERVER_VERIFY_PATH  = os.getenv("AUTH_SERVER_VERIFY_PATH", "/api/v1/auth/token-verify")
AUTH_SERVER_SERVICE_NAME = os.getenv("AUTH_SERVER_SERVICE_NAME", "webai-bridge")
AUTH_SERVER_CALL_TOKEN   = os.getenv("AUTH_SERVER_CALL_TOKEN", "")
```

```python
async def verify_with_pizzasys(token: str, method: str, path: str) -> Optional[dict]:
    """
    Call pizzasys token-verify endpoint.
    Returns user info if valid, None if not.
    Equivalent to HiringPizza's AuthTokenStoreScopeMiddleware.
    """
    if not AUTH_SERVER_BASE_URL or not AUTH_SERVER_CALL_TOKEN:
        return None  # fall back to JWT mode

    endpoint = f"{AUTH_SERVER_BASE_URL.rstrip('/')}/{AUTH_SERVER_VERIFY_PATH.lstrip('/')}"

    payload = {
        "service":    AUTH_SERVER_SERVICE_NAME,
        "token":      token,
        "method":     method.upper(),
        "path":       path,
        "route_name": None,
        "store_context": {"path": {}, "query": {}, "body": {}, "header": {}},
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {AUTH_SERVER_CALL_TOKEN}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                }
            )
        if not resp.is_success:
            return None

        data = resp.json()
        if not data.get("active") or not data.get("ext", {}).get("authorized"):
            return None

        return {
            "external_id": int(data["user"]["id"]),
            "email":       data["user"]["email"],
            "roles":       data.get("roles", []),
        }
    except Exception:
        logger.exception("pizzasys token-verify call failed")
        return None
```

### What needs to change in get_current_user()

```python
# CURRENT (decodes bridge's own JWT)
def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)   # ← reads bridge JWT
    ...

# NEW (verifies pizzasys Sanctum token, falls back to bridge JWT)
async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme)
) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Try pizzasys verification first (if configured)
    if AUTH_SERVER_BASE_URL and AUTH_SERVER_CALL_TOKEN:
        pizzasys_user = await verify_with_pizzasys(
            token,
            request.method,
            request.url.path
        )
        if pizzasys_user:
            # Look up user in local DB by external_id
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, email, role FROM users WHERE external_id = %s",
                (pizzasys_user["external_id"],)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if not row:
                raise HTTPException(status_code=401, detail="User not synced yet")
            return {"user_id": row["id"], "email": row["email"], "role": row["role"]}
        raise HTTPException(status_code=401, detail="Invalid token")

    # Fallback: decode bridge's own JWT (for local-only mode)
    payload = decode_token(token)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, role FROM users WHERE id = %s", (int(payload["sub"]),))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return {"user_id": row["id"], "email": row["email"], "role": row["role"]}
```

### What happens to the /auth/login endpoint in main.py

The bridge login endpoint (`POST /auth/login`) can stay as-is for now as a fallback.
But once the frontend calls pizzasys directly, nobody calls it anymore.

Alternatively, change it to a simple proxy:

```python
# Simplified login — just proxy to pizzasys
@app.post("/auth/login")
async def login(data: LoginInput):
    if not LARAVEL_AUTH_URL:
        raise HTTPException(status_code=503, detail="Auth service not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            LARAVEL_AUTH_URL,
            json={"email": data.email, "password": data.password},
            headers={"Accept": "application/json"}
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Return the pizzasys token directly — no bridge JWT
    return resp.json()
```

---

## Area 3 — Bridge .env: New Variables

Add these to `webai-bridge/.env`:

```env
# ── Auth Server (pizzasys) ───────────────────────────────────────────────────
# Local dev:
AUTH_SERVER_BASE_URL=http://localhost:8001
# Inside Docker (bridge calls pizzasys on host):
# AUTH_SERVER_BASE_URL=http://host-gateway:8001
# Production:
# AUTH_SERVER_BASE_URL=https://authtesting.lcportal.cloud

# The route in pizzasys that verifies tokens — NOTE: hyphen not slash
AUTH_SERVER_VERIFY_PATH=/api/v1/auth/token-verify

# The name of this service — must match what you register in pizzasys service_clients
AUTH_SERVER_SERVICE_NAME=webai-bridge

# The token for this service — get from pizzasys admin (see below)
AUTH_SERVER_CALL_TOKEN=
```

Also add to `docker-compose.yml` bridge environment:
```yaml
AUTH_SERVER_BASE_URL: http://host-gateway:8001
AUTH_SERVER_VERIFY_PATH: /api/v1/auth/token-verify
AUTH_SERVER_SERVICE_NAME: webai-bridge
AUTH_SERVER_CALL_TOKEN: ${AUTH_SERVER_CALL_TOKEN:-}
```

---

## How to Get the AUTH_SERVER_CALL_TOKEN

**Step 1:** Login to pizzasys as super-admin:
```
POST http://localhost:8001/api/v1/auth/login
Body: { "email": "admin@...", "password": "..." }
```

**Step 2:** Create a service client for the bridge:
```
POST http://localhost:8001/api/v1/service-clients
Authorization: Bearer <admin_token>
Body: { "name": "webai-bridge", "description": "WebAI Bridge service" }
```

Response includes a `token` field — copy it immediately, it will not be shown again.

**Step 3:** Put it in `.env`:
```
AUTH_SERVER_CALL_TOKEN=theTokenFromStep2
```

**Step 4:** Also create an auth rule in pizzasys so the bridge is authorized:
```
POST http://localhost:8001/api/v1/auth-rules
Authorization: Bearer <admin_token>
Body: {
  "service": "webai-bridge",
  "method": "*",
  "path": "*",
  "required_permission": null,
  "is_active": true
}
```

---

## What Does NOT Change

These things stay exactly the same regardless of which auth pattern we use:

| What | Why It Stays |
|------|-------------|
| `require_admin()` dependency | Still checks role from user dict |
| All `/admin/*` routes | Still protected by `require_admin` |
| All `/api/*` routes | Still protected by `get_current_user` |
| NATS sync | Still needed — users must exist in bridge DB |
| `database.py` | No change |
| `nats_sync.py` | No change |
| `vector.py` | No change |
| The `users` table structure | No change |
| `external_id` column | Already there — used for NATS sync |

---

## The Critical Dependency: User Must Exist in Bridge DB

Exactly like HiringPizza, the user MUST exist in the bridge's local `users` table.

The middleware calls pizzasys and gets back `user.id = 42`.
Then it does `SELECT * FROM users WHERE external_id = 42`.
If that row doesn't exist → **401 "User not synced yet"**.

This is why NATS is required:
```
User created in pizzasys
    → pizzasys publishes user.created to NATS
    → bridge consumes user.created
    → bridge inserts into local users table (external_id=42)
    → bridge can now authenticate that user
```

If NATS is not working, nobody can log in to the bridge.

---

## Local Dev vs Production — Summary Table

| Setting | Local Dev | Production |
|---------|-----------|-----------|
| Frontend login URL | `http://localhost:8001/api/v1/auth/login` | `https://authtesting.lcportal.cloud/api/v1/auth/login` |
| Frontend me/logout/users | `http://localhost:8001/api/v1/auth/...` | `https://authtesting.lcportal.cloud/api/v1/auth/...` |
| Bridge URL | `http://localhost:8000` | `https://your-bridge.com` |
| `AUTH_SERVER_BASE_URL` in bridge | `http://localhost:8001` | `https://authtesting.lcportal.cloud` |
| `LARAVEL_AUTH_URL` in bridge | `http://localhost:8001/api/v1/auth/login` | `https://authtesting.lcportal.cloud/api/v1/auth/login` |
| Docker bridge → pizzasys | `http://host-gateway:8001` | `https://authtesting.lcportal.cloud` |

---

## Files to Change — Checklist

```
Frontend:
  ✅ Add VITE_AUTH_URL and VITE_BRIDGE_URL to .env.local
  ✅ Replace hardcoded URLs in API service files

Bridge backend:
  ✅ auth.py — add verify_with_pizzasys() function
  ✅ auth.py — update get_current_user() to use pizzasys verify
  ✅ main.py — simplify /auth/login to proxy mode (optional)
  ✅ webai-bridge/.env — add AUTH_SERVER_* vars
  ✅ docker-compose.yml — pass AUTH_SERVER_* vars to bridge container

pizzasys setup (one time):
  ✅ Create service client "webai-bridge" → save the token
  ✅ Create auth rule for "webai-bridge" service
```

---

## Order of Implementation

Do these in order:

1. **Create the service client in pizzasys** (get the call token)
2. **Add `AUTH_SERVER_*` vars to bridge `.env`** and `docker-compose.yml`
3. **Update `auth.py`** — add `verify_with_pizzasys()` and update `get_current_user()`
4. **Rebuild bridge** — `docker compose up --build`
5. **Update frontend** — switch 4 endpoints to pizzasys, use env vars
6. **Test** — login via pizzasys, confirm bridge accepts the Sanctum token
