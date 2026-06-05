# Python Backend Guide for Laravel Developers
## Building the Bridge + WebAI-to-API Changes

> You know Laravel. This guide maps every Python/FastAPI concept to its Laravel equivalent.
> No Python experience assumed.

---

## Mental Model — What You're Building

```
React (frontend)
    ↓
Your Bridge API  ← YOU BUILD THIS  (Python/FastAPI — like your Laravel app)
    ↓
WebAI-to-API     ← YOU MODIFY THIS (add 2 endpoints)
    ↓
Gemini (Google)
```

Your Bridge is like a Laravel API project. WebAI-to-API is like a third-party package you're tweaking.

---

## Laravel → Python/FastAPI Cheat Sheet

| Laravel Concept | Python/FastAPI Equivalent |
|---|---|
| `composer require` | `pip install` or `poetry add` |
| `composer.json` | `pyproject.toml` or `requirements.txt` |
| `php artisan serve` | `uvicorn main:app --reload` |
| `routes/api.php` | `@app.get(...)` / `@app.post(...)` decorators |
| `App\Http\Controllers\` | Python functions or class methods |
| `Request $request` | FastAPI function parameters |
| `$request->input('key')` | Pydantic model fields or function params |
| `response()->json([...])` | `return {"key": "value"}` |
| `abort(404)` | `raise HTTPException(status_code=404, detail="...")` |
| `.env` | `.env` (same — python-dotenv reads it) |
| `config('app.key')` | `os.getenv("APP_KEY")` |
| `middleware` | FastAPI `Depends()` or middleware |
| `php artisan make:model` | Define a Python class |
| `Eloquent Model` | SQLAlchemy Model (ORM) or plain dict |
| `DB::table(...)->insert(...)` | SQLAlchemy or raw SQL |
| `return view(...)` | Not relevant (API only) |
| `php artisan migrate` | `alembic upgrade head` (or manual SQL) |
| `storage/` | Any local folder you choose |
| `app/Http/Requests/` | Pydantic `BaseModel` classes |

---

## Part 1 — Set Up Your Bridge Project

### Step 1 — Create the project folder

```bash
mkdir webai-bridge
cd webai-bridge
```

This is like `laravel new my-project`.

---

### Step 2 — Create a virtual environment

A virtual environment = Laravel's vendor folder. It keeps your packages isolated.

```bash
python -m venv venv
```

Activate it:
```bash
# Mac/Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate
```

You'll see `(venv)` in your terminal. **Always activate this before working.**

---

### Step 3 — Install packages

```bash
pip install fastapi uvicorn httpx python-dotenv configparser browser-cookie3
```

Laravel equivalent:
```bash
composer require laravel/framework guzzlehttp/guzzle vlucas/phpdotenv
```

Save them to a requirements file (like `composer.json` but simpler):
```bash
pip freeze > requirements.txt
```

---

### Step 4 — Create your `.env` file

```bash
# .env
WEBAI_URL=http://localhost:6969
WEBAI_INTERNAL_KEY=your-secret-key-here
APP_PORT=8000
```

Same as Laravel's `.env`. Never commit this to git.

---

### Step 5 — Create `main.py`

This is your `routes/api.php` + `app/Http/Kernel.php` combined.

```python
# main.py

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import configparser
import httpx
import json
import os
from dotenv import load_dotenv

load_dotenv()  # reads your .env file — same as Laravel's config loading

# ----------------------------------------------------------------
# App Setup (like bootstrap/app.php)
# ----------------------------------------------------------------

app = FastAPI(title="WebAI Bridge", version="1.0")

# CORS — like config/cors.php in Laravel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # your React app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Config — like config/services.php
WEBAI_URL = os.getenv("WEBAI_URL", "http://localhost:6969")
WEBAI_INTERNAL_KEY = os.getenv("WEBAI_INTERNAL_KEY", "")
WEBAI_CONFIG_PATH = os.getenv("WEBAI_CONFIG_PATH", "../WebAI-to-API/config.conf")

# ----------------------------------------------------------------
# Pydantic Models (like Laravel Form Requests — validation + typing)
# ----------------------------------------------------------------

