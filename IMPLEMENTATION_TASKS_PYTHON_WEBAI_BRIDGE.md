# Implementation Tasks - Python WebAI Bridge

> FastAPI Bridge between React frontend and WebAI-to-API (Gemini)
> Target: Build a clean, working local bridge with stable API contracts first
> Reference: `python-bridge-guide-for-laravel-devs.md`

---

## Overview

This document defines all implementation tasks for the Python WebAI Bridge project.
You are a Laravel developer — think of this project as a slim Laravel API app, but in Python/FastAPI.

**Mental Model:**
```
React (frontend)
    ↓
webai-bridge  ← YOU BUILD THIS  (FastAPI — like your Laravel API)
    ↓
WebAI-to-API  ← YOU MODIFY THIS (add 2 endpoints)
    ↓
Gemini (Google)
```

**Laravel → Python Reminders (while you work):**
- `php artisan serve` → `uvicorn main:app --reload`
- `composer require` → `pip install`
- Form Request → Pydantic `BaseModel`
- `abort(404)` → `raise HTTPException(status_code=404)`
- `.env` → same `.env` file, read by `python-dotenv`
- `routes/api.php` → `@app.get(...)` / `@app.post(...)` decorators in `main.py`
- `app/Services/` → `services/` folder (same idea)

**Key Decisions (Locked):**
- React talks **only** to port 8000 (your bridge). Never to port 6969 directly.
- Bridge owns cookie management. WebAI-to-API only reloads when told to.
- All internal WebAI-to-API endpoints are protected by a shared `WEBAI_INTERNAL_KEY`.
- Streaming is forwarded as-is from WebAI-to-API to React (SSE passthrough).

---

## Phase 1: Project Setup & Environment

- [ ] 1.1 Create project folder
  - [ ] `mkdir webai-bridge && cd webai-bridge`
  - [ ] Think of this as `laravel new webai-bridge`

- [ ] 1.2 Create and activate virtual environment
  - [ ] `python -m venv venv`
  - [ ] Activate: `source venv/bin/activate` (Mac/Linux) or `venv\Scripts\activate` (Windows)
  - [ ] Verify `(venv)` appears in terminal prompt
  - [ ] Note: `venv/` = Laravel's `vendor/` — never commit to git

- [ ] 1.3 Install required packages
  - [ ] `pip install fastapi uvicorn httpx python-dotenv configparser browser-cookie3`
  - [ ] Save to requirements file: `pip freeze > requirements.txt`
  - [ ] Think of `requirements.txt` as `composer.json`

- [ ] 1.4 Create `.env` file
  - [ ] Add `WEBAI_URL=http://localhost:6969`
  - [ ] Add `WEBAI_INTERNAL_KEY=your-secret-key-here` (pick any strong secret string)
  - [ ] Add `APP_PORT=8000`
  - [ ] Add `WEBAI_CONFIG_PATH=../WebAI-to-API/config.conf`
  - [ ] Add `.env` to `.gitignore`

- [ ] 1.5 Create `.gitignore`
  - [ ] Ignore: `venv/`, `.env`, `__pycache__/`, `*.pyc`

**Definition of Done:** `uvicorn main:app --reload --port 8000` starts without errors (even with empty `main.py`).

---

## Phase 2: Bridge Core (`main.py`)

- [ ] 2.1 Create `main.py` — app bootstrap
  - [ ] Import FastAPI, HTTPException, Depends, Header, StreamingResponse
  - [ ] Import CORSMiddleware, BaseModel, configparser, httpx, json, os, dotenv
  - [ ] Call `load_dotenv()` at the top
  - [ ] Instantiate `app = FastAPI(title="WebAI Bridge", version="1.0")`
  - [ ] Think of this as `bootstrap/app.php` + `routes/api.php` combined

- [ ] 2.2 Add CORS middleware
  - [ ] Allow origin: `http://localhost:3000` (your React app)
  - [ ] Allow all methods and headers
  - [ ] Think of this as `config/cors.php` in Laravel

- [ ] 2.3 Load config from environment
  - [ ] Read `WEBAI_URL` with fallback to `http://localhost:6969`
  - [ ] Read `WEBAI_INTERNAL_KEY`
  - [ ] Read `WEBAI_CONFIG_PATH`

