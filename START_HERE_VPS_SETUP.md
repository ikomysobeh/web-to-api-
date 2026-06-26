# START HERE — VPS Setup From Scratch (Hostinger)

**Your server:** Ubuntu 24.04 LTS · KVM 2 · IP `2.25.70.122` · hostname `srv1785636.hstgr.cloud`
**Goal:** get your project (frontend + bridge + WebAI-to-API + Postgres + NATS) running live on this VPS.
**Audience:** first time doing this. Every command is copy-paste. After each part there's a ✅ checkpoint so you know it worked before moving on.

> Tip: You can run all commands two ways — (A) click the **Terminal** button in the Hostinger panel (top-right of your VPS page), or (B) use PowerShell on your PC. Both are explained in Part 1. Pick one and stick with it.

---

## Part 0 — Read this first (2 minutes)

### What "deploying" means here
Your app is 5 Docker containers defined in `docker-compose.yml`:
| Container | What it is | Port |
|-----------|-----------|------|
| `frontend` | the website (React) | 3000 |
| `bridge` | the main backend API | 8000 |
| `webai` | Gemini wrapper | 6969 |
| `db` | PostgreSQL database | 5432 (internal) |
| `nats` | message broker | 4222 |

Plus **Ollama** (for embeddings) which runs directly on the VPS, not in Docker.

You will: install Docker on the VPS → put your project files there → fill in a `.env` file → run one command to start everything.

### 3 decisions to confirm with your manager BEFORE you start
1. **Domain name?** Do you have one (like `myapp.com`) pointed at this VPS? 
   - If **no** → that's fine, we'll test using the IP `http://2.25.70.122` first. You can add a domain + HTTPS later (Part 9).
2. **Where will `pizzasys` (the login/auth system) live?** Right now it runs on your laptop (`localhost:8001`). The VPS and your users' browsers **cannot reach your laptop.** For login to work in production, pizzasys must be hosted somewhere public (its own server, or this same VPS). 
   - For a **first test from your own laptop**, it can still work temporarily. For real use, pizzasys must be public. Flag this to your manager.
3. **Small code edits are required** (listed in Part 6). You'll make 1 tiny edit by hand. Nothing in your project has been changed for you.

---

## Part 1 — Connect to the VPS

### Option A — Hostinger browser terminal (easiest)
On your VPS page, click the **Terminal** button (top-right). A black terminal opens, already logged in as `root`. Done.

### Option B — PowerShell from your PC
Open PowerShell and run:
```powershell
ssh root@2.25.70.122
```
- First time, it asks "Are you sure you want to continue connecting?" → type `yes` and press Enter.
- Enter the **root password** (from the Hostinger panel → "Root password → Change" if you don't know it).

✅ **Checkpoint:** your prompt looks like `root@srv1785636:~#`. You're inside the VPS now. Every command below runs **here**, not on your PC (unless it says "on your PC").

---

## Part 2 — Update Ubuntu

```bash
apt update && apt upgrade -y
```
This may take a few minutes. If it asks any questions, accept the defaults (press Enter).

✅ **Checkpoint:** it finishes and returns you to the `root@...#` prompt.

---

## Part 3 — Install Docker + Docker Compose

```bash
# Install Docker (official one-line installer)
curl -fsSL https://get.docker.com | sh

# Make Docker start automatically on boot
systemctl enable --now docker

# Verify both are installed
docker --version
docker compose version
```

✅ **Checkpoint:** both commands print a version number (e.g. `Docker version 27.x` and `Docker Compose version v2.x`).

---

## Part 4 — Install Ollama + the embedding model

Ollama runs on the VPS itself (not in Docker), exactly like on your Windows machine.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Make it start on boot and start it now
systemctl enable --now ollama

# Download the embedding model your app uses
ollama pull nomic-embed-text

# Confirm it's there
ollama list
```

✅ **Checkpoint:** `ollama list` shows `nomic-embed-text`.

---

## Part 5 — Put your project on the VPS

Choose ONE option.

### Option A — Git (recommended)
If your project is on GitHub:
```bash
# Replace the URL with your real repo URL
git clone https://github.com/ikomysobeh/YOUR_REPO_NAME.git /opt/webai
cd /opt/webai
ls
```

### Option B — Upload from your PC with SCP
Run this **on your PC** (PowerShell), not on the VPS. Note the quotes around the path (it has a space):
```powershell
scp -r "C:\New folder\*" root@2.25.70.122:/opt/webai/
```
Then back **on the VPS**:
```bash
mkdir -p /opt/webai && cd /opt/webai && ls
```

✅ **Checkpoint:** `ls` shows `docker-compose.yml`, `webai-bridge`, `web2api-ui`, `WebAI-to-API`, `.env.example`.

> ⚠️ If `WebAI-to-API` is missing, it may be a separate repo/folder on your PC. Make sure all three app folders (`webai-bridge`, `web2api-ui`, `WebAI-to-API`) and `docker-compose.yml` are present in `/opt/webai` before continuing.

---

## Part 6 — One required code edit (do this yourself)

Your backend currently only accepts requests from `localhost`. For the deployed site to talk to the backend, add your server's frontend address to the allow-list.

Open the file:
```bash
nano /opt/webai/webai-bridge/main.py
```
Find this block (around line 80):
```python
    allow_origins=[
        "http://127.0.0.1:3000",  # frontend via Docker (IP)
        "http://localhost:3000",   # frontend via Docker (hostname)
        "http://127.0.0.1:5173",  # Vite dev server (IP)
        "http://localhost:5173",   # Vite dev server (hostname)
    ],
```
Add your VPS address as a new line inside the list:
```python
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://2.25.70.122:3000",   # <-- ADD THIS (your VPS, IP test)
        # "https://yourdomain.com",  # <-- add this later when you have a domain
    ],
