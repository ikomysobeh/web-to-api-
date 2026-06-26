# VPS Deployment Guide — Hostinger + Docker

---

## What You Have (Local Right Now)

```
Your Windows PC
├── pizzasys (Laravel)          → localhost:8001
├── webai-bridge (FastAPI)      → Docker → localhost:8000
├── web2api-ui (React/Nginx)    → Docker → localhost:3000
├── PostgreSQL                  → Docker → localhost:5432
├── NATS                        → Docker → localhost:4222
└── Ollama                      → Windows host → localhost:11434
```

## What You Want on VPS

```
Hostinger VPS (Ubuntu)
├── webai-bridge (FastAPI)      → Docker → port 8000
├── web2api-ui (React/Nginx)    → Docker → port 80 / 443
├── PostgreSQL                  → Docker → internal only
├── NATS                        → Docker → port 4222 (exposed for pizzasys)
├── Ollama                      → VPS host → port 11434
└── Nginx (reverse proxy)       → handles domain + SSL
         ↕  (internet)
pizzasys (wherever it lives)    → connects to VPS NATS on port 4222
```

---

## Step 1 — Choose Your VPS Plan on Hostinger

**Minimum specs for this project:**

| Component | RAM needed |
|-----------|-----------|
| webai-bridge | ~200 MB |
| PostgreSQL | ~300 MB |
| NATS | ~50 MB |
| Nginx | ~50 MB |
| **Ollama (nomic-embed-text)** | **~800 MB** |
| OS + overhead | ~500 MB |
| **Total minimum** | **~2 GB** |

**Recommendation: KVM 2 plan (2 GB RAM, 2 vCPU) — ~$7-10/month**

If you plan to run AI inference (chat) on the VPS too, get 4 GB+.

---

## Step 2 — First Login to Your VPS

Hostinger gives you SSH access. Open your terminal:

```bash
ssh root@YOUR_VPS_IP
```

Update the system first:

```bash
apt update && apt upgrade -y
```

---

## Step 3 — Install Docker + Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Start Docker and enable on boot
systemctl start docker
systemctl enable docker

# Verify
docker --version
docker compose version
```

---

## Step 4 — Install Ollama on the VPS

Ollama runs on the VPS host (NOT inside Docker), same as your Windows setup.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service (runs on boot automatically)
systemctl enable ollama
systemctl start ollama

# Pull the embedding model
ollama pull nomic-embed-text

# Verify it works
ollama list
```

**Important:** On the VPS, Ollama is accessed differently than Windows.
Inside Docker containers, the bridge reaches the host via `host-gateway`.
This works the same on Linux — no changes needed to `docker-compose.yml`.

---

## Step 5 — Upload Your Project to the VPS

**Option A: Using Git (recommended)**

```bash
# On VPS
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/webai
cd /opt/webai
```

**Option B: Using SCP from your Windows machine**

```powershell
# Run in PowerShell on your Windows machine
scp -r "C:\New folder" root@YOUR_VPS_IP:/opt/webai
```

---

## Step 6 — Create the Production .env File

On the VPS, create `/opt/webai/.env`:

```bash
nano /opt/webai/.env
```

Paste this and fill in your values:

```env
# ── Database ──────────────────────────────────────────────────────────
DB_USER=webai_user
DB_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
DB_NAME=webai_bridge

# ── Auth (pizzasys) ───────────────────────────────────────────────────
AUTH_SERVER_CALL_TOKEN=your_pizzasys_service_client_token_here

# ── NATS ─────────────────────────────────────────────────────────────
NATS_TOKEN=your_nats_token_here

# ── Frontend URLs ─────────────────────────────────────────────────────
# The URL your users will visit
VITE_API_URL=https://yourdomain.com
# The URL of pizzasys (wherever it lives)
VITE_AUTH_URL=https://your-pizzasys-domain.com

# ── Ollama ────────────────────────────────────────────────────────────
OLLAMA_URL=http://host-gateway:11434
OLLAMA_MODEL=nomic-embed-text
```

---

## Step 7 — Update docker-compose.yml for Production

Your current `docker-compose.yml` has `host-gateway` which works on Linux too.
But you need to add one thing — expose NATS port so pizzasys can connect:

Open `docker-compose.yml` and find the NATS service, make sure it has:

```yaml
nats:
  ports:
    - "4222:4222"    # ← pizzasys connects here from outside
```

Also update the frontend build args to use your real domain:

```yaml
frontend:
  build:
    args:
      VITE_API_URL: https://yourdomain.com
      VITE_AUTH_URL: https://your-pizzasys-domain.com
```

---

## Step 8 — Build and Start Everything

```bash
cd /opt/webai

# Build and start all containers
docker compose up -d --build

# Check everything is running
docker compose ps

# Watch logs
docker compose logs -f webai-bridge
```

Expected output:
```
webai-bridge    running   0.0.0.0:8000->8000/tcp
newfolder-frontend-1  running   0.0.0.0:3000->80/tcp
webai-postgres  running
webai-nats      running   0.0.0.0:4222->4222/tcp
```

---

## Step 9 — Set Up Nginx as Reverse Proxy (Domain + SSL)

