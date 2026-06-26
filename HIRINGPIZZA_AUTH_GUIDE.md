# HiringPizza Auth Flow — Complete Guide
## How Auth Works, What to Change, and Why

---

## The 3 Players

There are 3 separate applications talking to each other:

```
┌─────────────────────────┐
│  Frontend (HiringPizza) │  ← browser / React app
└────────────┬────────────┘
             │
    ┌────────▼─────────┐        ┌──────────────────────────────┐
    │  HiringPizza API │───────▶│  pizzasys (Auth Server)      │
    │  (Laravel app)   │        │  localhost:8001              │
    └──────────────────┘        │  OR authtesting.lcportal.cloud│
                                └──────────────────────────────┘
```

| App | What It Does | Where It Runs |
|-----|-------------|---------------|
| **Frontend** | The UI the user sees | Browser |
| **HiringPizza API** | The business logic app | `C:\xampp\htdocs\projacet\HiringPizza` |
| **pizzasys** | The auth server — issues and verifies tokens | `C:\xampp\htdocs\projacet\pizzasys` |

---

## The Complete Auth Flow — Step by Step

### Step 1: User Logs In

```
Frontend
  → POST /api/v1/auth/login    (goes to PIZZASYS)
  → Body: { email, password }
  → Response: { token: "5|abc123..." }

Frontend stores the token in memory/localStorage
```

The token is a **Laravel Sanctum token** — it looks like `5|abcdef123456...`
The number before `|` is the token ID in pizzasys's database.

---

### Step 2: Frontend Calls HiringPizza API

Every request the frontend makes to HiringPizza includes the token:

```
Frontend
  → GET /api/v1/stores/{storeId}/employees
  → Header: Authorization: Bearer 5|abcdef123456...
  → (goes to HIRINGPIZZA, not pizzasys)
```

---

### Step 3: HiringPizza Middleware Verifies the Token

Every route under `/v1/*` in HiringPizza uses the middleware `auth.token.store`.
This middleware is `AuthTokenStoreScopeMiddleware.php`.

Here is exactly what it does:

```
1. Extract Bearer token from the request header
2. Read AUTH SERVER config from .env
3. Call pizzasys token-verify endpoint:
   POST http://localhost:8001/api/v1/auth/token-verify
   Header: Authorization: Bearer <SERVICE_CALL_TOKEN>  ← HiringPizza's own service token
   Body: {
     service: "hiring-pizza",
     token: "5|abcdef123456...",   ← the user's token
     method: "GET",
     path: "/api/v1/stores/123/employees",
     route_name: "api.v1.stores.employees.index",
     store_context: { path: {storeId: "123"}, query: {}, body: {} }
   }
4. pizzasys responds: { active: true, authorized: true, user: {id: 42}, roles: [...] }
5. Middleware checks: active=true AND authorized=true
6. Middleware looks up user ID 42 in HIRINGPIZZA's own database
7. If user exists → Auth::login($user) → request proceeds
8. If user NOT found → 401 Unauthorized
```

---

### Step 4: pizzasys Verifies and Returns Permission Decision

This is what `TokenVerifyController.php` does:

```
1. Verify the service call token (is this a registered service?)
2. Find the Sanctum token in the database
3. Check: is the token expired?
4. Get the user's roles and permissions
5. Check authorization rules (from auth_rules table):
   "does this service + method + path combination require certain permissions?"
6. Return:
   {
     active: true,
     authorized: true,
     user: { id: 42, name: "...", email: "..." },
     roles: ["super-admin"],
     permissions: ["manage users", ...]
   }
```

---

### Step 5: User Must Exist in BOTH Databases

This is the critical dependency:

```
pizzasys DB:      has user with id=42
HiringPizza DB:   MUST ALSO have user with id=42

If HiringPizza DB does NOT have user 42:
  → middleware returns 401 "user not synced yet"
```

**This is why NATS is essential.** When a user is created in pizzasys,
the NATS `user.created` event is sent, and HiringPizza must consume it
to create the user in its own database.

Without NATS sync → users exist in pizzasys but not HiringPizza → auth fails.

---

## What Needs to Change

There are **two separate things** to change:

1. **Frontend** — hardcoded production URL → must become configurable
2. **HiringPizza backend `.env`** — must point to the correct auth server

---

## Change 1 — Frontend: Auth Server URLs

The frontend currently has these 4 endpoints hardcoded to production:

