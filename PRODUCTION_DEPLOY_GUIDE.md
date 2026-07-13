# Production Deployment Guide

This guide covers everything you need to deploy the full project to your VPS at `ai.lcportal.cloud`.

---

## Before You Start — What You Need

| Item | Where to get it |
|---|---|
| VPS SSH access | your server provider |
| Domain `ai.lcportal.cloud` pointing to VPS IP | your DNS panel |
| Pizzasys service client token for production | run tinker on the production pizzasys server |
| Gemini account cookies (for WebAI-to-API) | connect via the app after deploy |

---

## Step 1 — Prepare the Production `.env`

On your **local machine**, create a copy of `.env` for production.  
Open `C:\New folder\.env` and change these values:

```env
# ── Database ──────────────────────────────────────────────────────────────────
# Keep as-is — the bridge connects to the postgres container by service name
DATABASE_URL=postgresql://webai_user:STRONG_PASSWORD_HERE@db:5432/webai_bridge

# ── Secret keys — generate new ones for production ───────────────────────────
SECRET_KEY=<run: openssl rand -hex 32>
COOKIE_ENCRYPTION_KEY=<run: openssl rand -hex 32>
WEBAI_INTERNAL_KEY=<run: openssl rand -hex 32>

# ── NATS ──────────────────────────────────────────────────────────────────────
NATS_URL=nats://nats:4222
NATS_TOKEN=<your production NATS token>
NATS_AUTH_STREAM=AUTH_EVENTS
NATS_AUTH_DURABLE=WEBAI_AUTH_CONSUMER
DEV_MODE=0

# ── Auth Server (pizzasys) ────────────────────────────────────────────────────
AUTH_SERVER_BASE_URL=https://authtesting.lcportal.cloud
AUTH_SERVER_VERIFY_PATH=/api/v1/auth/token-verify
AUTH_SERVER_SERVICE_NAME=webai-bridge
AUTH_SERVER_CALL_TOKEN=<token from production pizzasys — see Step 2>

# ── Frontend URL (used by nginx/CORS) ────────────────────────────────────────
CORS_ORIGINS=https://ai.lcportal.cloud

# ── Ollama ────────────────────────────────────────────────────────────────────
OLLAMA_URL=http://host-gateway:11434
OLLAMA_MODEL=nomic-embed-text

# ── DB credentials (must match DATABASE_URL above) ───────────────────────────
DB_USER=webai_user
DB_PASSWORD=STRONG_PASSWORD_HERE
```

> **Generate secure keys on Windows:**
> ```powershell
> # Run this 3 times — once for each key
> -join ((65..90 + 97..122 + 48..57) * 10 | Get-Random -Count 64 | % {[char]$_})
> ```
> Or on the VPS: `openssl rand -hex 32`

---

## Step 2 — Create Production Service Client in Pizzasys

On the **production pizzasys server**, create a service client for `webai-bridge`:

```bash
# SSH into the pizzasys server
cd /path/to/pizzasys
php artisan tinker
```

Inside tinker:
```php
$client = \App\Models\ServiceClient::where('name', 'webai-bridge')->first();

// If not found, create it:
if (!$client) {
    $client = new \App\Models\ServiceClient();
    $client->name = 'webai-bridge';
}

$token = 'webai-prod-' . bin2hex(random_bytes(16));
$client->token_hash = hash('sha256', $token);
$client->is_active = true;
$client->expires_at = null;
$client->save();

echo "AUTH_SERVER_CALL_TOKEN=" . $token . "\n";
```

Copy that token and put it in your production `.env` as `AUTH_SERVER_CALL_TOKEN`.

---

## Step 3 — Prepare the Frontend for Production

On your **local machine**, set the production API URL in the frontend:

Open `C:\New folder\web2api-ui\.env.production` (create it if it does not exist):

```env
VITE_API_URL=https://backend.ai.lcportal.cloud
VITE_WIDGET_URL=https://ai.lcportal.cloud
```