class CookieInput(BaseModel):
    psid: str        # like $request->validate(['psid' => 'required|string'])
    psidts: str

class ChatMessage(BaseModel):
    message: str
    model: str = "gemini-3-flash"  # default value

# ----------------------------------------------------------------
# Helper Functions (like app/Helpers/)
# ----------------------------------------------------------------

def write_cookies_to_config(psid: str, psidts: str):
    """
    Writes the user's cookies into WebAI-to-API's config.conf.
    Like writing to a config file in Laravel's storage/ folder.
    """
    config = configparser.ConfigParser()
    config.optionxform = str  # CRITICAL: keeps original case (__Secure-1PSID stays as-is)
    config.read(WEBAI_CONFIG_PATH)

    if "Gemini" not in config:
        config["Gemini"] = {}

    config["Gemini"]["__Secure-1PSID"] = psid.strip()
    config["Gemini"]["__Secure-1PSIDTS"] = psidts.strip()
    config["Gemini"]["backend"] = "webapi"
    config["Gemini"]["default_model"] = "gemini-3-flash"

    with open(WEBAI_CONFIG_PATH, "w", encoding="utf-8") as f:
        config.write(f)


async def reinit_webai_client():
    """
    Tells WebAI-to-API to reload its Gemini client with the new cookies.
    Like calling an internal API in a microservice.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{WEBAI_URL}/internal/reinit-gemini",
            headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"WebAI-to-API reinit failed: {response.text}"
            )


# ----------------------------------------------------------------
# Routes (like routes/api.php)
# ----------------------------------------------------------------

# GET /health  — like a ping route
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "webai-bridge"}


# POST /api/cookies  — save Gemini cookies
@app.post("/api/cookies")
async def save_cookies(data: CookieInput):
    """
    Receives cookies from React, writes to config.conf, reinitializes WebAI client.

    Laravel equivalent:
        Route::post('/cookies', [GeminiController::class, 'saveCookies']);
    """
    # 1. Basic validation (Pydantic already did type checking)
    if len(data.psid) < 10:
        raise HTTPException(status_code=422, detail="psid looks too short")
    if len(data.psidts) < 10:
        raise HTTPException(status_code=422, detail="psidts looks too short")

    # 2. Write to config.conf
    try:
        write_cookies_to_config(data.psid, data.psidts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not write config: {str(e)}")

    # 3. Tell WebAI-to-API to reload
    await reinit_webai_client()

    return {"success": True, "message": "Gemini connected successfully"}


# POST /api/cookies/extract  — auto-extract from browser
@app.post("/api/cookies/extract")
async def extract_cookies_from_browser(browser: str = "chrome"):
    """
    Reads cookies directly from the user's browser on this machine.
    Uses the browser-cookie3 library.
    Works because the backend is LOCAL — same machine as the browser.

    Laravel equivalent: no direct equivalent (PHP can't read browser cookies)
    """
    try:
        import browser_cookie3

        # browser_cookie3 works like: browser_cookie3.chrome(domain_name=...)
        browser_fn = getattr(browser_cookie3, browser.lower(), None)

        if browser_fn is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown browser '{browser}'. Use: chrome, firefox, brave, edge, safari"
            )

        cookie_jar = browser_fn(domain_name=".google.com")

        psid = None
        psidts = None

        for cookie in cookie_jar:
            if cookie.name == "__Secure-1PSID":
                psid = cookie.value
            if cookie.name == "__Secure-1PSIDTS":
                psidts = cookie.value

        if not psid or not psidts:
            return {
                "success": False,
                "message": "Cookies not found. Please log into gemini.google.com first.",
                "action_needed": "login"
            }

        # Auto-apply them
        write_cookies_to_config(psid, psidts)
        await reinit_webai_client()

        return {
            "success": True,
            "message": "Cookies found and applied automatically"
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "message": f"Extraction failed: {str(e)}",
            "action_needed": "manual"
        }


# GET /api/cookies/status  — check if cookies are set
@app.get("/api/cookies/status")
def cookies_status():
    """
    Check if config.conf has cookies set.
    Like a middleware check in Laravel.
    """
    config = configparser.ConfigParser()
    config.optionxform = str
    config.read(WEBAI_CONFIG_PATH)

    psid = config.get("Gemini", "__Secure-1PSID", fallback="").strip()
    psidts = config.get("Gemini", "__Secure-1PSIDTS", fallback="").strip()

    has_cookies = bool(psid and psidts and len(psid) > 10)

    return {
        "connected": has_cookies,
        "message": "Gemini connected" if has_cookies else "No Gemini session found"
    }


# POST /api/chat  — proxy chat messages with streaming
@app.post("/api/chat")
async def chat(data: ChatMessage):
    """
    Proxies chat to WebAI-to-API with streaming support.
    React calls this, we forward to WebAI-to-API and stream the response back.

    Laravel equivalent: a controller that streams a response from an external API.
    """

    request_body = {
        "model": data.model,
        "stream": True,
        "messages": [
            {"role": "user", "content": data.message}
        ]
    }

    async def stream_generator():
        """
        Generator function — yields chunks as they arrive.
        Like a PHP generator (yield) but async.
        """
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{WEBAI_URL}/v1/chat/completions",
                json=request_body,
                headers={"Content-Type": "application/json"}
            ) as response:

                if response.status_code != 200:
                    error_body = await response.aread()
                    yield f"data: {json.dumps({'error': error_body.decode()})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if line:
                        yield f"{line}\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disables nginx buffering
        }
    )


# DELETE /api/cookies  — disconnect Gemini
@app.delete("/api/cookies")
def disconnect_gemini():
    """
    Clears cookies from config.conf.
    Like Route::delete in Laravel.
    """
    config = configparser.ConfigParser()
    config.optionxform = str
    config.read(WEBAI_CONFIG_PATH)

    if "Gemini" in config:
        config["Gemini"]["__Secure-1PSID"] = ""
        config["Gemini"]["__Secure-1PSIDTS"] = ""

        with open(WEBAI_CONFIG_PATH, "w", encoding="utf-8") as f:
            config.write(f)

    return {"success": True, "message": "Gemini disconnected"}
```

---

### Step 6 — Run the Bridge

```bash
uvicorn main:app --reload --port 8000
```

Laravel equivalent: `php artisan serve --port=8000`

- `--reload` = auto-restart on file save (like `--watch` in nodemon, or artisan's file watcher)
- Visit `http://localhost:8000/docs` for automatic Swagger UI (like Laravel's API docs)

---

## Part 2 — Changes to WebAI-to-API

You only need to add **2 things** to WebAI-to-API.

### What to add and where

```
WebAI-to-API/
└── src/
    └── app/
        └── endpoints/      ← add your new file here
            └── system.py   ← EDIT THIS FILE (add 2 endpoints)
```

---

### Step 1 — Find the endpoints folder

```bash
cd WebAI-to-API
ls src/app/endpoints/
```

You should see files like `gemini.py`, `chat.py`, etc.

---

### Step 2 — Open `src/app/endpoints/system.py`

If it doesn't exist, create it. Add these two endpoints at the bottom (or in a new file):

```python
# src/app/endpoints/system.py
# (add to existing file or create new)

from fastapi import APIRouter, HTTPException, Header
from typing import Optional
import os

router = APIRouter()

# This internal key protects these endpoints from public access
INTERNAL_KEY = os.getenv("WEBAI_INTERNAL_KEY", "")


def verify_internal_key(x_internal_key: Optional[str] = Header(None)):
    """
    Simple security check — only your bridge can call these endpoints.
    Like a middleware in Laravel that checks an API key.
    """
    if INTERNAL_KEY and x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Unauthorized internal request")


# POST /internal/reinit-gemini
@router.post("/internal/reinit-gemini")
async def reinit_gemini(x_internal_key: Optional[str] = Header(None)):
    """
    Hot-reloads the Gemini client from config.conf.
    Call this after writing new cookies to config.conf.
    """
    verify_internal_key(x_internal_key)

    try:
        # Import here to avoid circular imports
        from app.services.providers.gemini.client import init_gemini_client
        import app.config as app_config
        from app.config import load_config

        # Step 1: Reload config.conf from disk (pick up new cookies)
        app_config.CONFIG = load_config()

        # Step 2: Re-create the Gemini client with new cookies
        success = await init_gemini_client()

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Gemini re-initialization failed. Cookies may be invalid or expired."
            )

        return {"success": True, "message": "Gemini client reloaded"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# GET /internal/status
@router.get("/internal/status")
def internal_status(x_internal_key: Optional[str] = Header(None)):
    """
    Check if Gemini client is initialized and healthy.
    """
    verify_internal_key(x_internal_key)

    try:
        from app.services.providers.gemini.client import get_gemini_client
        client = get_gemini_client()
        return {"status": "ready", "client_initialized": client is not None}
    except Exception as e:
        return {"status": "error", "message": str(e), "client_initialized": False}
```

---

### Step 3 — Register the router in WebAI-to-API's main.py

Open `src/app/main.py`. Find where other routers are registered (look for lines like `app.include_router(...)`).

Add your new router:

```python
# In src/app/main.py — find the existing include_router calls and add yours

from app.endpoints import system   # add this import

# Add this line with the other include_router calls:
app.include_router(system.router)
```

**How to find the right place:**

```python
# You'll see something like this in main.py already:
app.include_router(gemini.router)
app.include_router(chat.router)
# ... other routers

# ADD YOUR LINE HERE:
app.include_router(system.router)
```

This is like adding a route group in Laravel's `routes/api.php`:
```php
// Laravel equivalent:
Route::prefix('internal')->group(function () {
    Route::post('/reinit-gemini', [SystemController::class, 'reinitGemini']);
    Route::get('/status', [SystemController::class, 'status']);
});
```

---

### Step 4 — Add the internal key to WebAI-to-API's environment

In the WebAI-to-API folder, create or edit `.env`:

```bash
# WebAI-to-API/.env
WEBAI_INTERNAL_KEY=your-secret-key-here
```

Use the **same key** as in your bridge's `.env`.

---

## Part 3 — How the Two Projects Talk

```
Your Bridge (port 8000)          WebAI-to-API (port 6969)
         |                                |
         | POST /internal/reinit-gemini   |
         | X-Internal-Key: secret         |
         |------------------------------->|
         |                                | reads config.conf
         |                                | creates new Gemini client
         |         { success: true }      |
         |<-------------------------------|
```

Both run at the same time. Bridge is the one React talks to. WebAI-to-API only takes calls from the bridge.

---

## Part 4 — Full Flow (End to End)

### Flow 1: User connects Gemini (auto-extract)

```
React: POST http://localhost:8000/api/cookies/extract?browser=chrome
           ↓
Bridge: reads Chrome cookies from disk using browser_cookie3
           ↓
Bridge: writes cookies to WebAI-to-API/config.conf
           ↓
Bridge: POST http://localhost:6969/internal/reinit-gemini
           ↓
WebAI-to-API: reloads config.conf, creates new Gemini client
           ↓
Bridge: returns { success: true }
           ↓
React: shows "Connected ✅"
```

### Flow 2: User sends a chat message

```
React: POST http://localhost:8000/api/chat
       { message: "Hello", model: "gemini-3-flash" }
           ↓
Bridge: POST http://localhost:6969/v1/chat/completions
        { model: "gemini-3-flash", stream: true, messages: [...] }
           ↓
WebAI-to-API: uses global Gemini client
           ↓
Gemini: responds with stream
           ↓
WebAI-to-API: streams SSE chunks back
           ↓
Bridge: forwards each chunk immediately
           ↓
React: receives and renders text word by word
```

---

## Part 5 — Project File Structure

### Your Bridge

```
webai-bridge/
├── main.py              ← all routes + logic (like routes/api.php + controllers combined)
├── .env                 ← environment variables (same as Laravel)
├── requirements.txt     ← installed packages (like composer.lock)
└── venv/                ← virtual environment (like vendor/ — don't commit to git)
```

For a larger project, split like Laravel:

```
webai-bridge/
├── main.py              ← app setup + route registration
├── routes/
│   └── api.py           ← route definitions
├── controllers/
│   ├── cookie_controller.py
│   └── chat_controller.py
├── services/
│   └── gemini_service.py
├── models/
│   └── cookie_model.py
├── .env
└── requirements.txt
```

But for v1, one `main.py` is fine — same as Laravel's welcome controller being in one file.

### WebAI-to-API changes

```
WebAI-to-API/
└── src/
    └── app/
        ├── main.py              ← ADD: include_router(system.router)
        └── endpoints/
            └── system.py        ← ADD: this new file
```

---

## Part 6 — Common Errors and Fixes

### Error: `ModuleNotFoundError: No module named 'fastapi'`

```bash
# You forgot to activate the virtual environment
source venv/bin/activate   # Mac/Linux
venv\Scripts\activate       # Windows
```

Laravel equivalent: forgetting to run `composer install`.

---

### Error: `FileNotFoundError: config.conf`

The path in your `.env` is wrong. Fix `WEBAI_CONFIG_PATH`:

```bash
# .env — use absolute path if relative isn't working
WEBAI_CONFIG_PATH=/absolute/path/to/WebAI-to-API/config.conf
```

---

### Error: `Connection refused` when calling WebAI-to-API

WebAI-to-API isn't running. Start it:

```bash
cd WebAI-to-API
poetry run python src/run.py
```

---

### Error: `browser_cookie3` fails on macOS with Chrome

macOS encrypts Chrome cookies. The library handles it, but it will trigger a macOS keychain popup asking permission. Click **Allow**.

---

### Error: `configparser` mangles cookie names (lowercase)

This is why `config.optionxform = str` is critical. Without it, `configparser` lowercases all keys — so `__Secure-1PSID` becomes `__secure-1psid` and WebAI-to-API can't find it.

**Always include this line:**
```python
config.optionxform = str
```

---

### Error: `422 Unprocessable Entity` from your bridge

Pydantic validation failed. Check the error response body — it tells you exactly which field failed and why.

Laravel equivalent: a FormRequest validation failure returning a 422.

---

## Part 7 — Testing Your Endpoints

You can test with curl (same as Postman):

```bash
# Check health
curl http://localhost:8000/health

# Check cookie status
curl http://localhost:8000/api/cookies/status

# Auto-extract cookies from Chrome
curl -X POST "http://localhost:8000/api/cookies/extract?browser=chrome"

# Manually save cookies
curl -X POST http://localhost:8000/api/cookies \
  -H "Content-Type: application/json" \
  -d '{"psid": "your_psid_value", "psidts": "your_psidts_value"}'

# Send a chat message
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "model": "gemini-3-flash"}'

# Disconnect
curl -X DELETE http://localhost:8000/api/cookies
```

Or visit `http://localhost:8000/docs` — FastAPI gives you a Swagger UI automatically (better than curl).

---

## Part 8 — How to Run Both Projects

Open **two terminal windows**:

**Terminal 1 — Bridge:**
```bash
cd webai-bridge
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 — WebAI-to-API:**
```bash
cd WebAI-to-API
poetry run python src/run.py
# runs on port 6969 by default
```

Both must be running. React talks only to port 8000.

---

## Part 9 — What React Needs to Call

Your React app only needs these 4 endpoints from your bridge:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/cookies/status` | GET | Check if Gemini is connected (on app load) |
| `/api/cookies/extract?browser=chrome` | POST | Auto-detect cookies from browser |
| `/api/cookies` | POST | Manual cookie input (fallback) |
| `/api/chat` | POST | Send a message, stream the response |
| `/api/cookies` | DELETE | Disconnect Gemini |

React never talks to port 6969 directly.

---

## Summary

| Task | File to Edit | What to Do |
|---|---|---|
| Create bridge | `webai-bridge/main.py` | New file — full code above |
| Add reinit endpoint | `WebAI-to-API/src/app/endpoints/system.py` | New file — code above |
| Register the router | `WebAI-to-API/src/app/main.py` | Add one `include_router` line |
| Environment variables | Both `.env` files | Set `WEBAI_INTERNAL_KEY` to same value in both |
| Run everything | Two terminals | uvicorn (bridge) + poetry run (WebAI) |