- [ ] 2.4 Create Pydantic models (= Laravel Form Requests)
  - [ ] `CookieInput`: fields `psid: str`, `psidts: str`
  - [ ] `ChatMessage`: fields `message: str`, `model: str = "gemini-3-flash"`
  - [ ] Pydantic validates types automatically on every request

- [ ] 2.5 Implement `write_cookies_to_config()` helper
  - [ ] Use `configparser.ConfigParser()`
  - [ ] **Critical:** Set `config.optionxform = str` (preserves `__Secure-1PSID` case)
  - [ ] Read existing `config.conf`, write updated `[Gemini]` section
  - [ ] Write fields: `__Secure-1PSID`, `__Secure-1PSIDTS`, `backend`, `default_model`

- [ ] 2.6 Implement `reinit_webai_client()` async helper
  - [ ] POST to `{WEBAI_URL}/internal/reinit-gemini`
  - [ ] Send header `X-Internal-Key: {WEBAI_INTERNAL_KEY}`
  - [ ] Raise `HTTPException(500)` if response is not 200
  - [ ] Think of this as calling an internal microservice

**Definition of Done:** App boots, `.env` loads, helpers defined, no import errors.

---

## Phase 3: Bridge API Endpoints (Routes)

- [ ] 3.1 `GET /health`
  - [ ] Return `{"status": "ok", "service": "webai-bridge"}`
  - [ ] This is your ping/health-check route

- [ ] 3.2 `POST /api/cookies` — manual cookie save
  - [ ] Accept `CookieInput` body (psid + psidts)
  - [ ] Validate: reject if `len(psid) < 10` or `len(psidts) < 10`
  - [ ] Call `write_cookies_to_config()`
  - [ ] Call `reinit_webai_client()`
  - [ ] Return `{"success": True, "message": "Gemini connected successfully"}`

- [ ] 3.3 `POST /api/cookies/extract` — auto-extract from browser
  - [ ] Accept `browser` query param (default: `"chrome"`)
  - [ ] Use `browser_cookie3` to read cookies from `domain_name=".google.com"`
  - [ ] Extract `__Secure-1PSID` and `__Secure-1PSIDTS`
  - [ ] If not found: return `{"success": False, "action_needed": "login"}`
  - [ ] If found: call `write_cookies_to_config()` + `reinit_webai_client()`
  - [ ] Return `{"success": True, "message": "Cookies found and applied automatically"}`
  - [ ] Wrap in try/except — gracefully return `{"action_needed": "manual"}` on failure

- [ ] 3.4 `GET /api/cookies/status` — check connection state
  - [ ] Read `config.conf` with `configparser`
  - [ ] Check if `__Secure-1PSID` is set and longer than 10 chars
  - [ ] Return `{"connected": true/false, "message": "..."}`
  - [ ] Think of this as a middleware status check

- [ ] 3.5 `POST /api/chat` — proxy chat with streaming
  - [ ] Accept `ChatMessage` body (message + model)
  - [ ] Build request body: `{model, stream: True, messages: [{role: "user", content: ...}]}`
  - [ ] Use `httpx.AsyncClient` with `timeout=120.0`
  - [ ] Stream from `{WEBAI_URL}/v1/chat/completions`
  - [ ] Yield each line as `f"{line}\n\n"` via `async for`
  - [ ] Return `StreamingResponse` with `media_type="text/event-stream"`
  - [ ] Add headers: `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`

- [ ] 3.6 `DELETE /api/cookies` — disconnect Gemini
  - [ ] Read `config.conf`, clear `__Secure-1PSID` and `__Secure-1PSIDTS` to empty string
  - [ ] Write updated config back to disk
  - [ ] Return `{"success": True, "message": "Gemini disconnected"}`

**Definition of Done:** All 5 bridge endpoints respond correctly. Health check returns 200. Swagger UI at `http://localhost:8000/docs` shows all routes.

---

## Phase 4: WebAI-to-API Changes

> You are modifying an existing third-party project here.
> Only 2 things to add: one new file + one line in their `main.py`.

- [ ] 4.1 Locate the endpoints folder
  - [ ] `cd WebAI-to-API && ls src/app/endpoints/`
  - [ ] You should see files like `gemini.py`, `chat.py`, etc.

- [ ] 4.2 Create `src/app/endpoints/system.py`
  - [ ] Import `APIRouter`, `HTTPException`, `Header`, `os`, `Optional`
  - [ ] Instantiate `router = APIRouter()`
  - [ ] Read `INTERNAL_KEY = os.getenv("WEBAI_INTERNAL_KEY", "")`