> **Do not change `.env` or `.env.local`** — those are for local dev only.

---

## Step 4 — Push Code to the VPS

On your **local machine**, commit everything and push:

```powershell
git add .
git commit -m "prepare for production deploy"
git push origin main
```

SSH into the VPS:

```bash
ssh user@ai.lcportal.cloud
```

On the **VPS**, pull the code:

```bash
cd /opt/webai          # or wherever your project lives
git pull origin main
```

If this is the **first deploy**, clone it:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/webai
cd /opt/webai
```

---

## Step 5 — Upload the Production `.env`

The `.env` file is in `.gitignore` (it has secrets). Copy it manually:

**From your local machine:**
```powershell
scp "C:\New folder\.env" user@ai.lcportal.cloud:/opt/webai/.env
```

Or create it directly on the VPS with `nano /opt/webai/.env` and paste the contents.

---

## Step 6 — Build and Start Everything

On the **VPS**:

```bash
cd /opt/webai

# Stop old containers if running
docker compose down

# Build fresh images and start
docker compose up -d --build

# Watch the logs for errors
docker compose logs -f
```

Wait about 60 seconds, then check all containers are running:

```bash
docker compose ps
```

All services should show `Up` or `healthy`.

---

## Step 7 — Configure Nginx (Reverse Proxy)

On the VPS, create two nginx sites:

### Frontend + Widget (`ai.lcportal.cloud`)

```nginx
# /etc/nginx/sites-available/ai.lcportal.cloud
server {
    listen 80;
    server_name ai.lcportal.cloud;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ai.lcportal.cloud;

    ssl_certificate     /etc/letsencrypt/live/ai.lcportal.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.lcportal.cloud/privkey.pem;

    # Serve the React frontend (port 5173 in Docker or 80 from nginx container)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Backend API (`backend.ai.lcportal.cloud`)

```nginx
# /etc/nginx/sites-available/backend.ai.lcportal.cloud
server {
    listen 80;
    server_name backend.ai.lcportal.cloud;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name backend.ai.lcportal.cloud;

    ssl_certificate     /etc/letsencrypt/live/backend.ai.lcportal.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backend.ai.lcportal.cloud/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Required for streaming chat responses
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/ai.lcportal.cloud /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/backend.ai.lcportal.cloud /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## Step 8 — Get SSL Certificates

```bash
certbot --nginx -d ai.lcportal.cloud -d backend.ai.lcportal.cloud
```

---

## Step 9 — Verify Everything Works

Check each part in order:

```bash
# 1. Bridge health
curl https://backend.ai.lcportal.cloud/health

# 2. Auth working (should return 401, not 502/504)
curl https://backend.ai.lcportal.cloud/api/cookies/status

# 3. Frontend loads
curl -I https://ai.lcportal.cloud
```

Open `https://ai.lcportal.cloud` in the browser — you should see the login page.

---

## Step 10 — After First Login (Connect Gemini)

1. Log in with your account
2. Go to the chat page
3. Click **Connect Gemini** — the extension popup will open
4. Sign in to Gemini in the popup
5. The cookies are saved and chat will work

---

## Common Production Problems

| Problem | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Docker container not running | `docker compose ps` then `docker compose up -d` |
| `401` on all requests | `AUTH_SERVER_CALL_TOKEN` wrong | Re-run Step 2 with tinker |
| Chat streams hang | `proxy_buffering off` missing in nginx | Add it to the backend nginx config |
| Embeddings fail | Ollama not running on VPS | `systemctl start ollama` on VPS |
| NATS not syncing | Wrong stream/consumer name or `DEV_MODE=1` | Check `.env`: `DEV_MODE=0` and correct stream names |

---

## Updating the Production Server (After Code Changes)

Every time you make changes locally:

```bash
# Local machine
git add .
git commit -m "your change description"
git push origin main

# VPS
cd /opt/webai
git pull origin main
docker compose up -d --build bridge frontend   # only rebuild changed services
```

> **Never edit files directly on the VPS.** Always change locally and push.