```
Save and exit nano: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

✅ **Checkpoint:** the file is saved (no error shown). 

> Why this is needed: browsers block a website from calling an API on a different address unless the API explicitly allows it (this is called CORS). Your frontend (`:3000`) and backend (`:8000`) are different addresses, so the backend must list the frontend's address.

---

## Part 7 — Create the `.env` file (your secrets + settings)

First generate 4 random secrets — run this and **copy the 4 lines it prints**:
```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "COOKIE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "WEBAI_INTERNAL_KEY=$(openssl rand -hex 32)"
echo "NATS_TOKEN=$(openssl rand -hex 16)"
```

Now create the env file:
```bash
nano /opt/webai/.env
```
Paste this, then replace the 4 secret values with the ones you just generated, and fill in the DB password:
```env
# ── Database ──────────────────────────────────────────────
DB_USER=webai_user
DB_PASSWORD=PUT_A_STRONG_PASSWORD_HERE

# ── Secrets (paste the generated values) ─────────────────
SECRET_KEY=paste_generated_value
COOKIE_ENCRYPTION_KEY=paste_generated_value
WEBAI_INTERNAL_KEY=paste_generated_value

# ── NATS (token must match pizzasys later) ───────────────
NATS_TOKEN=paste_generated_value

# ── Ollama (on the VPS host) ─────────────────────────────
OLLAMA_URL=http://host-gateway:11434
OLLAMA_MODEL=nomic-embed-text

# ── Auth server (pizzasys) ───────────────────────────────
# If pizzasys is NOT public yet, leave these as-is for now.
AUTH_SERVER_BASE_URL=http://host-gateway:8001
AUTH_SERVER_CALL_TOKEN=

# ── Frontend addresses (baked into the website at build) ─
# Use the VPS IP for the first test:
VITE_API_URL=http://2.25.70.122:8000
VITE_AUTH_URL=http://2.25.70.122:8001
```
Save and exit: **Ctrl+O**, **Enter**, **Ctrl+X**.

✅ **Checkpoint:** `cat /opt/webai/.env` shows your values with no placeholder text left.

> Note: `VITE_AUTH_URL` should point at wherever pizzasys actually lives. If pizzasys isn't public yet, you can set this later — login won't work until pizzasys is reachable from the browser.

---

## Part 8 — Build and start everything

```bash
cd /opt/webai
docker compose up -d --build
```
The first build takes several minutes (it downloads images and builds your apps). When it finishes:
```bash
docker compose ps
```

✅ **Checkpoint:** you see 5 services and the important ones say `running` / `healthy`:
```
webai-postgres   running (healthy)
webai-nats       running (healthy)
webai-api        running (healthy)
webai-bridge     running (healthy)
...frontend...   running
```
If any says `restarting` or `exited`, see **Troubleshooting** at the bottom.

---

## Part 9 — Open the firewall for the first test

Hostinger has its own firewall (panel → Security → Firewall) AND Ubuntu has `ufw`. Set up `ufw`:
```bash
ufw allow OpenSSH      # NEVER skip this or you'll lock yourself out
ufw allow 3000         # frontend (temporary, for IP test)
ufw allow 8000         # backend  (temporary, for IP test)
ufw allow 4222         # NATS (so pizzasys can connect)
ufw enable             # type y when asked
ufw status
```
Also make sure these ports are allowed in the **Hostinger panel firewall** (Security → Firewall) if you have rules there.

✅ **Checkpoint:** `ufw status` lists 22/OpenSSH, 3000, 8000, 4222 as `ALLOW`.

---

## Part 10 — Test it

In your browser, go to:
```
http://2.25.70.122:3000
```

✅ **Checkpoint:** the login page loads.

Then verify the pieces:
- **Backend alive:** open `http://2.25.70.122:8000/health` → should show `{"status":"ok"}`.
- **Ollama reachable from the backend:**
  ```bash
  docker compose exec bridge curl -s http://host-gateway:11434/api/tags
  ```
  should return JSON listing `nomic-embed-text`.
