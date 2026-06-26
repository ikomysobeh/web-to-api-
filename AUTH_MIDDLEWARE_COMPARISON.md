# Auth Middleware — HiringPizza vs WebAI Bridge
## What Each Does, What's Different, and What We Should Adopt

---

## Side-by-Side Overview

| Aspect | HiringPizza (PHP Middleware) | WebAI Bridge (Python `auth.py`) |
|--------|------------------------------|----------------------------------|
| Language | PHP / Laravel | Python / FastAPI |
| Where it runs | Every request entering `Route::middleware('auth.token.store')` | FastAPI `Depends(get_current_user)` |
| Token source | `Authorization: Bearer` header | `Authorization: Bearer` header |
| Calls pizzasys | YES — on every request | YES — on every request (Mode 1) |
| Falls back | NO — fails hard if pizzasys is down | YES — falls back to bridge's own JWT |
| Caches result | Has Redis cache (currently commented out) | NO — calls pizzasys every time |
| 401 vs 403 | Separated — 401 = bad token, 403 = unauthorized | Both return 401 |
| User lookup | `User::find($userId)` by pizzasys id | `SELECT WHERE id = $pizzasys_id` |
| Sets user session | `Auth::login($user)` | Returns dict `{user_id, email, role}` |
| Exposes roles/perms | Sets `request.attributes` (roles, permissions, ext) | Only passes `role` string |
| store_context | Builds full context (path params, query, body, headers) | Sends empty `{}` for all |
| Retry on network fail | YES — configurable retries + delay | NO — single attempt, 5s timeout |
| Config source | `config/services.php` → `.env` | `os.getenv()` → `.env` |

---

## The Full Flow: HiringPizza Middleware

```
Request arrives
    │
    ├─ 1. Extract Bearer token from Authorization header
    │      if missing → abort(401)
    │
    ├─ 2. Read config from services.auth_server.*
    │      base_url, verify_path, service_name, call_token
    │      if any missing → abort(500, "config missing")
    │
    ├─ 3. Build store_context
    │      path:   route model binding params (objects → id)
    │      query:  query string params
    │      body:   JSON / form body (except large fields)
    │      header: specific store-related headers
    │
    ├─ 4. [COMMENTED OUT] Redis cache lookup
    │      key = sha256(service|token|method|path|route|ctx)
    │      TTL = 30 seconds
    │
    ├─ 5. POST to pizzasys /api/v1/auth/token-verify
    │      Authorization: Bearer <SERVICE_CALL_TOKEN>
    │      Body: { service, token, method, path, route_name, store_context }
    │      with retry(n, delay_ms)
    │
    ├─ 6. Check response:
    │      active=false  → abort(401, "Unauthorized")
    │      authorized=false → abort(403, "Forbidden")
    │      user.id <= 0  → abort(401, "missing user id")
    │
    ├─ 7. User::find($user_id) in local DB
    │      not found → abort(401, "user not synced yet")
    │
    ├─ 8. Auth::login($user) — sets session for this request
    │
    └─ 9. Set request attributes:
           authz_roles, authz_permissions, authz_ext
           → available to all downstream controllers
```

---

## The Full Flow: WebAI Bridge `get_current_user()`

```
Request arrives
    │
    ├─ 1. Extract Bearer token via OAuth2PasswordBearer
    │      if missing → raise 401
    │
    ├─ 2. If AUTH_SERVER_BASE_URL + AUTH_SERVER_CALL_TOKEN set:
    │
    │      ├─ POST to pizzasys /api/v1/auth/token-verify
    │      │   Authorization: Bearer <AUTH_SERVER_CALL_TOKEN>
    │      │   Body: { service, token, method, path, route_name=null,
    │      │            store_context: {path:{}, query:{}, body:{}, header:{}} }
    │      │
    │      ├─ active=false       → raise 401
    │      ├─ authorized=false   → raise 401
    │      ├─ missing user.id    → raise 401
    │      │
    │      ├─ SELECT FROM users WHERE id = user.id
    │      └─ not found → raise 401 "User not synced yet"
    │
    └─ 3. ELSE (fallback — no auth server configured):
           decode bridge's own JWT
           SELECT FROM users WHERE id = jwt.sub
```

---

## What HiringPizza Does That We Don't — And Whether We Need It

### 1. Redis Caching (currently commented out in HiringPizza too)

