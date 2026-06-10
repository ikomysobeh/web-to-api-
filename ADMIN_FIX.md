# Why the Admin Panel is Not Visible — Root Causes & Fixes

You are at `http://localhost:3000/chat` and the sidebar shows no "Admin Panel" button.  
There are **3 stacked problems**, each one blocking the next. Fix them in order.

---

## Problem 1 — Frontend container is running OLD code (most critical)

### Why it happens

The frontend runs as a Docker container built from `web2api-ui/Dockerfile`.  
When you run `docker compose up` **without** `--build`, Docker reuses the cached image
that was built before all the new features (admin pages, role-aware AuthContext, Sidebar
admin button) were written.

The built JavaScript bundle inside the container is the old version — it has none of:
- The `role` field in `AuthContext`
- The Shield "Admin Panel" button in `Sidebar`
- The `/admin/*` routes in `App.tsx`
- The 7 admin pages
- The agent selector dropdown in `AppShell`

**File that proves this:** `web2api-ui/Dockerfile` line 17 — the image is frozen at
`npm run build` time. Running `docker compose up` reuses it.

### Fix

```bash
# Stop everything and rebuild all images from source
docker compose down
docker compose up --build
```

> Do NOT add `-v` here — that would wipe your database. Just `down` then `up --build`.

After this, open `http://localhost:3000` again. The new JS bundle will load.

---

## Problem 2 — Your user account has `role = 'user'`, not `'admin'`

### Why it happens

The `role` column was added to the `users` table with `DEFAULT 'user'`. Every existing
account — including `kamidan@gmail.com` — was assigned `role = 'user'` automatically.

The Sidebar's admin button is guarded by `isAdmin` which is `role === 'admin'`:

```tsx
// web2api-ui/src/components/layout/Sidebar.tsx
{isAdmin && (
  <Button onClick={() => navigate('/admin')}>
    <Shield /> Admin Panel
  </Button>
)}
```

Since `role` is `'user'`, `isAdmin` is `false`, and the button is never rendered.

**File:** `web2api-ui/src/components/layout/Sidebar.tsx` lines 133–139 (collapsed mode)
and lines 178–189 (expanded mode)

### Fix — promote your account to admin

Run this one command (replace the email if needed):

```bash
docker exec -it webai-postgres psql -U webai_user -d webai_bridge -c \
  "UPDATE users SET role='admin' WHERE email='kamidan@gmail.com';"
```

Expected output: `UPDATE 1`

If you get `UPDATE 0` your email is different — check what's in the DB:

```bash
docker exec -it webai-postgres psql -U webai_user -d webai_bridge -c \
  "SELECT id, email, role FROM users;"
```

Then repeat the UPDATE with the correct email.

---

## Problem 3 — Browser holds a stale token / cached role

### Why it happens

`AuthContext` stores the user's role in `localStorage` under the key `auth_role`.
After you promoted the account in the DB, `localStorage` still has `role: "user"` from
the last login.

**The good news:** `AuthContext` calls `GET /auth/me` on every page load (not just on
login), and `/auth/me` reads the role directly from the database:

```python
# webai-bridge/auth.py  get_current_user()
cursor.execute("SELECT id, email, role FROM users WHERE id = %s", ...)
return { "role": row["role"] }   # always fresh from DB
```

So a **hard page refresh** (Ctrl+Shift+R) is enough — no logout required.

### Fix

After the DB update: press **Ctrl+Shift+R** (hard refresh, bypasses cache) in the browser.

If that still doesn't work, clear localStorage manually:
1. Open DevTools → Application → Local Storage → `http://localhost:3000`
2. Delete `auth_role`, `auth_token`, `auth_email`
3. Reload and log in again

---

## Step-by-Step Fix Summary

```
1.  docker compose down
2.  docker compose up --build          ← rebuilds frontend with new code
3.  Wait for "Application startup complete." in the bridge logs
4.  docker exec -it webai-postgres psql -U webai_user -d webai_bridge \
      -c "UPDATE users SET role='admin' WHERE email='kamidan@gmail.com';"
5.  Open http://localhost:3000
6.  Log in (or press Ctrl+Shift+R if already logged in)
7.  The Shield "Admin Panel" button appears in the sidebar
```

---

## Bonus — VITE_API_URL is not wired correctly for Docker builds

### Why this matters (future issue)

In `docker-compose.yml` line 98:
```yaml
environment:
  VITE_API_URL: http://localhost:8000
```

This is a **runtime** environment variable. Vite bakes `VITE_*` variables at **build time**
(`npm run build`). By the time the container starts, the bundle is already compiled and
the env var is ignored.

Right now it's not broken because `api.ts` falls back to `http://127.0.0.1:8000` and your
browser and API are both on the same machine. But if you ever deploy to a server, the
frontend will try to call `127.0.0.1:8000` on the user's machine (wrong).

### Fix — pass it as a Docker build arg

**`web2api-ui/Dockerfile`** — add ARG and pass it to the build:

```dockerfile
# Stage 1: Build the React app
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install
COPY . .

# Accept the API URL as a build argument
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

**`docker-compose.yml`** — move from `environment` to `build.args`:

```yaml
frontend:
  build:
    context: ./web2api-ui
    dockerfile: Dockerfile
    args:
      VITE_API_URL: http://localhost:8000   # ← build-time arg, not runtime env
  container_name: webai-frontend
  ports:
    - "3000:3000"
  depends_on:
    - bridge
  restart: unless-stopped
  networks:
    - webai_network
```

After this change run `docker compose up --build` again.

---

## Files Involved

| File | Problem |
|---|---|
| `web2api-ui/Dockerfile` | Stale cached build — fix with `--build` flag; also fix `ARG VITE_API_URL` |
| `docker-compose.yml` | `VITE_API_URL` under `environment` (runtime) should be under `build.args` |
| `web2api-ui/src/components/layout/Sidebar.tsx` | Correct — already gates on `isAdmin`; no code change needed |
| `web2api-ui/src/context/AuthContext.tsx` | Correct — already calls `/auth/me` on load; no code change needed |
| `webai-bridge/auth.py` | Correct — `get_current_user()` reads role from DB; no code change needed |
| `webai-bridge/database.py` | Correct — `ALTER TABLE users ADD COLUMN role DEFAULT 'user'`; no code change needed |
| PostgreSQL `users` table | `kamidan@gmail.com` needs `role='admin'` — one SQL UPDATE |