- **Login:** only works once pizzasys is reachable (see Decision #2). If pizzasys is on your laptop and you're testing from that same laptop, set `VITE_AUTH_URL` to your laptop's reachable address; otherwise host pizzasys publicly.

---

## Part 11 — (LATER) Add a domain + HTTPS

Do this once you have a domain pointed at `2.25.70.122`. This gives you `https://yourdomain.com` instead of an IP with ports, and is the proper production setup.

The clean way for this project is **two subdomains** (the frontend and API are separate origins by design):
- `app.yourdomain.com` → frontend (port 3000)
- `api.yourdomain.com` → backend (port 8000)

Steps when you're ready:
1. In your DNS, add two `A` records → both point to `2.25.70.122`:
   - `app.yourdomain.com`
   - `api.yourdomain.com`
2. Install Nginx + Certbot on the VPS:
   ```bash
   apt install nginx certbot python3-certbot-nginx -y
   ```
3. Create `/etc/nginx/sites-available/webai` with two server blocks (one per subdomain) that `proxy_pass` to `http://localhost:3000` and `http://localhost:8000`. (Ask me for this config when you reach this step — I'll generate it for your exact domain.)
4. Get free SSL:
   ```bash
   certbot --nginx -d app.yourdomain.com -d api.yourdomain.com
   ```
5. Update `.env`:
   ```env
   VITE_API_URL=https://api.yourdomain.com
   VITE_AUTH_URL=https://your-pizzasys-domain.com
   ```
   and in `webai-bridge/main.py` CORS list, add `"https://app.yourdomain.com"`.
6. Rebuild and close the temporary ports:
   ```bash
   cd /opt/webai && docker compose up -d --build
   ufw delete allow 3000
   ufw delete allow 8000
   ufw allow 80
   ufw allow 443
   ```

---

## Part 12 — Connect pizzasys to the VPS NATS (when pizzasys is hosted)

On the pizzasys server, edit its `.env`:
```env
NATS_URL=nats://2.25.70.122:4222
NATS_TOKEN=the_same_NATS_TOKEN_from_your_VPS_.env
```
The `NATS_TOKEN` must be **identical** on the VPS and on pizzasys.

---

## Everyday commands (keep these handy)

```bash
cd /opt/webai

docker compose ps                      # see what's running
docker compose logs -f bridge          # watch backend logs (Ctrl+C to stop watching)
docker compose logs -f frontend        # watch frontend logs
docker compose restart bridge          # restart one service
docker compose up -d --build           # rebuild + restart after a code/.env change
docker compose down                    # stop everything (keeps data)
```

> Remember: after changing `VITE_API_URL`/`VITE_AUTH_URL` in `.env`, you must **rebuild** (`up -d --build`), not just restart — those are baked into the website at build time.

---

## Troubleshooting

**A container keeps restarting / exited.**
See why:
```bash
docker compose logs --tail=50 bridge      # (or db / webai / nats / frontend)
```

**"port is already allocated" / bind error.**
Something else uses that port on the VPS. Find it:
```bash
ss -tlnp | grep -E ':(3000|8000|5432|4222|6969)'
```
A fresh VPS usually has nothing on these, so this is rare here.

**The website loads but login/chat does nothing.**
Open the browser DevTools (F12) → Console/Network tab. If you see **CORS** errors → re-check Part 6 (your VPS address must be in the backend's `allow_origins`) and that you rebuilt. If you see **connection refused to 8001** → that's pizzasys not being reachable (Decision #2).

**Document upload says failed / chat with agent doesn't use documents.**
Ollama isn't reachable from the bridge. Re-run the Ollama check in Part 10 and confirm `systemctl status ollama` is `active (running)`.

**I locked myself out of SSH.**
Use the Hostinger **browser Terminal** (it doesn't need SSH) to fix `ufw`.

---

## Quick checklist

```
[ ] Part 1  Connected to VPS (root@srv1785636)
[ ] Part 2  Ubuntu updated
[ ] Part 3  Docker installed
[ ] Part 4  Ollama installed + nomic-embed-text pulled
[ ] Part 5  Project in /opt/webai (3 app folders + docker-compose.yml)
[ ] Part 6  Added VPS address to main.py CORS list
[ ] Part 7  .env created with real secrets
[ ] Part 8  docker compose up -d --build → all healthy
[ ] Part 9  Firewall: 22, 3000, 8000, 4222 allowed
[ ] Part 10 http://2.25.70.122:3000 loads + /health works
[ ] Part 11 (later) Domain + HTTPS
[ ] Part 12 (later) pizzasys connected to VPS NATS
```

When you reach Part 11 (domain) or hit any error, paste the output here and I'll walk you through it.