**HiringPizza**: Has the full cache implementation, just commented out.
```php
$cache->remember($cacheKey, $cacheTtl, function() { ... verifyWithAuthServer ... });
```

**Bridge**: Calls pizzasys on every single request.

**Impact**: Each API call makes a pizzasys HTTP request (~5-50ms). Under load this adds up.

**Should we add it?**
- For development: NO — makes debugging harder (stale cached responses)
- For production: YES — add 30-60 second Redis cache with the same key scheme
- Key: `sha256(service | token | method | path | route_name | store_context_hash)`

---

### 2. Separated 401 vs 403

**HiringPizza**:
```php
if (!$active)      abort(401, 'Unauthorized');   // bad/expired token
if (!$authorized)  abort(403, 'Forbidden');       // valid token, no permission
```

**Bridge**:
```python
if not data.get("active"):               raise HTTPException(401)
if not data.get("ext.authorized"):       raise HTTPException(401)  # ← wrong, should be 403
```

**Impact**: Frontend can't distinguish "please log in again" (401) from "you don't have access to this" (403).

**Fix needed**: Change the `authorized=false` case to return 403.

---

### 3. Full store_context

**HiringPizza**: Builds rich context including route model params, query string, body, and custom headers.
This allows pizzasys to make fine-grained authorization decisions like:
- "Only allow if storeId in path matches the user's assigned stores"
- "Only allow if X-Store-Id header matches authorized list"

**Bridge**: Sends empty `{}` for everything.

**Impact**: pizzasys can't use path/query/header-based rules to restrict bridge access. All rules are method+path level only.

**Should we add it?**
- Short term: NO — empty context works for simple allow-all rules
- Long term: YES — if we want per-agent or per-resource authorization

---

### 4. Retry on Network Failure

**HiringPizza**: `Http::retry($retries, $retryMs)` — retries the pizzasys call on failure.

**Bridge**: Single attempt, 5-second timeout, no retry.

**Impact**: A transient pizzasys timeout causes the user's request to fail immediately.

**Fix** (simple):
```python
async with httpx.AsyncClient(timeout=5.0) as client:
    for attempt in range(2):   # 1 retry
        try:
            resp = await client.post(...)
            break
        except httpx.TimeoutException:
            if attempt == 1: raise
```

---

### 5. Exposing Roles to Controllers

**HiringPizza**:
```php
$request->attributes->set('authz_roles', $verify['roles']);
$request->attributes->set('authz_permissions', $verify['permissions']);
```
Controllers can read `$request->attributes->get('authz_roles')` to make fine-grained decisions.

**Bridge**: Only passes `role` string (`"admin"` or `"user"`), not the full roles array from pizzasys.

**Impact**: If pizzasys has fine-grained permissions, bridge controllers can't see them.

---

## What's Different By Design (Not a Gap)

| Difference | Why It's OK |
|-----------|-------------|
| Bridge has JWT fallback | Lets bridge work standalone without pizzasys (dev/test mode) |
| Bridge uses FastAPI `Depends` | Python async pattern — equivalent to Laravel middleware |
| No `Auth::login()` | Python doesn't have session-based auth — FastAPI passes user dict instead |
| No route_name | Bridge routes don't have named routes — path matching is sufficient |

---

## Priority Fixes for the Bridge

| Priority | Fix | Effort |
|---------|-----|--------|
| 🔴 NOW | Fix 401 vs 403 — return 403 when `authorized=false` | 2 lines |
| 🟡 SOON | Add retry (1 retry on timeout) | 10 lines |
| 🟡 SOON | Log full response on `active=false` for debugging | 1 line |
| 🟢 LATER | Redis cache for token-verify results | Needs Redis container |
| 🟢 LATER | Expose full roles/permissions to route handlers | Minor refactor |
| 🟢 LATER | Build real store_context if fine-grained authz needed | Medium effort |

---

## The One Critical Shared Requirement

Both HiringPizza and the bridge have this exact same dependency:

```
pizzasys user.id  →  must exist in local DB with same id
```

```php
$user = User::find($userId);          // HiringPizza — uses pizzasys id directly
if (!$user) abort(401, 'not synced');
```

```python
cursor.execute("SELECT * FROM users WHERE id = %s", (pizzasys_id,))  # Bridge
if not row: raise HTTPException(401, "User not synced yet")
```

**If NATS is down or the user.created event was missed, nobody can log in.**
This is by design — it forces the two systems to stay in sync via NATS.