| Endpoint | Method | Goes To |
|----------|--------|---------|
| `login` | POST | `https://authtesting.lcportal.cloud/api/v1/auth/login` |
| `logout` | POST | `https://authtesting.lcportal.cloud/api/v1/auth/logout` |
| `me` | GET | `https://authtesting.lcportal.cloud/api/v1/auth/me` |
| `users list` | GET | `https://authtesting.lcportal.cloud/api/v1/users` |

All 4 go to **pizzasys** (the auth server). They should NOT go to HiringPizza.

For local development, these must become:

| Endpoint | Local URL |
|----------|-----------|
| `login` | `http://localhost:8001/api/v1/auth/login` |
| `logout` | `http://localhost:8001/api/v1/auth/logout` |
| `me` | `http://localhost:8001/api/v1/auth/me` |
| `users list` | `http://localhost:8001/api/v1/users` |

**Where to find these in the frontend:**
Search the frontend source for `authtesting.lcportal.cloud` — every file that contains
that string has a URL that needs to become a config variable.

The correct pattern is to use an environment variable:
```javascript
// .env.local (for local dev)
VITE_AUTH_BASE_URL=http://localhost:8001

// .env.production (for production)
VITE_AUTH_BASE_URL=https://authtesting.lcportal.cloud
```

Then in the code:
```javascript
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL

// login
fetch(`${AUTH_BASE_URL}/api/v1/auth/login`, ...)

// logout
fetch(`${AUTH_BASE_URL}/api/v1/auth/logout`, ...)

// me
fetch(`${AUTH_BASE_URL}/api/v1/auth/me`, ...)

// users
fetch(`${AUTH_BASE_URL}/api/v1/users`, ...)
```

**Tell me where the frontend code is** and I will find the exact lines to change.

---

## Change 2 — HiringPizza Backend: `.env` File

HiringPizza does NOT have a `.env` file yet — only `.env.example`.

You need to create `.env` from `.env.example`:
```
copy C:\xampp\htdocs\projacet\HiringPizza\.env.example C:\xampp\htdocs\projacet\HiringPizza\.env
```

Then add these lines at the bottom of `.env`:

```env
# ── Auth Server (pizzasys) ───────────────────────────────────────────────────
# Local dev:
AUTH_SERVER_BASE_URL=http://localhost:8001
# Production:
# AUTH_SERVER_BASE_URL=https://authtesting.lcportal.cloud

# The path where pizzasys verifies tokens — NOTE: hyphen not slash
AUTH_SERVER_VERIFY_PATH=/api/v1/auth/token-verify

# The name of this service — must match what you register in pizzasys service_clients
AUTH_SERVER_SERVICE_NAME=hiring-pizza

# The service client token — get this from pizzasys (see "How to get the service token" below)
AUTH_SERVER_CALL_TOKEN=

# Optional tuning
AUTH_SERVER_TIMEOUT=3
AUTH_SERVER_RETRIES=1
AUTH_SERVER_RETRY_MS=100
```

---

## Important: Path Bug in Default Config

Look at `config/services.php` line 41:

```php
'verify_path' => env('AUTH_SERVER_VERIFY_PATH', '/api/v1/auth/token/verify'),
```

The **default** value is `/api/v1/auth/token/verify` — with a **slash** between `token` and `verify`.

But the **actual route** in pizzasys is:
```php
Route::post('/token-verify', ...)   // HYPHEN, not slash
```

Full path: `/api/v1/auth/token-verify`

**If you don't set `AUTH_SERVER_VERIFY_PATH` in `.env`, the default will be wrong and ALL requests will fail with 500.**

Always set it explicitly in `.env`:
```
AUTH_SERVER_VERIFY_PATH=/api/v1/auth/token-verify
```

---

## How to Get the Service Client Token

HiringPizza needs its own token to call pizzasys. This is the `AUTH_SERVER_CALL_TOKEN`.

**How pizzasys validates the service token (important to understand):**

```
HiringPizza sends:
  Authorization: Bearer abc123plaintoken
  Body: { service: "hiring-pizza", ... }

pizzasys ServiceCallerAuthenticator does:
  1. Finds ServiceClient where name = "hiring-pizza"
  2. Computes: sha256("abc123plaintoken")
  3. Compares with token_hash column in DB
  4. If match AND is_active=true → allowed
```

**pizzasys NEVER stores the plain token — only its SHA256 hash.**
The plain token is shown ONCE when created. If you lose it, you must rotate (regenerate) it.

---

**How to create the service client:**

**Step 1:** Log in to pizzasys as super-admin via Postman:
```
POST http://localhost:8001/api/v1/auth/login
Body: { "email": "admin@example.com", "password": "..." }
```