- [ ] 4.3 Implement `verify_internal_key()` dependency
  - [ ] Accept `x_internal_key` from Header
  - [ ] Raise `HTTPException(403)` if key doesn't match
  - [ ] Think of this as a Laravel middleware that checks an API key

- [ ] 4.4 Implement `POST /internal/reinit-gemini` endpoint
  - [ ] Call `verify_internal_key()`
  - [ ] Import and call `init_gemini_client()` from WebAI's existing service
  - [ ] Reload config first: `app_config.CONFIG = load_config()`
  - [ ] Return `{"success": True, "message": "Gemini client reloaded"}`
  - [ ] Raise `HTTPException(500)` if re-init fails

- [ ] 4.5 Implement `GET /internal/status` endpoint
  - [ ] Call `verify_internal_key()`
  - [ ] Import `get_gemini_client()` from WebAI's existing service
  - [ ] Return `{"status": "ready", "client_initialized": true/false}`

- [ ] 4.6 Register the new router in `src/app/main.py`
  - [ ] Add: `from app.endpoints import system`
  - [ ] Add: `app.include_router(system.router)` alongside existing routers
  - [ ] Think of this as adding a route group in `routes/api.php`

- [ ] 4.7 Add `WEBAI_INTERNAL_KEY` to WebAI-to-API's `.env`
  - [ ] Use the **exact same key** as in your bridge's `.env`
  - [ ] `WEBAI_INTERNAL_KEY=your-secret-key-here`

**Definition of Done:** WebAI-to-API starts without errors. `POST /internal/reinit-gemini` with the correct key returns 200. Without the key it returns 403.

---

## Phase 5: Integration & Manual Testing

- [ ] 5.1 Run both projects simultaneously
  - [ ] Terminal 1 (bridge): `cd webai-bridge && source venv/bin/activate && uvicorn main:app --reload --port 8000`
  - [ ] Terminal 2 (WebAI): `cd WebAI-to-API && poetry run python src/run.py`

- [ ] 5.2 Test health check
  - [ ] `curl http://localhost:8000/health` → `{"status": "ok"}`

- [ ] 5.3 Test cookie status (before connection)
  - [ ] `curl http://localhost:8000/api/cookies/status` → `{"connected": false}`

- [ ] 5.4 Test auto-extract cookies from browser
  - [ ] Make sure you are logged into `gemini.google.com` first
  - [ ] `curl -X POST "http://localhost:8000/api/cookies/extract?browser=chrome"`
  - [ ] Expect: `{"success": true}` or `{"action_needed": "login"}`

- [ ] 5.5 Test manual cookie save (fallback)
  - [ ] `curl -X POST http://localhost:8000/api/cookies -H "Content-Type: application/json" -d '{"psid": "your_psid", "psidts": "your_psidts"}'`

- [ ] 5.6 Test cookie status (after connection)
  - [ ] `curl http://localhost:8000/api/cookies/status` → `{"connected": true}`

- [ ] 5.7 Test chat streaming
  - [ ] `curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message": "Hello!", "model": "gemini-3-flash"}'`
  - [ ] Expect: SSE stream of text chunks

- [ ] 5.8 Test disconnect
  - [ ] `curl -X DELETE http://localhost:8000/api/cookies` → `{"success": true}`
  - [ ] Re-check status → `{"connected": false}`

- [ ] 5.9 Test internal security
  - [ ] Call `POST http://localhost:6969/internal/reinit-gemini` without key → expect 403
  - [ ] Call with wrong key → expect 403
  - [ ] Call with correct key → expect 200

**Definition of Done:** Full cookie → chat → disconnect flow works end to end. React can connect and stream responses.

---

## Phase 6: Error Handling & Hardening

- [ ] 6.1 Guard `write_cookies_to_config()` with try/except
  - [ ] Catch file-not-found errors (wrong `WEBAI_CONFIG_PATH`)
  - [ ] Raise `HTTPException(500, detail="Could not write config: ...")` with details

- [ ] 6.2 Guard `extract_cookies_from_browser()` fully
  - [ ] Catch all exceptions and return `{"action_needed": "manual"}` instead of crashing
  - [ ] Handle macOS keychain popup gracefully (browser_cookie3 may pause for permission)

