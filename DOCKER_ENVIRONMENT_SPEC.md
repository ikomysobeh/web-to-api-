# Docker Environment Specification
> Give this file to the AI that will write the Docker files.
> It contains everything needed to understand the project and build the full Docker environment.

---

## What You Are Dockerizing

This project has **4 services** that must all run together. A developer should clone the repo, run one command, and everything starts. No Python, no Node, no PostgreSQL installation required on their machine.

The one command to start everything:
```bash
docker compose up --build
```

The one command to stop everything:
```bash
docker compose down
```

---

## The 4 Services

| Service Name | What it is | Language/Runtime | Internal Port | Exposed Port |
|---|---|---|---|---|
| `webai` | WebAI-to-API — connects to Gemini | Python 3.11, uses Poetry | 6969 | 6969 |
| `bridge` | webai-bridge — our main API | Python 3.11, uses pip + venv | 8000 | 8000 |
| `db` | PostgreSQL database | PostgreSQL 16 | 5432 | 5432 |
| `frontend` | React app | Node 20 | 3000 | 3000 |

> Note: The `frontend` service is optional for v1. Include it but note it can be disabled with a profile if not needed.

---

## Folder Structure That Exists Right Now

```
projects/                          ← root folder (this is what gets cloned)
├── WebAI-to-API/                  ← third-party project, modified by us
│   ├── src/
│   │   └── app/
│   │       ├── main.py
│   │       ├── endpoints/
│   │       │   ├── system.py      ← we added this file
│   │       │   └── chat.py        ← we modified this
│   │       └── services/
│   │           ├── gemini_client_manager.py   ← we added this
│   │           └── providers/
│   │               └── gemini/
│   │                   └── webapi_adapter.py  ← we modified this
│   ├── config.conf.example        ← template, must be copied to config.conf
│   ├── config.conf                ← DO NOT COMMIT — generated at runtime
│   ├── pyproject.toml             ← Poetry dependency file
│   ├── poetry.lock
│   └── .env                       ← DO NOT COMMIT — contains WEBAI_INTERNAL_KEY
│
├── webai-bridge/                  ← our custom bridge project
│   ├── main.py                    ← FastAPI app — all routes
│   ├── database.py                ← PostgreSQL connection + table creation
│   ├── models.py                  ← User and UserGeminiCookie dataclasses
│   ├── auth.py                    ← JWT + bcrypt auth
│   ├── services/
│   │   ├── __init__.py
│   │   └── cookie_service.py      ← encrypt/decrypt + DB read/write
│   ├── requirements.txt           ← pip packages
│   └── .env                       ← DO NOT COMMIT — contains secrets
│
├── frontend/                      ← React app (create-react-app or Vite)
│   ├── src/
│   ├── package.json
│   └── .env                       ← REACT_APP_API_URL
│
└── docker-compose.yml             ← YOU CREATE THIS (root level)
```

---

## Files to Create

You need to create these files:

```
projects/
├── docker-compose.yml             ← main orchestration file
├── .env.example                   ← template for secrets (committed to git)
├── .env                           ← actual secrets (NOT committed)
├── WebAI-to-API/
│   └── Dockerfile                 ← builds the webai service
├── webai-bridge/
│   └── Dockerfile                 ← builds the bridge service
└── frontend/
    └── Dockerfile                 ← builds the React frontend
```

---

## Detailed Requirements Per Service

---

### Service 1: `db` (PostgreSQL)

**Use the official image — no custom Dockerfile needed.**

Requirements:
- Image: `postgres:16-alpine` (alpine = smaller image)
- Database name: `webai_bridge`
- Username and password: read from environment variables
- Data must persist between restarts using a Docker volume
- Health check so other services wait for it to be ready before starting
- The `bridge` service must not start until `db` passes its health check

Environment variables it needs:
```
POSTGRES_DB=webai_bridge
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
```

Volume: `postgres_data` → mounted at `/var/lib/postgresql/data`

---

### Service 2: `webai` (WebAI-to-API)

**Needs a custom Dockerfile.**

Important facts about this project:
- Uses **Poetry** for dependency management (not pip)
- Entry point: `python src/run.py`
- Runs on port **6969**
- Needs a `config.conf` file to exist — copy from `config.conf.example` if not present
- The `config.conf` file will be written at runtime by the bridge (cookies are injected into it)
- So `config.conf` must be writable from inside the container
- Uses `pyproject.toml` and `poetry.lock` for dependencies

