# Docker Missing Items and Differences

## Overview
This document lists all missing files and differences between the Docker specification (DOCKER_ENVIRONMENT_SPEC.md) and the actual project structure.

---

## Critical Differences

### 1. Frontend Folder Name Mismatch
- **Spec expects**: `frontend/`
- **Actual project**: `web2api-ui/`
- **Impact**: All Docker references to `frontend/` must be changed to `web2api-ui/`

### 2. WebAI-to-API Dockerfile Mismatch
- **Spec expects**: Python 3.11-slim with Poetry
- **Actual Dockerfile**: Uses Playwright Python image with requirements.txt
- **Current Dockerfile**:
  ```dockerfile
  FROM mcr.microsoft.com/playwright/python:v1.60.0-noble
  # Uses requirements.txt instead of Poetry
  ```
- **Impact**: The existing Dockerfile may not match the multi-user implementation requirements

### 3. Frontend Package Manager Mismatch
- **Spec expects**: npm with package-lock.json
- **Actual project**: pnpm with pnpm-lock.yaml
- **Impact**: Dockerfile must use `pnpm install` instead of `npm install`

---

## Missing Files to Create

### Root Level (c:\New folder\)
- [ ] `docker-compose.yml` - Main orchestration file (NOT in WebAI-to-API/)
- [ ] `.env.example` - Template for environment variables
- [ ] `.gitignore` - Root level gitignore

### webai-bridge/
- [ ] `Dockerfile` - Python 3.11-slim with pip
- [ ] `.dockerignore` - Exclude venv, .env, etc.

### WebAI-to-API/
- [ ] `.dockerignore` - Exclude __pycache__, .env, config.conf, etc.
- [ ] **Consider updating** existing Dockerfile to use Poetry as per spec

### web2api-ui/ (not frontend/)
- [ ] `Dockerfile` - Multi-stage build with pnpm + nginx
- [ ] `.dockerignore` - Exclude node_modules, build, etc.
- [ ] `nginx.conf` - Nginx config for React Router

---

## Files That Exist (No Action Needed)

- ✅ `webai-bridge/requirements.txt`
- ✅ `webai-bridge/.env`
- ✅ `webai-bridge/main.py`
- ✅ `webai-bridge/database.py`
- ✅ `webai-bridge/models.py`
- ✅ `webai-bridge/auth.py`
- ✅ `webai-bridge/services/cookie_service.py`
- ✅ `WebAI-to-API/config.conf.example`
- ✅ `WebAI-to-API/.env`
- ✅ `WebAI-to-API/Dockerfile` (but may need updating)
- ✅ `WebAI-to-API/docker-compose.yml` (but this is for WebAI-to-API only, not the full project)
- ✅ `web2api-ui/package.json`
- ✅ `web2api-ui/vite.config.ts`
- ✅ `web2api-ui/` (full React + TypeScript + Vite project)

---

## Required Actions

### Priority 1: Create Root Level Files
1. Create `docker-compose.yml` at root level with all 4 services
2. Create `.env.example` at root level with all required environment variables
3. Create `.gitignore` at root level

### Priority 2: Create Dockerfiles
1. Create `webai-bridge/Dockerfile`
2. Create `web2api-ui/Dockerfile` (adjust for pnpm instead of npm)
3. Create `web2api-ui/nginx.conf`

### Priority 3: Create .dockerignore Files
1. Create `webai-bridge/.dockerignore`
2. Create `WebAI-to-API/.dockerignore`
3. Create `web2api-ui/.dockerignore`

### Priority 4: Decide on WebAI-to-API Dockerfile
**Option A**: Use existing Playwright-based Dockerfile
- Pros: Already exists, includes Playwright dependencies
- Cons: Not following the spec, uses requirements.txt instead of Poetry

**Option B**: Update to match spec (Poetry-based)
- Pros: Follows the spec, uses Poetry for dependency management
- Cons: Need to rewrite the Dockerfile, may lose Playwright features

**Recommendation**: Check if Playwright is needed for the project. If not, update to Poetry-based Dockerfile as per spec.

---

## Environment Variables to Document

The root `.env.example` should include:

```ini
# PostgreSQL
DB_USER=webai_user
DB_PASSWORD=change_me_please

# Bridge secrets
SECRET_KEY=generate_a_long_random_string_here
COOKIE_ENCRYPTION_KEY=generate_another_long_random_string_here

# Shared between bridge and webai
WEBAI_INTERNAL_KEY=generate_a_third_long_random_string_here
```

---

## Docker Compose Structure

The root `docker-compose.yml` should have:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: webai_bridge
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck: ...

  webai:
    build: ./WebAI-to-API
    ports:
      - "6969:6969"
    environment:
      WEBAI_INTERNAL_KEY: ${WEBAI_INTERNAL_KEY}
    depends_on:
      db:
        condition: service_healthy

  bridge:
    build: ./webai-bridge
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/webai_bridge
      WEBAI_URL: http://webai:6969
      WEBAI_INTERNAL_KEY: ${WEBAI_INTERNAL_KEY}
      SECRET_KEY: ${SECRET_KEY}
      COOKIE_ENCRYPTION_KEY: ${COOKIE_ENCRYPTION_KEY}
    depends_on:
      db:
        condition: service_healthy
      webai:
        condition: service_started

  frontend:
    build: ./web2api-ui
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:8000

volumes:
  postgres_data:
```

---

## Next Steps

1. Review this list and confirm the differences
2. Decide whether to update WebAI-to-API Dockerfile or keep existing
3. Create the missing files in order of priority
4. Test the full Docker setup
