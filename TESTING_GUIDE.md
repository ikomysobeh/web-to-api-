# Testing Guide — New Features

This guide covers everything added in the implementation and how to test each feature end-to-end.

---

## What Was Added

| Feature | Where |
|---|---|
| User roles (`admin` / `user`) | Backend + Frontend |
| AI Agents with custom instructions | Backend + Frontend |
| Vector knowledge base (RAG) | Backend only |
| NATS user sync from Laravel | Backend only |
| Laravel auth delegation | Backend only |
| Admin panel (7 pages) | Frontend |

---

## 1. Prerequisites — Start the Stack

### Step 1: Fill in `.env`

Open the `.env` file in the project root and fill in the missing values:

```env
# Required for document upload / vector search
GEMINI_API_KEY=your_key_here

# Only needed if you use Laravel auth (leave blank to use local accounts)
LARAVEL_AUTH_URL=

# Only needed if your NATS server requires a token (leave blank otherwise)
NATS_TOKEN=
```

> If you don't have a `GEMINI_API_KEY` yet, you can still test everything **except** document upload. Get one free at https://aistudio.google.com/apikey

### Step 2: Build and start

```bash
docker compose down -v   # wipe old db to apply schema changes
docker compose up --build
```

> **Why `-v`?** The database image changed from `postgres:16-alpine` to `pgvector/pgvector:pg16`. The old volume won't work with the new image, so it must be wiped once.

Wait until you see:
```
webai-bridge-1  | INFO:     Application startup complete.
```

### Step 3: Verify services are up

```
GET http://localhost:8000/health
→ { "status": "ok", "service": "webai-bridge" }

GET http://localhost:8000/health/nats
→ { "nats": "connected" }   ← only if NATS_URL is reachable
```

---

## 2. Create an Admin User

The first user you register is a regular `user`. You need to manually promote one account to `admin` in the database.

### Option A — via `docker exec` (quickest)

```bash
docker exec -it $(docker ps -qf "name=db") psql -U postgres -d webai_bridge -c \
  "UPDATE users SET role='admin' WHERE email='your@email.com';"
```

### Option B — via Postman

1. Register/login normally — get your token
2. Check your user ID: `GET /auth/me`
3. Connect to the database and run the UPDATE above

> After promotion, **log out and log back in** so the new token carries `role: "admin"`.

---

## 3. Verify the Frontend Shows the Admin Panel

1. Open `http://localhost:5173` (or wherever Vite runs)
2. Log in with the admin account
3. Look at the left sidebar — you should see a **"Admin Panel"** button with a shield icon (violet colour)
4. If the sidebar is collapsed, the shield icon is still there (hover shows tooltip "Admin Panel")

**Not seeing it?** Open DevTools → Application → Local Storage → check that `role` is `"admin"`. If it's missing, log out and log back in.

---

## 4. Admin Panel — Page by Page

Navigate to each page from the Admin Panel button in the sidebar.

### 4.1 Dashboard (`/admin`)

Shows three stat cards:
- **Agents** — total agent count
- **Users** — total user count
- **NATS** — green "connected" / red "disconnected" badge

Nothing to configure here — just a status overview.

---

### 4.2 Agents List (`/admin/agents`)

Lists all agents with Edit / Documents / Assign / Deactivate buttons.

**To create your first agent:**
1. Click **New Agent** (top right)
2. Fill in the form:
   - **Name**: `Support Bot`
   - **Description**: `Answers questions about our product`
   - **Model**: leave as default
   - **Instructions**: paste a system prompt, e.g.:
     ```
     You are a helpful customer support agent for Acme Corp.
     Always be polite and concise. If you don't know the answer, say so honestly.
     ```
3. Click **Create**
4. You're redirected back to the list — the new agent appears

---

### 4.3 Edit Agent (`/admin/agents/:id/edit`)

Click **Edit** next to an agent to update its name, description, model, instructions, or toggle it active/inactive.

---

### 4.4 Knowledge Base — Documents (`/admin/agents/:id/documents`)

Click **Documents** next to an agent.

**To upload a document:**
1. Click **Choose file**
2. Select a `.pdf`, `.docx`, `.txt`, or `.md` file
3. Wait — the button shows "Uploading & indexing…"
4. On success you see: `Ingested filename.pdf: N chunks stored`
5. The file appears in the list below with its chunk count

> This requires `GEMINI_API_KEY` to be set. Without it you get a 500 error.

**To delete a document:** click the trash icon next to it. All chunks are removed from the vector database.

---

