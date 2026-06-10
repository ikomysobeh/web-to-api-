# Laravel Auth System — Full Integration Guide

> This document explains exactly how the PizzaSys Laravel auth system works,
> what endpoints the Bridge (FastAPI) must call, and what NATS events to expect.
> Read this before touching `auth.py` or `nats_sync.py`.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [How Login Works](#2-how-login-works)
3. [How the Bridge Validates a Token](#3-how-the-bridge-validates-a-token)
4. [Service-to-Service Auth (ServiceClient)](#4-service-to-service-auth-serviceclient)
5. [NATS Events — What the Bridge Receives](#5-nats-events--what-the-bridge-receives)
6. [All Auth API Endpoints](#6-all-auth-api-endpoints)
7. [Database Tables Reference](#7-database-tables-reference)
8. [Roles & Permissions System](#8-roles--permissions-system)
9. [What the Bridge Needs to Implement](#9-what-the-bridge-needs-to-implement)
10. [Config & Environment Variables](#10-config--environment-variables)
11. [Integration Checklist](#11-integration-checklist)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Laravel Auth System                   │
│                  (pizzasys — :80 / PHP)                 │
│                                                         │
│  User logs in → Sanctum token issued                    │
│  Role changes → NATS events published                   │
│  Bridge calls token-verify → gets user + role           │
└─────────────┬──────────────────────┬────────────────────┘
              │  HTTP (token-verify) │  NATS JetStream
              ▼                      ▼
┌─────────────────────┐   ┌──────────────────────────────┐
│   Bridge (FastAPI)  │   │   NATS JetStream             │
│   :8000             │◄──│   Stream: AUTH_EVENTS        │
│                     │   │   Subjects: auth.v1.*        │
│  - Validates users  │   │                              │
│  - Issues its own   │   │  user.created / updated /    │
│    JWT with role    │   │  deleted events come here    │
└─────────────────────┘   └──────────────────────────────┘
```

**Key facts:**
- Laravel uses **Sanctum** for token authentication (Bearer tokens)
- Roles are managed with **Spatie Laravel Permission**
- Events go to **NATS JetStream** using the **CloudEvents** spec
- The Bridge never stores passwords — it calls Laravel to validate, then issues its own JWT
- User role info comes from NATS events, not from a direct DB query

---

## 2. How Login Works

### Step-by-step flow

```
1. User sends email + password to the Bridge (POST /auth/login)
2. Bridge calls Laravel:  POST /api/v1/auth/login
3. Laravel validates password with bcrypt (rounds = 12)
4. Laravel creates a Sanctum token: $user->createToken('auth-token')
5. Laravel returns: user data + roles + permissions + Sanctum token
6. Bridge extracts user_id and role from the response
7. Bridge issues its own JWT (with user_id + role) to the frontend
8. Frontend uses ONLY the Bridge JWT — never the Laravel Sanctum token
```

### Laravel Login Request

**Endpoint:** `POST /api/v1/auth/login`

**Headers:**
```
Content-Type: application/json
X-Correlation-Id: <any UUID>   ← required by CorrelationIdMiddleware, 8-128 chars
```

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",

  "device_id":    "optional-device-uuid",
  "platform":     "web",
  "model":        "Chrome",
  "os_version":   "Windows 11",
  "app_version":  "1.0.0",
  "fcm_token":    null,
  "client_type":  "web"
}
```

> **For the Bridge:** Only `email` and `password` are required. All device fields are optional.

### Laravel Login Response — Success `200`

```json
{
  "token": "3|AbCdEfGhIjKlMnOpQrStUvWxYz1234567890...",
  "user": {
    "id": 42,
    "name": "Alice Smith",
    "email": "alice@example.com",
    "email_verified_at": "2025-01-01T00:00:00.000000Z",
    "created_at": "2025-01-01T00:00:00.000000Z",
    "updated_at": "2025-01-15T10:00:00.000000Z",
    "roles": [
      {
        "id": 1,
        "name": "admin",
        "guard_name": "web",
        "permissions": [
          { "id": 1, "name": "manage users", "guard_name": "web" },
          { "id": 2, "name": "manage agents", "guard_name": "web" }
        ]
      }
    ],
    "permissions": [],
    "stores": [],
    "hierarchy": []
  }
}
```

### Laravel Login Response — Failure `422`

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "email": ["These credentials do not match our records."]
  }
}
```

### How the Bridge Uses This Response

```python
# In auth.py — validate_with_laravel()
async def validate_with_laravel(email: str, password: str):
    response = await http.post(LARAVEL_AUTH_URL, json={"email": email, "password": password})

    if response.status_code == 200:
        data = response.json()
        user = data["user"]

        # Extract the first role name (e.g. "admin" or "user")
        role = "user"
        if user.get("roles"):
            role = user["roles"][0]["name"]   # take the first role

        return {
            "user_id": user["id"],            # Laravel's integer user ID
            "email": user["email"],
            "role": role
        }
    return None
```

> **Role mapping:** Laravel roles are named strings (e.g., `"admin"`, `"manager"`, `"agent"`).
> Map them to Bridge roles: if the role name is `"admin"` or `"super-admin"` → Bridge role = `"admin"`, otherwise `"user"`.

---

## 3. How the Bridge Validates a Token

Laravel has a special **token-verify** endpoint designed for service-to-service use. When the Bridge needs to check if a Sanctum token is still valid (e.g., for token refresh scenarios), it calls this.

> **Important:** For the main login flow, the Bridge does NOT need to call token-verify. It validates at login time and then issues its own JWT. Token-verify is only needed if the Bridge wants to check a Sanctum token passed directly.

### Token Verify Endpoint

**Endpoint:** `POST /api/v1/auth/token-verify`

**Auth:** Requires Service Client credentials (see Section 4)

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <service_client_token_hash>
X-Correlation-Id: <any UUID>
```

**Body:**
```json
{
  "service": "webai-bridge",
  "token": "3|AbCdEfGhIjKlMnOpQrStUvWxYz...",
  "method": "GET",
  "path": "/api/agents",
  "route_name": "api.agents.index"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `service` | ✅ | Your service name registered in ServiceClient table |
| `token` | ✅ | The Sanctum bearer token to verify |
| `method` | ❌ | HTTP method of the original request (for authorization check) |
| `path` | ❌ | Path being accessed (for authorization check) |
| `route_name` | ❌ | Laravel route name if known |

**Response — Valid token `200`:**
```json
{
  "valid": true,
  "user": {
    "id": 42,
    "name": "Alice Smith",
    "email": "alice@example.com"
  },
  "roles": ["admin"],
  "permissions": ["manage users", "manage agents"],
  "abilities": ["*"],
  "authorized": true,
  "required_permissions": [],
  "granted_by": "super_role"
}
```

**Response — Invalid/expired token `401`:**
```json
{
  "valid": false,
  "message": "Token invalid or expired"
}
```

---

## 4. Service-to-Service Auth (ServiceClient)

Before the Bridge can call any protected Laravel endpoint (like `token-verify`), it must register as a **ServiceClient** in Laravel and use that credential.

### What is a ServiceClient?

It is a named API client registered in Laravel's `service_clients` table. It has:
- A `name` (unique identifier — e.g., `"webai-bridge"`)
- A `token_hash` (SHA256 hash of the actual token)
- An `is_active` flag
- Optional `expires_at`

### How to register the Bridge as a ServiceClient

**Ask your Laravel team to run this in their system** (or via their admin UI):

```php
// In Laravel tinker or a seeder
$token = base64_encode(random_bytes(48));
ServiceClient::create([
    'name'       => 'webai-bridge',
    'token_hash' => hash('sha256', $token),
    'is_active'  => true,
    'notes'      => 'WebAI Bridge service'
]);
echo $token;  // ← save this — it's shown only once
```

The printed token value goes into the Bridge `.env` as `LARAVEL_SERVICE_TOKEN`.

### How the Bridge sends the service token

```
Authorization: Bearer <plain_token_value>
```

The plain token is what was printed above. Laravel hashes it with SHA256 and compares against `token_hash`.

### How Laravel validates the service token

```
Request arrives with:
  Authorization: Bearer abc123xyz
  (and body contains "service": "webai-bridge")

Laravel ServiceCallerAuthenticator:
  1. Read the Authorization header → extract token
  2. Look up ServiceClient WHERE name = 'webai-bridge'
  3. Verify: hash('sha256', 'abc123xyz') === stored token_hash
  4. Verify: is_active = true
  5. Verify: expires_at is null or > now
  6. Update: last_used_at = now, use_count++
  7. ✓ Authorized
```

---

## 5. NATS Events — What the Bridge Receives

### Connection Details

```
Protocol:   NATS JetStream
Host:       from config/nats.php → NATS_HOST env var
Port:       4222 (default)
Stream:     AUTH_EVENTS
Subjects:   auth.v1.>  (wildcard — catches all sub-subjects)
```

### Event Format — CloudEvents v1.0

Every message published to NATS follows the **CloudEvents** specification:

```json
{
  "specversion": "1.0",
  "id": "01JXXXXXXXXXXXXXXXX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "user/42",
  "time": "2025-01-15T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    // event-specific payload — see below
  },
  "meta": {
    "correlation_id": "some-uuid",
    "causation_id": null,
    "actor_user_id": 1,
    "actor_type": "user",
    "actor_ip": "127.0.0.1",
    "user_agent": "PostmanRuntime/7.x"
  }
}
```

> The Bridge reads the `type` field to know which event it is, then reads `data` for the payload.

---

### User Events — The ones the Bridge cares about

#### `auth.v1.user.created`
Published when a new user is created in Laravel.

```json
{
  "specversion": "1.0",
  "id": "01JXXXXXXXXXXXXXXXX",
  "type": "auth.v1.user.created",
  "source": "auth-system",
  "subject": "user/42",
  "time": "2025-01-15T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    "user_id": 42,
    "name": "Alice Smith",
    "email": "alice@example.com",
    "roles": ["user"],
    "permissions": []
  }
}
```

#### `auth.v1.user.updated`
Published when a user's email, name, or role changes.

```json
{
  "type": "auth.v1.user.updated",
  "data": {
    "user_id": 42,
    "name": "Alice Smith",
    "email": "alice@example.com",
    "roles": ["admin"],
    "permissions": []
  }
}
```

#### `auth.v1.user.deleted`
Published when a user is deleted from Laravel.

```json
{
  "type": "auth.v1.user.deleted",
  "data": {
    "user_id": 42
  }
}
```

---

### Role Assignment Events — Also relevant

These fire when a user's role changes (not just full user update). The Bridge should also listen to these to keep roles in sync.

#### `auth.v1.assignment.role.assigned`
```json
{
  "type": "auth.v1.assignment.role.assigned",
  "data": {
    "user_id": 42,
    "role": "admin",
    "store_id": null
  }
}
```

#### `auth.v1.assignment.role.removed`
```json
{
  "type": "auth.v1.assignment.role.removed",
  "data": {
    "user_id": 42,
    "role": "admin",
    "store_id": null
  }
}
```

---

### How to subscribe in `nats_sync.py`

```python
# Subscribe to all user events using wildcard
await nc.subscribe("auth.v1.user.>", cb=handle_user_event)

# Or subscribe to specific subjects:
await nc.subscribe("auth.v1.user.created", cb=handle_user_created)
await nc.subscribe("auth.v1.user.updated", cb=handle_user_updated)
await nc.subscribe("auth.v1.user.deleted", cb=handle_user_deleted)
await nc.subscribe("auth.v1.assignment.role.assigned", cb=handle_role_assigned)
await nc.subscribe("auth.v1.assignment.role.removed",  cb=handle_role_removed)
```

**Reading the CloudEvent envelope:**
```python
async def handle_user_event(msg):
    envelope = json.loads(msg.data.decode())
    event_type = envelope["type"]       # e.g. "auth.v1.user.created"
    data = envelope["data"]             # the actual payload
    user_id = data["user_id"]
    email = data.get("email")
    roles = data.get("roles", ["user"])

    # Map Laravel role list to a single Bridge role
    role = "admin" if any(r in ["admin", "super-admin"] for r in roles) else "user"

    if event_type == "auth.v1.user.created":
        upsert_user(external_id=user_id, email=email, role=role)
    elif event_type == "auth.v1.user.updated":
        upsert_user(external_id=user_id, email=email, role=role)
    elif event_type == "auth.v1.user.deleted":
        delete_user_by_external_id(user_id)
```

---

## 6. All Auth API Endpoints

Base URL: `http://<laravel-host>/api/v1`

All endpoints require the `X-Correlation-Id` header (any UUID, 8-128 chars).

### Public endpoints (no auth)

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/auth/login` | Login with email + password, returns Sanctum token + user data |
| POST | `/auth/forgot-password` | Send OTP to email for password reset |
| POST | `/auth/reset-password` | Reset password using OTP code |
| POST | `/auth/reset-otp-verify` | Verify OTP is valid without consuming it |

### Protected endpoints (require `Authorization: Bearer <sanctum_token>`)

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/auth/me` | Get current user with roles, permissions, stores |
| POST | `/auth/logout` | Delete current Sanctum token |
| POST | `/auth/refresh-token` | Revoke all tokens, issue a new one (3-day expiry) |

### Service-to-service endpoint (require ServiceClient bearer token)

| Method | Path | What it does |
|--------|------|-------------|
| POST | `/auth/token-verify` | Verify a Sanctum token and check authorization |

### Management endpoints (require Sanctum + specific permissions)

| Method | Path | Permission needed |
|--------|------|------------------|
| GET/POST/PUT/DELETE | `/users/` | `manage users` |
| GET/POST/PUT/DELETE | `/roles/` | `manage roles` |
| GET/POST/PUT/DELETE | `/permissions/` | `manage permissions` |
| GET/POST/PUT/DELETE | `/service-clients/` | `manage service clients` |
| GET/POST/PUT/DELETE | `/auth-rules/` | `manage auth rules` |
| GET/POST/PUT/DELETE | `/stores/` | `manage stores` |
| POST | `/user-role-store/assign` | `manage user role assignments` |

---

## 7. Database Tables Reference

These tables live in the Laravel database (not the Bridge database). The Bridge only syncs a small subset of user data.

| Table | Description | Bridge cares? |
|-------|-------------|--------------|
| `users` | Core user records | ✅ Syncs via NATS → local `users` table |
| `personal_access_tokens` | Sanctum tokens | ❌ Managed by Laravel only |
| `roles` | Role definitions (Spatie) | ✅ Role names come with NATS events |
| `permissions` | Permission definitions (Spatie) | ❌ Not needed by Bridge |
| `model_has_roles` | User ↔ Role assignments | ❌ Changes trigger NATS events |
| `model_has_permissions` | Direct user permissions | ❌ Not needed by Bridge |
| `role_has_permissions` | Role ↔ Permission assignments | ❌ Not needed by Bridge |
| `otps` | Password reset OTP codes | ❌ Laravel internal |
| `service_clients` | API client credentials | ✅ Bridge registers here |
| `user_role_store` | Multi-tenant role assignments | ❌ Bridge uses flat roles only |
| `role_hierarchy` | Role parent/child relationships | ❌ Not needed by Bridge |
| `user_devices` | Mobile device tracking | ❌ Not needed by Bridge |
| `auth_outbox_events` | NATS outbox queue | ❌ Laravel internal |
| `auth_rules` | Dynamic authorization rules | ❌ Laravel internal |
| `stores` | Multi-tenant store entities | ❌ Not needed by Bridge |

### The `users` table structure in Laravel

```sql
users
├── id                BIGINT PRIMARY KEY (auto-increment)
├── name              VARCHAR
├── email             VARCHAR (unique)
├── email_verified_at TIMESTAMP nullable
├── password          VARCHAR (bcrypt, 12 rounds)
├── remember_token    VARCHAR nullable
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

> The Bridge maps Laravel's `id` → local `external_id` column.

---

## 8. Roles & Permissions System

### How roles work in Laravel

Laravel uses the **Spatie Laravel Permission** package. Roles are named strings. Users can have multiple roles.

### The roles in this system

The exact role names depend on what was seeded in this project. Based on the system structure, expect:

| Role name | Access level |
|-----------|-------------|
| `super-admin` | Everything, bypasses all rules |
| `admin` | Management of users, agents, stores |
| `manager` | Store-level management |
| `agent` | Operational tasks |
| `user` | Basic access |

> **Ask your Laravel team for the exact list of roles they use.** Run this to get them:
> ```bash
> php artisan tinker
> >>> \Spatie\Permission\Models\Role::pluck('name')
> ```

### How the Bridge maps roles

The Bridge only needs two levels: `admin` and `user`. Map like this:

```python
ADMIN_ROLES = {"super-admin", "admin"}

def map_laravel_role_to_bridge(laravel_roles: list) -> str:
    for r in laravel_roles:
        if r in ADMIN_ROLES:
            return "admin"
    return "user"
```

### Multi-store roles (important note)

Laravel supports **store-scoped** roles via the `user_role_store` table. A user can be an `admin` in Store A but a `user` in Store B. **The Bridge ignores store scoping** — it takes the highest role across all stores.

```python
# If a user has ["user", "admin"] → Bridge role = "admin"
# If a user has ["user", "manager"] → Bridge role = "admin" (because manager maps to admin)
```

---

## 9. What the Bridge Needs to Implement

### Summary of changes needed in `auth.py`

```
CHANGE 1 — validate_with_laravel()
  - Call POST /api/v1/auth/login with email + password
  - Extract user_id, email, role from response
  - Return dict or None

CHANGE 2 — create_token()
  - Already planned: add role to JWT payload

CHANGE 3 — get_current_user()
  - Already planned: return role from DB

CHANGE 4 — require_admin()
  - Already planned: check role == "admin"
```

### Summary of changes needed in `nats_sync.py`

```
CHANGE 1 — Subject names
  Use:  auth.v1.user.created
        auth.v1.user.updated
        auth.v1.user.deleted

  NOT:  user.created
        user.updated
        user.deleted   ← These were the PLACEHOLDER names in the plan

CHANGE 2 — Event envelope
  The payload is wrapped in a CloudEvents envelope.
  Read: envelope["data"]["user_id"]
  NOT:  envelope["user_id"]

CHANGE 3 — Role extraction
  Roles come as a list: data["roles"] = ["admin"]
  Map to a single Bridge role using the map_laravel_role_to_bridge() function
```

### Exact `nats_sync.py` handler mapping

```python
# Subject                              → Handler
"auth.v1.user.created"               → upsert_user(external_id, email, role)
"auth.v1.user.updated"               → upsert_user(external_id, email, role)  ← same function
"auth.v1.user.deleted"               → delete_user_by_external_id(user_id)
"auth.v1.assignment.role.assigned"   → upsert_user role change (re-fetch or update role column)
"auth.v1.assignment.role.removed"    → upsert_user role change (re-fetch or update role column)
```

---

## 10. Config & Environment Variables

### Laravel `.env` variables relevant to integration

```env
# NATS connection
NATS_HOST=127.0.0.1
NATS_PORT=4222
NATS_TOKEN=              # if using token auth
NATS_USER=               # if using user+pass auth
NATS_PASS=

# Mail (OTP sending)
MAIL_MAILER=log          # log = OTP printed to log file, not sent to real email
MAIL_FROM_ADDRESS=noreply@pizzasys.com

# Password hashing rounds
BCRYPT_ROUNDS=12

# App
APP_URL=http://localhost
```

### Bridge `.env` variables to add

```env
# Laravel auth API (where to call for login validation)
LARAVEL_AUTH_URL=http://localhost/api/v1/auth/login

# Service client credentials (registered in Laravel's service_clients table)
LARAVEL_SERVICE_NAME=webai-bridge
LARAVEL_SERVICE_TOKEN=<the token printed when service client was created>

# NATS
NATS_URL=nats://127.0.0.1:4222
NATS_TOKEN=<same token from Laravel NATS_TOKEN>
```

---

## 11. Integration Checklist

Go through this with your Laravel team before starting implementation:

### Things to confirm with the Laravel team

- [ ] **Get the exact NATS event types for users** — confirm the subjects are `auth.v1.user.created`, `auth.v1.user.updated`, `auth.v1.user.deleted`
- [ ] **Confirm the `data` field structure** for each user event — especially the field name for the user ID (`user_id`? `id`? `userId`?)
- [ ] **Confirm the roles field name** in event data — is it `roles` (array of strings)? `role` (single string)?
- [ ] **Create a ServiceClient** for the Bridge in Laravel's system and share the token
- [ ] **Share the exact base URL** of the Laravel instance (local dev vs production)
- [ ] **Share the list of role names** they use so the Bridge can map them correctly
- [ ] **Confirm NATS auth method** — token-based or user+password?
- [ ] **Confirm whether they use JetStream or core NATS** — affects how the Bridge subscribes

### Things to set up on the Bridge side

- [ ] Add `LARAVEL_AUTH_URL` to `.env`
- [ ] Add `LARAVEL_SERVICE_NAME` and `LARAVEL_SERVICE_TOKEN` to `.env`
- [ ] Add `NATS_URL` and `NATS_TOKEN` to `.env`
- [ ] Update `nats_sync.py` subject names from placeholder to actual (`auth.v1.user.*`)
- [ ] Update `nats_sync.py` to unwrap the CloudEvents envelope before reading fields
- [ ] Update `auth.py` `validate_with_laravel()` to point to the right URL and parse the response correctly
- [ ] Test: create a user in Laravel → confirm they appear in Bridge DB within seconds
- [ ] Test: promote a user to admin in Laravel → confirm Bridge DB role updates via NATS
- [ ] Test: delete a user in Laravel → confirm they are removed from Bridge DB

---

## Quick Reference — Exact HTTP Call the Bridge Makes at Login

```python
# auth.py — validate_with_laravel()

LARAVEL_AUTH_URL = "http://localhost/api/v1/auth/login"

async with httpx.AsyncClient(timeout=10.0) as client:
    resp = await client.post(
        LARAVEL_AUTH_URL,
        json={"email": email, "password": password},
        headers={"X-Correlation-Id": "webai-bridge-login"}
    )

# resp.status_code == 200 → success
# resp.json() structure:
# {
#   "token": "3|...",
#   "user": {
#     "id": 42,
#     "email": "alice@example.com",
#     "roles": [{"id": 1, "name": "admin", ...}],
#     ...
#   }
# }

data = resp.json()
user = data["user"]
laravel_roles = [r["name"] for r in user.get("roles", [])]
bridge_role = "admin" if any(r in {"admin","super-admin"} for r in laravel_roles) else "user"

return {
    "user_id": user["id"],
    "email":   user["email"],
    "role":    bridge_role
}
```

---

## Quick Reference — Exact NATS Message the Bridge Receives

```python
# nats_sync.py — handle_user_created()

async def handle_user_created(msg):
    # msg.subject = "auth.v1.user.created"
    # msg.data    = bytes of the CloudEvents JSON

    envelope = json.loads(msg.data.decode())

    # Envelope fields:
    # envelope["specversion"] = "1.0"
    # envelope["type"]        = "auth.v1.user.created"
    # envelope["source"]      = "auth-system"
    # envelope["subject"]     = "user/42"
    # envelope["time"]        = "2025-01-15T10:30:00Z"
    # envelope["data"]        = { actual payload }

    data = envelope["data"]

    # Data fields (confirm exact names with Laravel team):
    user_id = data["user_id"]           # integer — Laravel's user.id
    email   = data["email"]
    roles   = data.get("roles", [])     # list of role name strings

    bridge_role = "admin" if any(r in {"admin","super-admin"} for r in roles) else "user"
    upsert_user(external_id=user_id, email=email, role=bridge_role)
```

---

*This document is based on reading the actual source code of `C:\xampp\htdocs\projacet\pizzasys`. Confirm the highlighted points with the Laravel team before implementing — especially the exact NATS subject names, event payload field names, and role name strings they use.*