**Dockerfile requirements for `webai`:**
```
Base image: python:3.11-slim
Install: curl (needed by some Gemini dependencies)
Install Poetry: pip install poetry
Set Poetry to NOT create a virtual environment inside Docker (use system Python instead):
  ENV POETRY_VENV_IN_PROJECT=false
  ENV POETRY_NO_INTERACTION=1
Copy pyproject.toml and poetry.lock first (Docker layer caching)
Run: poetry install --no-dev
Copy the rest of the source code
Create config.conf from config.conf.example if config.conf doesn't exist
Expose port 6969
CMD: poetry run python src/run.py
```

Environment variables it needs (from `.env` or docker-compose):
```
WEBAI_INTERNAL_KEY=${WEBAI_INTERNAL_KEY}
```

**Important — `config.conf` in Docker:**
The bridge writes cookies into `config.conf` inside the `webai` container. For this to work, `config.conf` inside the `webai` container must be on a **shared volume** that the `bridge` container can also write to.

Create a shared volume called `webai_config` mounted at `/app` in the `webai` container and also mounted (read-write) in the `bridge` container. The bridge's `WEBAI_CONFIG_PATH` env var should point to the path of this shared file.

Alternatively — and this is the **better approach** — the bridge does NOT write to `config.conf` directly. Instead, it calls the `/internal/gemini/create` endpoint which is the multi-user approach. In that case, no shared volume is needed for config.conf. Use this approach.

So: **no shared volume needed**. Each container is independent. The bridge calls WebAI-to-API via HTTP only.