**Step 2:** Create a service client for HiringPizza:
```
POST http://localhost:8001/api/v1/service-clients
Authorization: Bearer <admin_token>
Content-Type: application/json
Body:
{
  "name": "hiring-pizza",
  "description": "HiringPizza workforce service"
}
```

The response will include a `token` field — this is the plain token, shown only once. Copy it.

**Step 3:** Put that token in HiringPizza's `.env`:
```
AUTH_SERVER_CALL_TOKEN=theTokenYouGotFromStep2
```

**Step 4:** If you lose the token, rotate it:
```
POST http://localhost:8001/api/v1/service-clients/{id}/rotate-token
Authorization: Bearer <admin_token>
```
A new plain token will be returned. Update HiringPizza's `.env` with the new one.

---

## How to Create Auth Rules in pizzasys

The middleware checks not only if the token is valid (`active`) but also if the user
is **authorized** for this specific route (`authorized`).

The authorization is controlled by rules in pizzasys's `auth_rules` table.

If no rule exists for `hiring-pizza` + a specific route → `authorized = false` → HiringPizza returns 403.

**To create a rule that allows all authenticated users into HiringPizza:**

```
POST http://localhost:8001/api/v1/auth-rules
Authorization: Bearer <admin_token>
Body:
{
  "service": "hiring-pizza",
  "method": "*",
  "path": "*",
  "required_permission": null,
  "is_active": true
}
```

This says: "any authenticated user with a valid token can access all HiringPizza routes."

You can make it more restrictive by specifying method/path/required_permission.

---

## Full Flow Diagram (Local Dev)

```
Browser
  │
  ├─ POST http://localhost:8001/api/v1/auth/login
  │    → pizzasys returns token "5|abc123"
  │
  ├─ GET  http://localhost:8001/api/v1/auth/me
  │    → pizzasys returns user info
  │
  ├─ GET  http://localhost:8001/api/v1/users
  │    → pizzasys returns user list
  │
  └─ GET  http://localhost:{hiringpizza_port}/api/v1/stores/{id}/employees
       Header: Authorization: Bearer 5|abc123
         │
         └─ HiringPizza middleware receives request
              │
              └─ POST http://localhost:8001/api/v1/auth/token-verify
                   Header: Authorization: Bearer <SERVICE_CALL_TOKEN>
                   Body: { service: "hiring-pizza", token: "5|abc123", ... }
                     │
                     └─ pizzasys: token valid + authorized=true
                          │
                          └─ HiringPizza: finds user in own DB
                               │
                               └─ Request proceeds to controller ✅
```

---

## What Happens If NATS is Not Working

If a user exists in pizzasys but NOT in HiringPizza's database:

```
HiringPizza middleware:
  1. Calls pizzasys token-verify → gets active=true, user.id=42
  2. Does: User::find(42) in HiringPizza DB
  3. Gets: null (user not in HiringPizza DB)
  4. Returns: 401 "Unauthorized: user not synced yet"
```

**The only way to fix this is one of:**
- NATS is working and the user.created event was processed by HiringPizza
- OR manually insert the user into HiringPizza's `users` table

This is why NATS sync between pizzasys and HiringPizza is critical.

---

## Summary — What to Do

```
Step 1: Create HiringPizza .env from .env.example
Step 2: Set AUTH_SERVER_BASE_URL=http://localhost:8001
Step 3: Set AUTH_SERVER_VERIFY_PATH=/api/v1/auth/token-verify  ← hyphen!
Step 4: Create service client in pizzasys → get token
Step 5: Set AUTH_SERVER_CALL_TOKEN=<token from step 4>
Step 6: Create auth rule in pizzasys for service "hiring-pizza"
Step 7: Fix frontend → replace hardcoded URLs with env variable
Step 8: Make sure users are synced via NATS (user must exist in BOTH DBs)
```

---

## Config Files That Control This

| File | What It Controls |
|------|-----------------|
| `HiringPizza/.env` | Which auth server to use, service token |
| `HiringPizza/config/services.php` | Reads from .env — do not edit directly |
| `HiringPizza/app/Http/Middleware/AuthTokenStoreScopeMiddleware.php` | The middleware logic — no changes needed |
| `pizzasys/routes/api/v1.php` | Defines the `/token-verify` route |
| `pizzasys/app/Http/Controllers/Api/V1/Auth/TokenVerifyController.php` | Verifies the token |
| Frontend `.env.local` / `.env.production` | Which auth server the browser calls |