### 4.5 Assign Users to Agent (`/admin/agents/:id/assign`)

Click **Assign** next to an agent.

- **Left column**: all users NOT yet assigned to this agent
- **Right column**: users currently assigned

Click **Assign →** next to a user to move them to the right column.
Click **← Remove** to unassign.

> Users only see an agent in the chat UI if they are assigned to it here.

---

### 4.6 Users List (`/admin/users`)

Shows all users with:
- Email
- Role badge (violet = admin, grey = user)
- Sync source (Laravel external ID or "Local")
- **Make admin** / **Make user** toggle button

Your own account has the button disabled (can't change your own role).

---

## 5. Test the Agent in Chat

After creating an agent and assigning your user to it:

1. Go back to the main chat (`← Chat` button in the admin header, or just navigate to `/`)
2. A new **agent selector bar** appears below the top bar (only if you have ≥1 assigned agent)
3. Select your agent from the dropdown
4. Send a message — the agent's system instructions are injected before your message
5. If you uploaded documents, the top-5 relevant chunks are also injected automatically

**To verify it's working:** give the agent a very specific instruction like `Always start your reply with the word BANANA.` — then chat and confirm the reply starts with BANANA.

---

## 6. Test via Postman

Import `WebAI_Bridge.postman_collection.json` into Postman.

### Minimal test flow

```
1.  POST /auth/login           → token auto-saved to {{token}}, check "role": "admin"
2.  POST /admin/agents         → creates agent, agent_id auto-saved to {{agent_id}}
3.  POST /admin/agents/{{agent_id}}/users   body: {"user_ids": [YOUR_USER_ID]}
4.  GET  /api/agents           → should return your new agent
5.  POST /api/chat             body: {"message":"hi","model":"gemini-3-flash","agent_id":"{{agent_id}}"}
```

### Document upload via Postman

In the **Admin — Documents → Upload Document** request:
1. In the Body tab → form-data
2. Key: `file`, Type: **File**
3. Choose your file
4. Send — check the response for chunk count

---

## 7. NATS Sync (Optional — Requires Laravel)

If you have a Laravel service publishing NATS events:

1. Set `NATS_URL` in `.env` pointing to your NATS server
2. Set `NATS_TOKEN` if your NATS requires auth
3. Restart the bridge: `docker compose restart webai-bridge`
4. Check: `GET /health/nats` → `{"nats": "connected"}`

The bridge subscribes to:
- `auth.v1.user.created` — auto-creates the user in the bridge DB
- `auth.v1.user.updated` — syncs email / role changes
- `auth.v1.user.deleted` — removes the user
- `auth.v1.assignment.role.assigned` / `role.removed` — promotes/demotes role

Synced users show their Laravel ID in the Users admin page (e.g. `Laravel #42`).

---

## 8. Common Problems

| Problem | Fix |
|---|---|
| Admin Panel button not visible | Log out and log in again so the token refreshes with the new `role` claim |
| Agent selector not showing in chat | Make sure the agent is active (`is_active=true`) and you are assigned to it |
| Document upload returns 500 | `GEMINI_API_KEY` is missing or invalid in `.env` |
| `docker compose up` fails on DB | Run `docker compose down -v` first to wipe the old postgres volume |
| NATS shows "disconnected" | Normal if you're not running NATS — chat still works without it |
| `/admin` redirects me away | Your token has `role: "user"`, not `"admin"` — see Section 2 to promote |

---

## 9. Quick Reference — New Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health/nats` | None | NATS connection status |
| GET | `/api/agents` | User | My assigned agents |
| GET | `/api/agents/:id` | User | One agent (public info) |
| GET | `/admin/agents` | Admin | All agents |
| POST | `/admin/agents` | Admin | Create agent |
| GET | `/admin/agents/:id` | Admin | Agent full detail |
| PUT | `/admin/agents/:id` | Admin | Update agent |
| DELETE | `/admin/agents/:id` | Admin | Deactivate agent |
| POST | `/admin/agents/:id/documents` | Admin | Upload document (multipart) |
| GET | `/admin/agents/:id/documents` | Admin | List documents |
| DELETE | `/admin/agents/:id/documents/:filename` | Admin | Delete document |
| GET | `/admin/agents/:id/users` | Admin | List assigned users |
| POST | `/admin/agents/:id/users` | Admin | Assign users |
| DELETE | `/admin/agents/:id/users/:uid` | Admin | Remove user |
| GET | `/admin/users` | Admin | List all users |
| PUT | `/admin/users/:id/role` | Admin | Change user role |