**Networking:**
- Bridge reaches WebAI-to-API via Docker service name: `http://webai:6969`
- NOT `http://localhost:6969` (localhost doesn't work between containers)

---

### Service 3: `bridge` (webai-bridge)

**Needs a custom Dockerfile.**

Important facts:
- Uses **pip** and `requirements.txt`
- Entry point: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Runs on port **8000**
- Must wait for `db` to be healthy before starting
- Connects to PostgreSQL using `DATABASE_URL`
- Connects to WebAI-to-API using `WEBAI_URL`
- On startup, runs `init_db()` to create tables (already coded in `database.py`)

**Dockerfile requirements for `bridge`:**
```
Base image: python:3.11-slim
Copy requirements.txt first (Docker layer caching)
Run: pip install --no-cache-dir -r requirements.txt
Copy the rest of the source code
Expose port 8000
CMD: uvicorn main:app --host 0.0.0.0 --port 8000
```

> Do NOT use `--reload` in Docker. That is for development only.

Environment variables it needs:
```
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/webai_bridge
WEBAI_URL=http://webai:6969
WEBAI_INTERNAL_KEY=${WEBAI_INTERNAL_KEY}
SECRET_KEY=${SECRET_KEY}
COOKIE_ENCRYPTION_KEY=${COOKIE_ENCRYPTION_KEY}
APP_PORT=8000
```

Notice: `@db:5432` — `db` is the Docker service name, not `localhost`.

**depends_on:**
- `db` with condition `service_healthy`
- `webai` with condition `service_started`

---

### Service 4: `frontend` (React)

**Needs a custom Dockerfile. Use multi-stage build.**

Important facts:
- Standard React app (create-react-app or Vite)
- Runs on port **3000**
- In development: use `npm start` or `vite`
- The API URL must point to the bridge: `http://localhost:8000`
  - But note: React runs in the **browser**, not in Docker. So the API URL is `localhost:8000` (the host machine's exposed port), NOT `http://bridge:8000` (which only works inside Docker network)
  - Use `REACT_APP_API_URL=http://localhost:8000` for create-react-app
  - Use `VITE_API_URL=http://localhost:8000` for Vite

**Dockerfile requirements for `frontend`:**

Use a two-stage build:

Stage 1 — Build:
```
Base image: node:20-alpine
Copy package.json and package-lock.json first
Run: npm install
Copy the rest of the source
Run: npm run build
```

Stage 2 — Serve:
```
Base image: nginx:alpine
Copy the build output from Stage 1 into nginx's html folder
Copy a custom nginx.conf (see below)
Expose port 3000
```

**nginx.conf for React router (client-side routing):**
```nginx
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    # This makes React Router work — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> Alternative for development: skip the build step and just run `npm start` with hot reload. Consider adding a `docker-compose.override.yml` for dev mode.

---

## docker-compose.yml Requirements

### Network
Create one shared network called `webai_network` with driver `bridge`. All 4 services join it.

### Volumes
```yaml
volumes:
  postgres_data:    # PostgreSQL data persistence
```

### Service dependency order
```
db (starts first, has health check)
  ↓
webai (starts after db is healthy — it might need DB in future versions)
  ↓
bridge (starts after db is healthy AND webai is started)
  ↓
frontend (starts last, or in parallel — it doesn't depend on others at build time)
```

### Health checks
- `db`: Use `pg_isready -U ${DB_USER} -d webai_bridge`
- `webai`: Use `curl -f http://localhost:6969/health || exit 1`
- `bridge`: Use `curl -f http://localhost:8000/health || exit 1`
- `frontend`: No health check needed

### Restart policy
All services: `restart: unless-stopped`
This means they restart automatically if they crash, but stop when you run `docker compose down`.

---

## The `.env` File at Root Level

The `docker-compose.yml` reads from a `.env` file in the same folder.

Create `.env.example` (committed to git — safe, no real secrets):
```ini
# Copy this file to .env and fill in real values
# Run: cp .env.example .env

# PostgreSQL
DB_USER=webai_user
DB_PASSWORD=change_me_please

# Bridge secrets — generate with: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=generate_a_long_random_string_here
COOKIE_ENCRYPTION_KEY=generate_another_long_random_string_here

# Shared between bridge and webai — must be the same in both
WEBAI_INTERNAL_KEY=generate_a_third_long_random_string_here
```

The actual `.env` file is NOT committed to git. Add it to `.gitignore`.

---

## `.gitignore` at Root Level

```
.env
WebAI-to-API/.env
WebAI-to-API/config.conf
webai-bridge/.env
**/venv/
**/__pycache__/
**/*.pyc
**/node_modules/
**/dist/
**/build/
postgres_data/
```

---

## How Environment Variables Flow

```
Root .env file
    ↓
docker-compose.yml reads it
    ↓
docker-compose.yml passes specific vars to each container
    ↓
Each container's app reads from its own environment
```

The individual project `.env` files (webai-bridge/.env, WebAI-to-API/.env) are NOT used in Docker. Docker injects everything via `docker-compose.yml`. The `.env` files are only for local development without Docker.

---

## Port Mapping Summary

| Service | Container Port | Host Port | Who uses it |
|---------|---------------|-----------|-------------|
| frontend | 3000 | 3000 | Developer's browser |
| bridge | 8000 | 8000 | React app (via browser) |
| webai | 6969 | 6969 | Bridge (internal), also exposed for debugging |
| db | 5432 | 5432 | Bridge (internal), also exposed for DB tools like pgAdmin |

---

## Developer Workflow After Docker Setup

A new developer joining the team does this — nothing else:

```bash
# 1. Clone the repo
git clone https://github.com/your-org/your-repo.git
cd your-repo

# 2. Set up secrets (one time only)
cp .env.example .env
# Open .env and fill in the values
# (Or ask the team lead to send the real .env file)

# 3. Start everything
docker compose up --build

# 4. Open the app
# Frontend: http://localhost:3000
# Bridge API docs: http://localhost:8000/docs
# WebAI-to-API docs: http://localhost:6969/docs
```

To stop:
```bash
docker compose down
```

To rebuild after code changes:
```bash
docker compose up --build
```

To see logs:
```bash
docker compose logs -f              # all services
docker compose logs -f bridge       # just the bridge
docker compose logs -f webai        # just WebAI-to-API
docker compose logs -f db           # just PostgreSQL
```

To restart one service:
```bash
docker compose restart bridge
```

To run a command inside a container:
```bash
docker compose exec bridge bash        # open shell in bridge
docker compose exec db psql -U webai_user -d webai_bridge   # open psql
```

---

## Important Technical Notes for the AI Writing the Docker Files

### 1. Poetry in Docker — Common Mistake
Poetry by default creates a virtual environment inside the project folder. Inside Docker, this is unnecessary and causes problems. Disable it:
```dockerfile
ENV POETRY_VIRTUALENVS_CREATE=false
ENV POETRY_NO_INTERACTION=1
```

### 2. `browser_cookie3` in Docker — Does Not Work
The `browser_cookie3` package reads cookies from the host machine's browser. Inside Docker, there is no browser. The `/api/cookies/extract` endpoint will fail in Docker. This is expected and acceptable. Users must use the **manual cookie input** (`POST /api/cookies`) when running in Docker. Document this clearly.

### 3. Database URL in Docker
The bridge uses `psycopg2` to connect to PostgreSQL. In Docker, the host is the service name `db`, not `localhost`:
```
DATABASE_URL=postgresql://webai_user:password@db:5432/webai_bridge
```

### 4. WebAI-to-API URL in Docker
The bridge calls WebAI-to-API. In Docker, the host is the service name `webai`, not `localhost`:
```
WEBAI_URL=http://webai:6969
```

### 5. React API URL
React runs in the user's **browser**, not inside Docker. So it calls `localhost:8000`, which is the host machine's port mapped from the bridge container. Do NOT use `http://bridge:8000` in React — that won't work from a browser.

### 6. Layer Caching
Always copy dependency files BEFORE copying source code, so Docker can cache the dependency layer:
```dockerfile
# GOOD — dependencies cached separately
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

# BAD — any source code change rebuilds dependencies
COPY . .
RUN pip install -r requirements.txt
```

### 7. config.conf for WebAI-to-API in Docker
WebAI-to-API needs `config.conf` to exist. In the Dockerfile, add:
```dockerfile
RUN cp config.conf.example config.conf
```
This creates it at build time. The multi-user approach (per-user Gemini clients) does NOT write to `config.conf` at runtime — it initializes clients in memory. So the file just needs to exist with valid defaults.

### 8. `--host 0.0.0.0` is Required
When running inside Docker, the server must listen on `0.0.0.0` (all interfaces), not `127.0.0.1` (localhost only). Otherwise Docker can't route traffic to it.

- Bridge: `uvicorn main:app --host 0.0.0.0 --port 8000`
- WebAI-to-API: check `src/run.py` — it should already accept `--host` argument. If not, set it there.

### 9. Non-root User (Security Best Practice)
Create a non-root user in each Dockerfile:
```dockerfile
RUN useradd -m appuser
USER appuser
```
Do this AFTER installing packages (which need root).

### 10. `.dockerignore` Files
Each project folder should have a `.dockerignore` to avoid copying unnecessary files into the image:

For `webai-bridge/.dockerignore`:
```
venv/
__pycache__/
*.pyc
.env
.git
```

For `WebAI-to-API/.dockerignore`:
```
__pycache__/
*.pyc
.env
config.conf
.git
runtime/auth/
```

For `frontend/.dockerignore`:
```
node_modules/
build/
dist/
.env
.git
```

---

## Full File List to Create

| File | Location | Notes |
|------|----------|-------|
| `docker-compose.yml` | root | Main orchestration |
| `.env.example` | root | Template — committed to git |
| `.gitignore` | root | Ignore `.env`, build files, etc. |
| `Dockerfile` | `WebAI-to-API/` | Builds the webai service |
| `.dockerignore` | `WebAI-to-API/` | Exclude venv, .env, etc. |
| `Dockerfile` | `webai-bridge/` | Builds the bridge service |
| `.dockerignore` | `webai-bridge/` | Exclude venv, .env, etc. |
| `Dockerfile` | `frontend/` | Multi-stage build for React |
| `.dockerignore` | `frontend/` | Exclude node_modules |
| `nginx.conf` | `frontend/` | Serve React with client-side routing |

Total: **10 files** to create.

---

## Validation — How to Know It Worked

After running `docker compose up --build`, verify each service:

```bash
# 1. All containers are running
docker compose ps
# All 4 should show "running" status

# 2. Database is up
docker compose exec db pg_isready -U webai_user
# Output: /var/run/postgresql:5432 - accepting connections

# 3. Bridge is up and database tables exist
curl http://localhost:8000/health
# Output: {"status": "ok", "service": "webai-bridge"}

# 4. WebAI-to-API is up
curl http://localhost:6969/health
# Any 200 response = up

# 5. Frontend is up
curl http://localhost:3000
# HTML response = up

# 6. Full auth flow works
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "password": "password123"}'
# Output: {"success": true, "token": "eyJ..."}

# 7. Tables exist in PostgreSQL
docker compose exec db psql -U webai_user -d webai_bridge -c "\dt"
# Should show: users, user_gemini_cookies
```

---

## What Does NOT Work in Docker (Document This for the Team)

| Feature | Works in Docker? | Reason | Alternative |
|---------|-----------------|--------|-------------|
| Auto-extract browser cookies (`/api/cookies/extract`) | ❌ No | No browser inside Docker | Use manual cookie input (`POST /api/cookies`) |
| Hot reload for Python | ❌ No | `--reload` disabled in Docker | Rebuild with `docker compose up --build` |
| Hot reload for React | ⚠️ Optional | Needs volume mount + dev server | Use `docker-compose.override.yml` for dev mode |
| Everything else | ✅ Yes | — | — |

---

## Summary for the AI

Build exactly these files:
1. `docker-compose.yml` at root — 4 services: db, webai, bridge, frontend
2. `WebAI-to-API/Dockerfile` — Python 3.11, Poetry, port 6969
3. `WebAI-to-API/.dockerignore`
4. `webai-bridge/Dockerfile` — Python 3.11, pip, port 8000
5. `webai-bridge/.dockerignore`
6. `frontend/Dockerfile` — Node 20 build + nginx serve, port 3000
7. `frontend/.dockerignore`
8. `frontend/nginx.conf` — serves React with client-side routing
9. `.env.example` at root
10. `.gitignore` at root

The goal: one developer runs `docker compose up --build` and all 4 services start, connected to each other, with the database initialized, ready to use.
