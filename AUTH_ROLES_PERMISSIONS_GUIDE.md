# Roles & Permissions — Current State vs pizzasys-Managed

---

## How It Works RIGHT NOW

### The simple 2-role system

The bridge has only **two roles**: `admin` and `user`.
Role is stored as a plain text column in the local `users` table.

```
users table:
  id       INTEGER   (= pizzasys user id)
  email    TEXT
  role     TEXT      ← "admin" or "user"
  ...
```

### Where role comes from today

1. **NATS `user.created`** → `nats_sync.py` maps pizzasys roles to bridge role:
   - `super-admin` or `admin` → bridge `"admin"`
   - anything else → bridge `"user"`
2. **Token-verify auto-upsert** (current) → same mapping, on every request

### How auth is enforced today

`auth.py` has two FastAPI dependencies:

| Dependency | Used on | What it does |
|-----------|---------|-------------|
| `get_current_user` | all `/api/*` routes | Verifies token, returns user dict with role |
| `require_admin` | all `/admin/*` routes | Calls `get_current_user`, then checks `role == "admin"` |

```python
# auth.py — current
def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

### Frontend admin check

`AuthContext.tsx` calls `checkAdmin(token)` after every login.
`checkAdmin()` in `api.ts` calls pizzasys `/auth/me` and checks if `roles` array contains `"admin"` or `"super-admin"`.

```
Login
 → pizzasys returns Sanctum token
 → frontend calls pizzasys GET /auth/me
 → checks roles array
 → sets isAdmin=true/false in React context
 → isAdmin controls whether /admin/* routes are accessible
```

### What is NOT possible today

- You cannot grant a user access to only SOME admin routes (all-or-nothing)
- You cannot create fine-grained permissions (e.g. "can upload documents but not delete agents")
- Role changes in pizzasys take effect on next request (because of auto-upsert), but you still have to manually set roles in pizzasys
- The bridge has no way to check specific permissions, only the role string

---

## How It Should Work After the Change

### The idea: trust pizzasys completely

Instead of mapping pizzasys roles to a local "admin"/"user" string and checking that,
the bridge should **pass the full roles and permissions from every token-verify response**
down to route handlers — exactly like `AuthTokenStoreScopeMiddleware` does in HiringPizza.

```
Every request:
  token-verify → pizzasys checks: is token valid? is user authorized for this route?
                                   what roles does this user have?
                                   what permissions does this user have?
  bridge uses the response directly — no local role mapping
```

### What token-verify already returns (we're not using it all)

```json
{
  "active": true,
  "user": { "id": 2, "email": "...", "name": "..." },
  "roles": ["super-admin"],
  "permissions": ["manage users", "manage agents", "upload documents"],
  "ext": {
    "authorized": true,
    "required_permissions": [],
    "granted_by": "role:super-admin"
  }
}
```

Today we only use: `active`, `ext.authorized`, `user.id`, `user.email`
We throw away: `roles`, `permissions`, `ext.required_permissions`, `ext.granted_by`

### After the change

The `get_current_user` function returns this richer dict:

```python
# After change
{
  "user_id": 2,
  "email": "...",
  "role": "admin",          # kept for backwards compat
  "roles": ["super-admin"], # full list from pizzasys
  "permissions": ["manage users", "manage agents", "upload documents"],
}
```

Route handlers and dependencies can then check specific permissions:

```python
def require_permission(permission: str):
    def dep(user: dict = Depends(get_current_user)):
        if permission not in user.get("permissions", []):
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        return user
    return dep

# Usage:
@app.post("/admin/agents/{id}/documents")
async def upload_doc(user = Depends(require_permission("upload documents"))):
    ...
```

### Route-level authorization via pizzasys auth_rules

The most powerful option: let pizzasys decide if a user can access a route,
instead of checking permissions in Python code.

You create rules in pizzasys like:

| service | method | path_dsl | roles_any | what it means |
|---------|--------|----------|-----------|--------------|
| `webai-bridge` | `ANY` | `*` | `["super-admin"]` | super-admins can do anything |
| `webai-bridge` | `GET` | `/admin/*` | `["super-admin", "admin"]` | admins can read admin pages |
| `webai-bridge` | `POST` | `/admin/agents/*/documents` | `["super-admin"]` | only super-admins can upload |
| `webai-bridge` | `ANY` | `/api/*` | `["super-admin", "admin", "user"]` | all authenticated users |

When token-verify runs, pizzasys checks these rules and sets `ext.authorized = true/false`.
The bridge only needs to check `ext.authorized` — no permission logic in Python needed.

---

## What Needs to Change

### Area 1 — `auth.py`: Pass full roles and permissions

**File:** `webai-bridge/auth.py`

**Current** — `verify_with_pizzasys()` returns only:
```python
return {
    "external_id": int(user_obj.get("id", 0)),
    "email": str(user_obj.get("email", "")),
    "roles": data.get("roles", []),
}
```

**After** — include permissions and ext:
```python
return {
    "external_id": int(user_obj.get("id", 0)),
    "email":       str(user_obj.get("email", "")),
    "roles":       data.get("roles", []),
    "permissions": data.get("permissions", []),
    "ext":         data.get("ext", {}),
}
```

**Current** — `get_current_user()` returns:
```python
return {"user_id": pizzasys_id, "email": ..., "role": bridge_role}
```

**After** — include everything:
```python
return {
    "user_id":     pizzasys_id,
    "email":       pizzasys_result["email"],
    "role":        bridge_role,                         # kept for backwards compat
    "roles":       pizzasys_result.get("roles", []),
    "permissions": pizzasys_result.get("permissions", []),
}
```

**Current** — `require_admin()` checks local role string:
```python
def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403)
    return user
```

**After** — check pizzasys roles (or leave as-is since role is still mapped correctly):
```python
ADMIN_ROLES = {"super-admin", "admin"}

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not any(r in ADMIN_ROLES for r in user.get("roles", [])):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

**New** — add `require_permission()` dependency factory:
```python
def require_permission(permission: str):
    """Use as: Depends(require_permission("upload documents"))"""
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if permission not in user.get("permissions", []):
            raise HTTPException(
                status_code=403,
                detail=f"Missing permission: {permission}"
            )
        return user
    return dep
```

---

### Area 2 — `main.py`: Use permission-based guards where needed

**File:** `webai-bridge/main.py`

Today ALL `/admin/*` routes use `require_admin` (binary: admin or not).
After the change, you can split them:

```python
# Keep: broad admin check (super-admin or admin role)
@app.get("/admin/agents")
def list_agents(user = Depends(require_admin)):
    ...

# New option: specific permission required
@app.post("/admin/agents/{id}/documents")
async def upload_doc(user = Depends(require_permission("upload documents"))):
    ...

# New option: route-level only — trust pizzasys ext.authorized fully
# (no extra Python permission check needed — pizzasys already decided)
@app.delete("/admin/agents/{id}")
def delete_agent(user = Depends(get_current_user)):
    # if pizzasys auth_rules has a rule that limits DELETE /admin/agents/*
    # to super-admins only, this is already blocked at token-verify
    ...
```

---

### Area 3 — `main.py`: Remove the local role update endpoint

**File:** `webai-bridge/main.py` lines ~1387-1400

This endpoint lets you change a user's bridge-local role:
```python
@app.put("/admin/users/{target_user_id}/role")
def admin_update_user_role(target_user_id: int, data: RoleUpdate, ...):
    cursor.execute("UPDATE users SET role = %s WHERE id = %s", ...)
```

**After the change this does nothing useful** — roles come from pizzasys on every request.
The bridge's local `role` column becomes irrelevant (roles are in the user dict from token-verify).

Options:
- Remove the endpoint entirely
- Keep it but make it call pizzasys to assign the role there
- Keep it as-is (it will be overwritten on the next request anyway)

---

### Area 4 — `main.py`: Remove `external_id` from admin users list

**File:** `webai-bridge/main.py` line ~1375

```python
# Current — references external_id which no longer exists
cursor.execute("""
    SELECT id, email, role, external_id, synced_at, created_at FROM users ...
""")
```

```python
# After — remove external_id
cursor.execute("""
    SELECT id, email, role, synced_at, created_at FROM users ORDER BY created_at DESC
""")
```

---

### Area 5 — pizzasys: Create auth_rules for each route type

Once the bridge checks `ext.authorized` properly, you set fine-grained rules in pizzasys.

**Current rule (too broad — allows all super-admins everywhere):**
```json
{ "service": "webai-bridge", "method": "ANY", "path_dsl": "*", "roles_any": ["super-admin"] }
```

**Better rules:**
```
POST /api/v1/auth-rules   (run 4 times)

Rule 1 — all users can use /api/* (chat, conversations, etc.)
{
  "service": "webai-bridge",
  "method": "ANY",
  "path_dsl": "/api/*",
  "roles_any": ["super-admin"],
  "is_active": true
}

Rule 2 — admins can read /admin/*
{
  "service": "webai-bridge",
  "method": "GET",
  "path_dsl": "/admin/*",
  "roles_any": ["super-admin"],
  "is_active": true
}

Rule 3 — only super-admins can write /admin/*
{
  "service": "webai-bridge",
  "method": "POST",
  "path_dsl": "/admin/*",
  "roles_any": ["super-admin"],
  "is_active": true
}
```

Note: currently only `super-admin` role exists in pizzasys. Once you add more roles (e.g. `admin`, `user`), add them to `roles_any` accordingly.

---

### Area 6 — Frontend: Use roles from token-verify, not a separate /me call

**File:** `web2api-ui/src/services/api.ts` and `AuthContext.tsx`

**Current flow:**
1. Login → get token
2. Separate call to pizzasys `GET /auth/me` → check roles
3. `checkAdmin()` extracts role from that response

**After** — roles are already in the login response (pizzasys returns them):
```typescript
// login() already returns the full pizzasys response
// which includes user.roles — no separate /me call needed for admin check

export async function checkAdmin(token: string): Promise<boolean> {
  // Instead of calling /me again, parse roles from the login response
  // OR keep calling /me but it's an extra round-trip
}
```

For now the frontend works fine as-is. Optimization for later.

---

## Summary — File Change Checklist

```
Priority 1 — Must fix now (bugs):
  ✅ auth.py          — return roles + permissions from verify_with_pizzasys
  ✅ auth.py          — require_admin uses roles array not role string
  ✅ main.py          — remove external_id from SELECT in admin_list_users

Priority 2 — Adds real permission control:
  ☐ auth.py          — add require_permission() dependency
  ☐ main.py          — use require_permission() on sensitive admin routes
  ☐ pizzasys         — create fine-grained auth_rules per route

Priority 3 — Cleanup:
  ☐ main.py          — remove or rework PUT /admin/users/{id}/role endpoint
  ☐ database.py      — remove role column from users table (becomes redundant)
  ☐ nats_sync.py     — remove role mapping (no longer needed to store locally)
```

---

## The Key Insight: Two Layers of Authorization

```
Layer 1 — pizzasys token-verify (already active):
  Checks: is this token valid? is this user allowed on this route at all?
  Result: ext.authorized = true/false
  Controlled by: auth_rules table in pizzasys

Layer 2 — bridge Python code (optional, for fine-grained):
  Checks: does this user have the specific permission for this action?
  Result: 403 if not
  Controlled by: require_permission() dependency in main.py
```

Most projects only need Layer 1 (let pizzasys decide everything via auth_rules).
Layer 2 is for business logic that pizzasys can't know about
(e.g. "can only modify agents you created yourself").

---

## Quick Comparison: Current vs After

| Aspect | Current | After |
|--------|---------|-------|
| Where roles are stored | `users.role` column (local) | Token-verify response (live from pizzasys) |
| Admin check | `role == "admin"` string | `roles` array contains admin role |
| Permission check | Not possible | `require_permission("...")` or pizzasys auth_rules |
| Role changes take effect | Next request (auto-upsert) | Next request (same — from token-verify) |
| Who controls access | Bridge Python code | pizzasys auth_rules + optional bridge code |
| Route-level rules | Not possible | pizzasys auth_rules per method+path |
| New roles (e.g. "manager") | Requires code change in bridge | Add role in pizzasys + update auth_rules |