- [ ] 6.3 Guard the chat streaming endpoint
  - [ ] If WebAI-to-API returns non-200, yield an error chunk back to React
  - [ ] Don't let upstream failures crash the stream silently

- [ ] 6.4 Validate `browser` param in extract endpoint
  - [ ] Reject unknown browser names: raise `HTTPException(400, detail="Unknown browser...")`
  - [ ] Allowed values: `chrome`, `firefox`, `brave`, `edge`, `safari`

- [ ] 6.5 Double-check `configparser` case sensitivity everywhere
  - [ ] Confirm `config.optionxform = str` is present in every place you use configparser
  - [ ] Without this, `__Secure-1PSID` becomes `__secure-1psid` and breaks WebAI

**Definition of Done:** No unhandled exceptions. All error paths return clean JSON responses with helpful messages.

---

## Phase 7: Final Verification

- [ ] 7.1 Verify Swagger UI is complete
  - [ ] Visit `http://localhost:8000/docs`
  - [ ] All 6 endpoints are visible and testable from the UI
  - [ ] FastAPI generates this automatically — no extra work needed

- [ ] 7.2 Confirm `.gitignore` covers everything
  - [ ] `venv/`, `.env`, `__pycache__/`, `*.pyc`, `*.pyo`

- [ ] 7.3 Confirm `requirements.txt` is up to date
  - [ ] `pip freeze > requirements.txt`

- [ ] 7.4 Confirm both `.env` files have the same `WEBAI_INTERNAL_KEY`
  - [ ] `webai-bridge/.env`
  - [ ] `WebAI-to-API/.env`

- [ ] 7.5 Confirm React integration contract
  - [ ] React uses only these bridge endpoints (port 8000):

  | Endpoint | Method | Purpose |
  |---|---|---|
  | `/health` | GET | Ping check |
  | `/api/cookies/status` | GET | Check Gemini connection on app load |
  | `/api/cookies/extract?browser=chrome` | POST | Auto-detect cookies from browser |
  | `/api/cookies` | POST | Manual cookie input (fallback) |
  | `/api/cookies` | DELETE | Disconnect Gemini |
  | `/api/chat` | POST | Send message, stream response |

  - [ ] React never calls port 6969 directly

**Definition of Done:** Bridge is running, tested, documented, and ready for React to integrate against.

---

## Final Definition of Done (Full Project)

All checks must pass before handover:

- [ ] `uvicorn main:app --reload --port 8000` starts cleanly
- [ ] WebAI-to-API starts cleanly alongside the bridge
- [ ] `/health` returns 200
- [ ] Cookie auto-extract works (or manual fallback works)
- [ ] `/api/cookies/status` reflects real connection state
- [ ] Chat endpoint streams a real Gemini response
- [ ] Disconnect clears the session
- [ ] Internal `/reinit-gemini` is protected by `WEBAI_INTERNAL_KEY`
- [ ] Wrong/missing key on internal endpoints returns 403
- [ ] All error paths return clean JSON (no unhandled Python stack traces)
- [ ] `requirements.txt` is committed
- [ ] `.env` is NOT committed
- [ ] Swagger UI at `/docs` shows all routes

---

## Common Errors Quick Reference

| Error | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'fastapi'` | venv not activated | `source venv/bin/activate` |
| `FileNotFoundError: config.conf` | Wrong `WEBAI_CONFIG_PATH` in `.env` | Use absolute path |
| `Connection refused` on port 6969 | WebAI-to-API not running | Start it in Terminal 2 |
| `__secure-1psid` (lowercase) in config | Missing `config.optionxform = str` | Add that line everywhere you use configparser |
| `422 Unprocessable Entity` | Pydantic validation failed | Check the error body — it tells you exactly which field |
| macOS keychain popup on extract | Chrome cookie encryption | Click Allow — this is expected |
| `403` on `/internal/reinit-gemini` | Key mismatch or missing key | Make sure both `.env` files have the same `WEBAI_INTERNAL_KEY` |

---

## Notes

- Keep all cookie logic in the bridge. WebAI-to-API should never know about cookies directly.
- Do not expose `/internal/*` endpoints publicly — they are bridge-to-WebAI only.
- For v1, one `main.py` is fine. Split into `controllers/`, `services/` only if the file gets too large.
- `browser_cookie3` only works when the backend runs on the **same machine** as the browser.
- Chat timeout is set to 120 seconds — Gemini can be slow on long responses.