This makes your app available at `https://yourdomain.com` instead of `http://IP:3000`.

```bash
# Install Nginx and Certbot (SSL)
apt install nginx certbot python3-certbot-nginx -y
```

Create the site config:

```bash
nano /etc/nginx/sites-available/webai
```

Paste this (replace `yourdomain.com`):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend (React app)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }

    location /admin/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /auth/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable it and get SSL:

```bash
# Enable site
ln -s /etc/nginx/sites-available/webai /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Get free SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Certbot auto-renews — verify it works
certbot renew --dry-run
```

After this your app is at `https://yourdomain.com` with automatic SSL.

---

## Step 10 — Firewall Rules

Allow only what needs to be open:

```bash
ufw allow OpenSSH        # SSH — never block this
ufw allow 80             # HTTP (Nginx)
ufw allow 443            # HTTPS (Nginx + SSL)
ufw allow 4222           # NATS — for pizzasys to connect
ufw enable
ufw status
```

**Do NOT expose:**
- Port 8000 (bridge) — goes through Nginx
- Port 3000 (frontend) — goes through Nginx
- Port 5432 (PostgreSQL) — internal only

---

## Step 11 — Connect pizzasys to VPS NATS

This is the NATS cross-server connection. On your pizzasys server, update its `.env`:

```env
# Old (local)
NATS_URL=nats://localhost:4222

# New (point to VPS)
NATS_URL=nats://YOUR_VPS_IP:4222
NATS_TOKEN=your_nats_token_here   # same token as VPS
```

The NATS token must match on both sides:
- VPS `docker-compose.yml` NATS command: `--auth your_nats_token_here`
- pizzasys `.env`: `NATS_TOKEN=your_nats_token_here`
- webai-bridge `.env`: `NATS_TOKEN=your_nats_token_here`

**Test the connection from pizzasys server:**

```bash
# Install nats CLI tool to test
curl -sf https://binaries.nats.dev/nats-io/natscli/nats! | sh

# Test connection
nats --server nats://YOUR_VPS_IP:4222 --user '' --password your_nats_token_here server ping
```

---

## Step 12 — Update pizzasys AUTH_SERVER Settings

pizzasys needs to know where the bridge is now. Update pizzasys `.env`:

```env
# Old (local bridge)
WEBAI_BRIDGE_URL=http://localhost:8000

# New (VPS bridge — through nginx)  
WEBAI_BRIDGE_URL=https://yourdomain.com
```

And the bridge's `AUTH_SERVER_BASE_URL` needs to point to wherever pizzasys lives:

In VPS `/opt/webai/.env`:
```env
AUTH_SERVER_BASE_URL=https://your-pizzasys-domain.com
```

---

## Quick Checklist Before Going Live

```
VPS
  ✓ Ubuntu updated
  ✓ Docker installed
  ✓ Ollama installed + nomic-embed-text pulled
  ✓ Project uploaded
  ✓ .env file created with real values
  ✓ docker compose up -d --build (all containers running)
  ✓ Nginx configured + SSL certificate issued
  ✓ Firewall: 80, 443, 4222, 22 open

DNS
  ✓ yourdomain.com A record → VPS IP address
  ✓ www.yourdomain.com A record → VPS IP address

NATS
  ✓ Port 4222 open on VPS firewall
  ✓ pizzasys NATS_URL updated to VPS IP
  ✓ NATS tokens match on both sides

pizzasys
  ✓ AUTH_SERVER_CALL_TOKEN set for webai-bridge service client
  ✓ NATS_URL pointing to VPS

Test
  ✓ Open https://yourdomain.com → frontend loads
  ✓ Login works (pizzasys auth)
  ✓ Upload a document → stored=2, failed=0 in logs
  ✓ Chat with agent → AI answers from document
  ✓ Create user in pizzasys → appears in bridge DB (NATS working)
```

---

## Useful Commands on VPS

```bash
# View live logs
docker compose logs -f webai-bridge

# Restart bridge only (after code change)
docker compose restart webai-bridge

# Rebuild everything
docker compose up -d --build

# Check Ollama is running
systemctl status ollama
ollama list

# Check disk usage
df -h

# Check RAM usage
free -h

# Check what ports are open
ss -tlnp
```

---

## Keeping Ollama Running After Reboot

On Linux, the Ollama installer automatically creates a systemd service.
Verify it's set to auto-start:

```bash
systemctl is-enabled ollama   # should say "enabled"
systemctl status ollama       # should say "active (running)"
```

If not enabled:
```bash
systemctl enable ollama
```

---

## Summary — Key Differences from Local Setup

| Thing | Local (Windows) | VPS (Linux) |
|-------|----------------|-------------|
| Ollama binding | Need `OLLAMA_HOST=0.0.0.0` manually | Auto-binds correctly via systemd service |
| Docker host access | `host-gateway` | `host-gateway` (same — works on Linux) |
| Frontend URL | `http://localhost:3000` | `https://yourdomain.com` |
| Bridge URL | `http://localhost:8000` | `https://yourdomain.com` (via nginx) |
| NATS | Local only | Exposed on port 4222 for pizzasys |
| SSL | No | Yes — free via Let's Encrypt (Certbot) |
