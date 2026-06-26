# Analysis: Logout Does Not Delete Gemini Cookies

**Date:** 2026-06-24
**Status:** Analysis only. No code changed yet.

---

## 1. What Should Happen on Logout

When a user logs out, two things should happen:

1. **Frontend** — clear the JWT from `localStorage` and redirect to `/login`
2. **Backend** — delete the user's encrypted Gemini cookies from the database
   so their Gemini session is fully disconnected

Currently only #1 happens. #2 does not.

---

## 2. What Actually Happens Now (the gap)

### 2.1 Frontend logout flow

The logout button is in `SidebarFooter.tsx` (`handleLogout`, line 35):

```ts
async function handleLogout() {
  setDropdownOpen(false);
  if (token) void postLogout(token).catch(() => {});   // ← calls EXT_BASE /auth/logout
  resetForLogout();
  logout();          // ← clears localStorage + React state
  navigate("/login");
}
```

And `AuthContext.tsx` `logout()` function (line 60):

```ts
function logout() {
  if (token) void postLogout(token);     // ← same EXT_BASE /auth/logout call (called TWICE)
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_email')
  setToken(null)
  setUser(null)
  setIsAdmin(null)
}
```

> **Note:** `postLogout` is called **twice** on logout — once in `handleLogout` (SidebarFooter)
> and once inside `logout()` (AuthContext). This is a minor redundancy bug but not the main issue.

### 2.2 Where postLogout actually goes

`api.ts` line 87:

```ts
export async function postLogout(token: string): Promise<void> {
  await fetch(`${EXT_BASE}/auth/logout`, {   // EXT_BASE = authtesting.lcportal.cloud/api/v1
    method: "POST",
    headers: authHeaders(token),
  });
}
```

`EXT_BASE` is the **external auth service** (`authtesting.lcportal.cloud`), **not** the
`webai-bridge` backend. So this call goes to a completely different server — it only
invalidates the session on that external auth provider. It does **nothing** to the
Gemini cookies stored in the local `webai-bridge` Postgres database.

### 2.3 The webai-bridge logout endpoint that DOES delete cookies

`webai-bridge/main.py` line 1079 — there is a purpose-built logout endpoint:

```python
# POST /api/user/logout - Explicit logout + Gemini disconnect
@app.post("/api/user/logout", dependencies=[Depends(get_current_user)])
async def logout(user = Depends(get_current_user)):
    """
    Logout: clear JWT on frontend AND disconnect Gemini session.
    Reuses the same cleanup as DELETE /api/cookies.
    """
    delete_cookies(user["user_id"])                      # ← deletes from DB
    await remove_webai_client_for_user(user["user_id"])  # ← tears down in-memory client
    return {"success": True, "message": "Logged out successfully"}
```

There is also `DELETE /api/cookies` (line 602) which does the same cookie cleanup,
and `POST /api/gemini/disconnect` (line 1116) which is an alias.

**None of these are called during logout.** The frontend only calls the external auth
service's `/auth/logout`, which knows nothing about Gemini cookies.

---

## 3. Why This Is a Problem

- After logout, the user's Gemini cookies (`__Secure-1PSID`, `__Secure-1PSIDTS`) remain
  encrypted in the Postgres `user_cookies` table.
- The next person who logs in to the same account (or if the JWT is somehow reused
  before expiry) would still have an active Gemini session — they could chat without
  needing to reconnect.
- For a shared or multi-user deployment this is a security concern: a user's Gemini
  identity is not cleaned up when they log out.
- The backend developer already anticipated this and built `POST /api/user/logout`
  for exactly this purpose — it just was never wired up in the frontend.

---

## 4. The Two Calls vs One Call Problem

There are currently TWO places that call `postLogout`:

| Where | File | Line | Effect |
|---|---|---|---|
| `handleLogout` in SidebarFooter | `SidebarFooter.tsx` | 37 | calls `postLogout(token)` — external auth only |
| `logout()` in AuthContext | `AuthContext.tsx` | 61 | calls `postLogout(token)` again — external auth only |

This means the external auth logout is fired twice (harmless but wasteful).
The `webai-bridge` cookie deletion is called zero times.

---

## 5. All Available Backend Endpoints for Cookie Cleanup

All three exist in `webai-bridge/main.py` and all call `delete_cookies(user_id)`:

| Endpoint | Method | Does what |
|---|---|---|
| `/api/user/logout` | POST | Delete cookies + tear down in-memory Gemini client. Designed for logout. |
| `/api/cookies` | DELETE | Same as above. Designed for "disconnect Gemini" button. |
| `/api/gemini/disconnect` | POST | Same as above. Semantic alias. |

The right one to call on logout is **`POST /api/user/logout`** — it was purpose-built
for this use case and its name makes the intent clear.

---

## 6. What the Fix Looks Like (no changes made yet)

### Step 1 — Add `deleteCookies` (or `bridgeLogout`) to `api.ts`

A new function that calls the bridge's logout endpoint:

```ts
export async function bridgeLogout(token: string): Promise<void> {
  await fetch(`${BASE}/api/user/logout`, {   // BASE = webai-bridge (localhost:8001)
    method: "POST",
    headers: authHeaders(token),
  });
}
```

### Step 2 — Call it during logout, before clearing the token

The token must be sent **before** it is removed from state, because the backend
uses it to identify which user's cookies to delete.

The correct place is `AuthContext.tsx` `logout()`, since it holds the token:

```ts
async function logout() {
  if (token) {
    await Promise.allSettled([
      postLogout(token),       // external auth provider logout (existing)
      bridgeLogout(token),     // webai-bridge: delete Gemini cookies (new)
    ])
  }
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_email')
  setToken(null)
  setUser(null)
  setIsAdmin(null)
}
```

`Promise.allSettled` is used so that even if one call fails, the other still runs
and the local logout (clearing localStorage + state) always completes.

### Step 3 — Remove the duplicate `postLogout` call from `SidebarFooter.tsx`

`SidebarFooter.tsx` line 37 also calls `postLogout` — this becomes redundant once
`AuthContext.logout()` handles both calls. Remove it:

```ts
async function handleLogout() {
  setDropdownOpen(false);
  // remove: if (token) void postLogout(token).catch(() => {});
  resetForLogout();
  await logout();      // logout() now handles all backend calls
  navigate("/login");
}
```

This also means `logout()` needs to become `async` in `AuthContext`.

---

## 7. Summary Table

| Thing | Current state | After fix |
|---|---|---|
| External auth logout (`EXT_BASE/auth/logout`) | Called (twice) | Called once (from AuthContext) |
| Gemini cookies deleted on logout (`/api/user/logout`) | Not called | Called from AuthContext |
| `postLogout` called in SidebarFooter | Yes (redundant) | Removed |
| `logout()` is async | No | Yes (needed to await bridge call) |

---

## 8. Files That Will Need to Change

1. `web2api-ui/src/services/api.ts` — add `bridgeLogout` function
2. `web2api-ui/src/context/AuthContext.tsx` — call `bridgeLogout` in `logout()`, make it async
3. `web2api-ui/src/components/layout/SidebarFooter.tsx` — remove redundant `postLogout`, await `logout()`

No backend changes needed. The endpoint already exists.

---

Read this file, confirm the plan, and I will make the changes.
