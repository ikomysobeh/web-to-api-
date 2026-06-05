# Multi-User Implementation Tasks
> Adding login + per-user Gemini sessions to the WebAI Bridge
> This file tells you: what to build, what to change, and in what order.

---

## What You Are Adding (Big Picture)

Right now your bridge has **no login**. Anyone who opens the app shares one Gemini session.

After these tasks:
- Each user has their own account (email + password)
- Each user connects their own Gemini cookies
- User 1 and User 2 can chat at the same time, each using their own Gemini
- WebAI-to-API holds one Gemini client **per user** in memory

```
Before (v1 — one user):
  Any request → one global Gemini client

After (multi-user):
  Request from user_1 → user_1's Gemini client
  Request from user_2 → user_2's Gemini client
```

---

## The Core Idea That Drives Everything

Right now WebAI-to-API does this:

```python
_gemini_client = None   # ONE global client

def get_gemini_client():
    return _gemini_client   # everyone shares it
```

You will change it to this:

```python
_gemini_clients = {}    # one client per user

def get_gemini_client_for_user(user_id):
    return _gemini_clients[user_id]
```

Every other task in this file exists to support that one change.

---

## Architecture After These Tasks

```
React (port 3000)
  ↓  sends JWT token with every request
Your Bridge (port 8000)
  - login / register endpoints
  - PostgreSQL database (users + encrypted cookies)
  - validates JWT → knows which user is calling
  - passes X-Internal-User-ID to WebAI-to-API
  ↓  sends X-Internal-Key + X-Internal-User-ID
WebAI-to-API (port 6969)
  - GeminiClientManager: one client per user_id
  - creates client on first request for that user
  - drops client when user disconnects
  ↓
Gemini (Google)
```

---

## New Files You Will Create

### In `webai-bridge/`

| File | What it is | Laravel equivalent |
|------|-----------|-------------------|
| `database.py` | PostgreSQL setup, table creation | `database/migrations/` + `config/database.php` |
| `models.py` | User and UserCookie data classes | `app/Models/User.php` |
| `auth.py` | JWT creation and verification | `app/Http/Middleware/Authenticate.php` + `JWTAuth` |
| `services/cookie_service.py` | Encrypt/decrypt + read/write cookies per user | `app/Services/CookieService.php` |

### In `WebAI-to-API/src/app/`

| File | What it is | Laravel equivalent |
|------|-----------|-------------------|
| `services/gemini_client_manager.py` | Holds one Gemini client per user | `app/Services/GeminiClientManager.php` |

---

## Files You Will Modify

### In `webai-bridge/`

| File | What changes |
|------|-------------|
| `main.py` | Add auth routes, protect existing routes with JWT, pass user_id to WebAI |
| `.env` | Add `SECRET_KEY`, `DATABASE_URL` |
| `requirements.txt` | Add new packages |

### In `WebAI-to-API/src/app/`

| File | What changes |
|------|-------------|
| `endpoints/system.py` | Add `/internal/gemini/create`, `/internal/gemini/remove` endpoints |
| `main.py` | Import and initialize `GeminiClientManager` at startup |

---

## New Packages to Install

Run this in your bridge venv:

```bash
pip install python-jose[cryptography] passlib[bcrypt] psycopg2-binary cryptography
pip freeze > requirements.txt
```

| Package | What it does | Laravel equivalent |
|---------|-------------|-------------------|
| `python-jose` | Creates and verifies JWT tokens | `tymon/jwt-auth` |
| `passlib[bcrypt]` | Hashes passwords with bcrypt | `Hash::make()` / `Hash::check()` |
| `psycopg2-binary` | PostgreSQL driver for Python | Laravel's pgsql database driver |
| `cryptography` | Encrypts/decrypts cookie values | `encrypt()` / `decrypt()` in Laravel |

No extra packages needed in WebAI-to-API.

---

---

# Phase 1 — Database Setup (Bridge)

> Think of this as writing your Laravel migration files.

## Task 1.1 — Add new env vars to `webai-bridge/.env`

```ini
# Add these to your existing .env

SECRET_KEY=replace-with-a-long-random-string-at-least-32-chars
COOKIE_ENCRYPTION_KEY=replace-with-another-long-random-string-32-chars

# PostgreSQL connection string
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/webai_bridge
```

How to generate random strings (run in terminal):
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```
Run that twice — once for `SECRET_KEY`, once for `COOKIE_ENCRYPTION_KEY`.

How to create the PostgreSQL database (run in terminal):
```bash
psql -U postgres -c "CREATE DATABASE webai_bridge;"
psql -U postgres -c "CREATE USER your_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE webai_bridge TO your_user;"
```

**Definition of Done:** `.env` has all three new variables with real values. PostgreSQL database is created and accessible.

---

## Task 1.2 — Create `database.py`

Create file: `webai-bridge/database.py`

This file:
- Connects to PostgreSQL
- Creates two tables on startup: `users` and `user_gemini_cookies`
- Provides a `get_connection()` function routes will use

```python
# database.py

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/webai_bridge")


def get_connection():
    """
    Open a PostgreSQL connection.
    Like Laravel's DB::connection().
    psycopg2.extras.RealDictCursor lets you access columns by name: row["email"]
    """
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn


def init_db():
    """
    Create tables if they don't exist.
    Like running: php artisan migrate
    """
    conn = get_connection()
    cursor = conn.cursor()

    # users table — like creating users table in Laravel migration
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # user_gemini_cookies table — stores each user's Gemini cookies
    # cookies are encrypted before storing (never plain text)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_gemini_cookies (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL,
            psid_encrypted TEXT NOT NULL,
            psidts_encrypted TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()
```

**Definition of Done:** `database.py` exists, no import errors when you run `python database.py`.

---

## Task 1.3 — Create `models.py`

Create file: `webai-bridge/models.py`

These are simple data classes. Think of them as Laravel Eloquent models but without the ORM magic — just plain Python classes that describe what a User and a Cookie look like.

```python
# models.py

from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    """
    Like App\Models\User in Laravel.
    """
    id: int
    email: str
    password_hash: str
    created_at: Optional[str] = None


@dataclass
class UserGeminiCookie:
    """
    Stores encrypted cookies for one user.
    Like a pivot/detail table in Laravel.
    """
    id: int
    user_id: int
    psid_encrypted: str
    psidts_encrypted: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
```

**Definition of Done:** `models.py` exists with both classes.

---

---

# Phase 2 — Auth System (Bridge)

> Think of this as building Laravel Sanctum or JWT Auth from scratch, but simpler.

## Task 2.1 — Create `auth.py`

Create file: `webai-bridge/auth.py`

This file handles:
- Hashing passwords (bcrypt — same as Laravel's `Hash::make()`)
- Creating JWT tokens (like Laravel Sanctum tokens)
- Verifying JWT tokens (like middleware `auth:api`)
- A FastAPI dependency `get_current_user` that routes use to know who is calling

```python
# auth.py

import os
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Header
from dotenv import load_dotenv

from database import get_connection

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7   # 7 days — like "remember me"

# Password hasher — like Laravel's Hash facade (uses bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    """
    Hash a password.
    Laravel equivalent: Hash::make($password)
    """
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed: str) -> bool:
    """
    Check a password against its hash.
    Laravel equivalent: Hash::check($password, $hash)
    """
    return pwd_context.verify(plain_password, hashed)


def create_token(user_id: int, email: str) -> str:
    """
    Create a JWT token for a user.
    Laravel equivalent: JWTAuth::fromUser($user) or Sanctum token
    """
    payload = {
        "sub": str(user_id),    # "subject" = who this token is for
        "email": email,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Verify and decode a JWT token.
    Returns the payload dict if valid.
    Raises HTTPException if invalid or expired.

    Laravel equivalent: JWTAuth::parseToken()->authenticate()
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI Dependency — reads and validates the Authorization header.

    Usage in a route:
        @app.get("/protected")
        def my_route(user = Depends(get_current_user)):
            print(user["user_id"])   # the logged-in user's ID

    Laravel equivalent:
        Route::middleware('auth:api')->group(...)
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="No authorization header")

    # Expect: "Bearer <token>"
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization format. Use: Bearer <token>")

    token = parts[1]
    payload = decode_token(token)

    # Also verify user still exists in database
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email FROM users WHERE id = %s", (int(payload["sub"]),))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    return {"user_id": row["id"], "email": row["email"]}
```

**Definition of Done:** `auth.py` exists with all 5 functions. No import errors.

---

## Task 2.2 — Create `services/cookie_service.py`

Create folder: `webai-bridge/services/`
Create file: `webai-bridge/services/cookie_service.py`
Create file: `webai-bridge/services/__init__.py` (empty file — required by Python)

This service handles:
- Encrypting cookies before saving to DB
- Decrypting cookies when reading from DB
- Saving/loading/deleting cookies per user

```python
# services/cookie_service.py

import os
import base64
from typing import Optional, Tuple
from cryptography.fernet import Fernet
from database import get_connection
from dotenv import load_dotenv

load_dotenv()

# The encryption key from .env
# Must be exactly 32 bytes — Fernet will base64-encode it for us
_raw_key = os.getenv("COOKIE_ENCRYPTION_KEY", "").encode()

# Fernet needs a 32-byte key. We pad/truncate to 32 bytes then base64 encode.
# In production, use a proper Fernet key generated with: Fernet.generate_key()
_padded = (_raw_key + b"0" * 32)[:32]
_fernet_key = base64.urlsafe_b64encode(_padded)
_fernet = Fernet(_fernet_key)


def encrypt(value: str) -> str:
    """Encrypt a cookie string. Returns base64 string safe to store in DB."""
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """Decrypt a cookie string from DB back to plain text."""
    return _fernet.decrypt(value.encode()).decode()


def save_cookies(user_id: int, psid: str, psidts: str) -> None:
    """
    Save (or update) a user's Gemini cookies — encrypted.
    Laravel equivalent: UserGeminiCookie::updateOrCreate(['user_id' => $userId], [...])
    """
    psid_enc = encrypt(psid)
    psidts_enc = encrypt(psidts)

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM user_gemini_cookies WHERE user_id = %s", (user_id,)
    )
    existing = cursor.fetchone()

    if existing:
        cursor.execute(
            """UPDATE user_gemini_cookies
               SET psid_encrypted = %s, psidts_encrypted = %s, updated_at = CURRENT_TIMESTAMP
               WHERE user_id = %s""",
            (psid_enc, psidts_enc, user_id)
        )
    else:
        cursor.execute(
            """INSERT INTO user_gemini_cookies (user_id, psid_encrypted, psidts_encrypted)
               VALUES (%s, %s, %s)""",
            (user_id, psid_enc, psidts_enc)
        )

    conn.commit()
    cursor.close()
    conn.close()


def load_cookies(user_id: int) -> Optional[Tuple[str, str]]:
    """
    Load and decrypt a user's cookies.
    Returns (psid, psidts) or None if not found.
    Laravel equivalent: UserGeminiCookie::where('user_id', $userId)->first()
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT psid_encrypted, psidts_encrypted FROM user_gemini_cookies WHERE user_id = %s",
        (user_id,)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        return None

    return decrypt(row["psid_encrypted"]), decrypt(row["psidts_encrypted"])


def has_cookies(user_id: int) -> bool:
    """
    Check if user has cookies saved.
    Laravel equivalent: UserGeminiCookie::where('user_id', $userId)->exists()
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM user_gemini_cookies WHERE user_id = %s", (user_id,)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    return row is not None


def delete_cookies(user_id: int) -> None:
    """
    Delete a user's cookies.
    Laravel equivalent: UserGeminiCookie::where('user_id', $userId)->delete()
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM user_gemini_cookies WHERE user_id = %s", (user_id,))
    conn.commit()
    cursor.close()
    conn.close()
```

**Definition of Done:** `services/` folder exists, both files created, no import errors.

---

---

# Phase 3 — Update `main.py` (Bridge Routes)

> This is the biggest change. You are updating your existing `main.py`.
> The old routes stay. You are ADDING new routes and PROTECTING existing ones.

## Task 3.1 — Update imports and startup in `main.py`

At the top of `main.py`, add these new imports and call `init_db()` on startup:

```python
# Add to existing imports:
from database import init_db
from auth import hash_password, verify_password, create_token, get_current_user
from services.cookie_service import save_cookies, load_cookies, has_cookies, delete_cookies

# Add these new Pydantic models (alongside your existing ones):
class RegisterInput(BaseModel):
    email: str
    password: str

class LoginInput(BaseModel):
    email: str
    password: str

# Add startup event to create DB tables on boot:
# (place this right after you create the FastAPI app)
@app.on_event("startup")
def startup():
    init_db()   # like php artisan migrate — creates tables if missing
```

---

## Task 3.2 — Add `POST /auth/register`

Add this route to `main.py`:

```python
@app.post("/auth/register")
def register(data: RegisterInput):
    """
    Create a new user account.
    Laravel equivalent: AuthController@register
    """
    from database import get_connection

    # Basic validation
    if not data.email or "@" not in data.email:
        raise HTTPException(status_code=422, detail="Invalid email")
    if len(data.password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")

    conn = get_connection()
    cursor = conn.cursor()

    # Check if email already exists
    # Laravel equivalent: User::where('email', $email)->exists()
    cursor.execute(
        "SELECT id FROM users WHERE email = %s", (data.email.lower().strip(),)
    )
    existing = cursor.fetchone()

    if existing:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=409, detail="Email already registered")

    # Hash and save
    # Laravel equivalent: User::create([...])
    hashed = hash_password(data.password)
    cursor.execute(
        "INSERT INTO users (email, password_hash) VALUES (%s, %s)",
        (data.email.lower().strip(), hashed)
    )
    conn.commit()

    # Get the new user's ID
    cursor.execute(
        "SELECT id FROM users WHERE email = %s", (data.email.lower().strip(),)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    token = create_token(row["id"], data.email)
    return {"success": True, "token": token, "email": data.email}
```

---

## Task 3.3 — Add `POST /auth/login`

```python
@app.post("/auth/login")
def login(data: LoginInput):
    """
    Login with email + password. Returns JWT token.
    Laravel equivalent: AuthController@login
    """
    from database import get_connection

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, password_hash FROM users WHERE email = %s",
        (data.email.lower().strip(),)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    # Don't reveal which part is wrong (security best practice)
    if not row or not verify_password(data.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_token(row["id"], row["email"])
    return {"success": True, "token": token, "email": row["email"]}
```

---

## Task 3.4 — Add `GET /auth/me`

```python
@app.get("/auth/me")
def me(user = Depends(get_current_user)):
    """
    Return the currently logged-in user's info.
    React calls this on load to check if the token is still valid.
    Laravel equivalent: AuthController@me
    """
    return {"user_id": user["user_id"], "email": user["email"]}
```

---

## Task 3.5 — Update `POST /api/cookies` to be per-user

Replace your existing `/api/cookies` route with this version:

```python
@app.post("/api/cookies")
async def save_user_cookies(data: CookieInput, user = Depends(get_current_user)):
    """
    Save THIS user's Gemini cookies — encrypted in DB.
    Then tell WebAI-to-API to create a Gemini client for this user.

    The 'user = Depends(get_current_user)' part:
    - reads the Authorization header
    - verifies the JWT token
    - gives you the logged-in user's data
    Laravel equivalent: a controller method with 'auth:api' middleware
    """
    if len(data.psid) < 10:
        raise HTTPException(status_code=422, detail="psid looks too short")
    if len(data.psidts) < 10:
        raise HTTPException(status_code=422, detail="psidts looks too short")

    # Save encrypted cookies to database
    try:
        save_cookies(user["user_id"], data.psid.strip(), data.psidts.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save cookies: {str(e)}")

    # Tell WebAI-to-API to create a Gemini client for this user
    await create_webai_client_for_user(user["user_id"], data.psid.strip(), data.psidts.strip())

    return {"success": True, "message": "Gemini connected successfully"}
```

---

## Task 3.6 — Update `POST /api/cookies/extract` to be per-user

Replace your existing extract route:

```python
@app.post("/api/cookies/extract")
async def extract_cookies(browser: str = "chrome", user = Depends(get_current_user)):
    """Auto-extract from browser and save per-user."""
    allowed = ["chrome", "firefox", "brave", "edge", "safari"]
    if browser.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Unknown browser '{browser}'. Use: {', '.join(allowed)}")

    try:
        import browser_cookie3
        browser_fn = getattr(browser_cookie3, browser.lower(), None)
        cookie_jar = browser_fn(domain_name=".google.com")

        psid = None
        psidts = None
        for cookie in cookie_jar:
            if cookie.name == "__Secure-1PSID":
                psid = cookie.value
            if cookie.name == "__Secure-1PSIDTS":
                psidts = cookie.value

        if not psid or not psidts:
            return {"success": False, "message": "Not logged into gemini.google.com", "action_needed": "login"}

        save_cookies(user["user_id"], psid, psidts)
        await create_webai_client_for_user(user["user_id"], psid, psidts)

        return {"success": True, "message": "Cookies found and applied automatically"}

    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "message": f"Extraction failed: {str(e)}", "action_needed": "manual"}
```

---

## Task 3.7 — Update `GET /api/cookies/status` to be per-user

```python
@app.get("/api/cookies/status")
def cookie_status(user = Depends(get_current_user)):
    """Check if THIS user has Gemini cookies saved."""
    connected = has_cookies(user["user_id"])
    return {
        "connected": connected,
        "message": "Gemini connected" if connected else "No Gemini session found"
    }
```

---

## Task 3.8 — Update `POST /api/chat` to pass user identity

Replace your existing chat route:

```python
@app.post("/api/chat")
async def chat(data: ChatMessage, user = Depends(get_current_user)):
    """
    Stream chat — uses THIS user's Gemini client in WebAI-to-API.
    Passes X-Internal-User-ID header so WebAI knows which client to use.
    """
    user_id = str(user["user_id"])

    request_body = {
        "model": data.model,
        "stream": True,
        "messages": [{"role": "user", "content": data.message}]
    }

    async def stream_from_webai():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{WEBAI_URL}/v1/chat/completions",
                    json=request_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Key": WEBAI_INTERNAL_KEY,
                        "X-Internal-User-ID": user_id,   # ← NEW: tells WebAI which user
                    }
                ) as response:
                    if response.status_code != 200:
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        stream_from_webai(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
```

---

## Task 3.9 — Update `DELETE /api/cookies` to be per-user

```python
@app.delete("/api/cookies")
async def disconnect_gemini(user = Depends(get_current_user)):
    """Remove THIS user's cookies and drop their Gemini client."""
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    return {"success": True, "message": "Gemini disconnected"}
```

---

## Task 3.10 — Add two new internal helper functions in `main.py`

These functions call the new WebAI-to-API endpoints you will build in Phase 4.
Add them near your existing `reinit_webai_client()` helper:

```python
async def create_webai_client_for_user(user_id: int, psid: str, psidts: str):
    """
    Tell WebAI-to-API to create a Gemini client for this specific user.
    Called after saving cookies.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{WEBAI_URL}/internal/gemini/create",
            json={"user_id": str(user_id), "psid": psid, "psidts": psidts},
            headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"WebAI-to-API failed to create client: {response.text}"
            )


async def remove_webai_client_for_user(user_id: int):
    """
    Tell WebAI-to-API to drop this user's Gemini client from memory.
    Called when user disconnects Gemini.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.delete(
            f"{WEBAI_URL}/internal/gemini/{user_id}",
            headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
        )
        # Don't raise if this fails — user is disconnecting anyway
```

**Definition of Done for Phase 3:** All 8 routes work. `/auth/register` and `/auth/login` return tokens. Protected routes return 401 without a token. Chat passes the user ID to WebAI-to-API.

---

---

# Phase 4 — GeminiClientManager (WebAI-to-API)

> This is the core change inside WebAI-to-API.
> You are replacing the "one global client" with "one client per user".

## Task 4.1 — Create `src/app/services/gemini_client_manager.py`

Create file in WebAI-to-API: `src/app/services/gemini_client_manager.py`

```python
# src/app/services/gemini_client_manager.py

import asyncio
import os
import tempfile
import time
from typing import Dict, Optional
from app.logger import logger
from app.config import CONFIG

# Registry: maps user_id string → initialized Gemini client object
# Like: { "1": <GeminiClient>, "2": <GeminiClient> }
_clients: Dict[str, object] = {}
_lock = asyncio.Lock()


async def get_or_create_client(user_id: str, psid: str, psidts: str):
    """
    Returns an existing client for this user, or creates a new one.
    This is the key function — replaces the old get_gemini_client().

    Think of it like a connection pool, but per user.
    """
    async with _lock:
        if user_id in _clients:
            logger.info(f"GeminiClientManager: Reusing existing client for user {user_id}")
            return _clients[user_id]

        logger.info(f"GeminiClientManager: Creating new Gemini client for user {user_id}")
        client = await _create_client(user_id, psid, psidts)
        _clients[user_id] = client
        return client


async def _create_client(user_id: str, psid: str, psidts: str):
    """
    Initialize a new Gemini client from scratch for one user.
    Copied and adapted from the original init_gemini_client() logic.
    """
    from app.services.providers.gemini.webapi_client import MyGeminiClient

    gemini_proxy = CONFIG["Proxy"].get("http_proxy") or None

    # Unique temp path so users don't share cache files
    unique_id = f"{user_id}_{os.getpid()}_{int(time.time())}"
    os.environ["GEMINI_COOKIE_PATH"] = os.path.join(
        tempfile.gettempdir(), f"webai_user_{unique_id}"
    )

    client = MyGeminiClient(
        secure_1psid=psid,
        secure_1psidts=psidts,
        proxy=gemini_proxy,
        cookies={"__Secure-1PSID": psid, "__Secure-1PSIDTS": psidts}
    )
    await client.init(verbose=False, auto_refresh=False)

    status_name = "UNKNOWN"
    if hasattr(client, "client") and hasattr(client.client, "account_status"):
        status_name = client.client.account_status.name

    if status_name not in ("AVAILABLE", "UNAUTHENTICATED"):
        raise RuntimeError(f"Gemini client for user {user_id} has invalid status: {status_name}")

    logger.info(f"GeminiClientManager: Client for user {user_id} status: {status_name}")
    return client


def get_client(user_id: str):
    """
    Return the client for a user — raises if not initialized.
    Used by the chat endpoint to get the client synchronously.
    """
    if user_id not in _clients:
        raise KeyError(f"No Gemini client found for user {user_id}. User must connect Gemini first.")
    return _clients[user_id]


async def remove_client(user_id: str):
    """
    Remove a user's client from memory. Called on disconnect.
    """
    async with _lock:
        if user_id in _clients:
            client = _clients.pop(user_id)
            try:
                if hasattr(client, "close"):
                    await client.close()
            except Exception as e:
                logger.warning(f"GeminiClientManager: Error closing client for user {user_id}: {e}")
            logger.info(f"GeminiClientManager: Client removed for user {user_id}")


def list_active_users() -> list:
    """Return list of user IDs with active clients. For status/debug."""
    return list(_clients.keys())
```

**Definition of Done:** File exists, no import errors.

---

## Task 4.2 — Update `src/app/endpoints/system.py`

Add three new endpoints to the existing `system.py` file.
Keep the existing `/internal/reinit-gemini` and `/internal/status` endpoints — just add below them.

```python
# Add these imports at the top of system.py:
from pydantic import BaseModel

# Add this model near the top:
class CreateClientInput(BaseModel):
    user_id: str
    psid: str
    psidts: str

# Add these three new endpoints:

@router.post("/internal/gemini/create")
async def create_user_client(
    data: CreateClientInput,
    x_internal_key: Optional[str] = Header(None)
):
    """
    Create a Gemini client for a specific user.
    Called by the bridge after saving a user's cookies.
    Protected by internal key — only bridge can call this.
    """
    verify_internal_key(x_internal_key)

    from app.services.gemini_client_manager import get_or_create_client

    try:
        await get_or_create_client(data.user_id, data.psid, data.psidts)
        return {"success": True, "user_id": data.user_id, "message": "Gemini client created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create client for user {data.user_id}: {str(e)}")


@router.delete("/internal/gemini/{user_id}")
async def remove_user_client(
    user_id: str,
    x_internal_key: Optional[str] = Header(None)
):
    """
    Remove a user's Gemini client from memory.
    Called by the bridge when user disconnects Gemini.
    """
    verify_internal_key(x_internal_key)

    from app.services.gemini_client_manager import remove_client
    await remove_client(user_id)
    return {"success": True, "user_id": user_id, "message": "Client removed"}


@router.get("/internal/gemini/active")
async def list_active_clients(
    x_internal_key: Optional[str] = Header(None)
):
    """
    List all user IDs with active Gemini clients.
    Useful for debugging.
    """
    verify_internal_key(x_internal_key)

    from app.services.gemini_client_manager import list_active_users
    users = list_active_users()
    return {"active_users": users, "count": len(users)}
```

**Definition of Done:** The three new endpoints exist. Calling `/internal/gemini/create` without the key returns 403. With the key it returns 200 (even if Gemini init fails — you'll catch that in testing).

---

## Task 4.3 — Update the chat endpoint to use per-user client

Open `WebAI-to-API/src/app/endpoints/chat.py`.

Find the `chat_completions` function. It currently does:
```python
provider, resolved_model = ProviderFactory.get_provider(request)
```

You need to make the provider use the right user's client. The approach is:

1. Read `X-Internal-User-ID` from the request header
2. Pass it to the provider so it can find the right client

Add this to the `chat_completions` function, right at the start:

```python
@router.post("/v1/chat/completions")
async def chat_completions(request: OpenAIChatRequest, http_request: Request):

    # NEW: Read which user is calling
    user_id = http_request.headers.get("X-Internal-User-ID")

    # If user_id provided, attach it to the request for the provider to use
    if user_id:
        object.__setattr__(request, "_user_id", user_id)

    # --- rest of the existing code stays the same ---
    if hasattr(http_request.state, "request_id"):
        object.__setattr__(request, "_http_request_id", http_request.state.request_id)

    provider, resolved_model = ProviderFactory.get_provider(request)
    request.model = resolved_model
    return await provider.chat_completions(request)
```

---

## Task 4.4 — Update the webapi_adapter to use per-user client

Open `WebAI-to-API/src/app/services/providers/gemini/webapi_adapter.py`.

Find `_get_available_gemini_client()`. Replace it with this version:

```python
def _get_available_gemini_client(self, user_id: str = None):
    """
    Get the Gemini client for a specific user.
    Falls back to global client if no user_id (backward compatibility).
    """
    if user_id:
        # Multi-user path: get this user's dedicated client
        from app.services.gemini_client_manager import get_client
        try:
            return get_client(user_id)
        except KeyError:
            raise HTTPException(
                status_code=401,
                detail="No Gemini session found for this user. Please connect Gemini first."
            )
    else:
        # Legacy path: use global client (single-user fallback)
        try:
            return get_gemini_client()
        except GeminiClientNotInitializedError as e:
            raise HTTPException(status_code=503, detail=str(e))
```

Then in `chat_completions` inside the adapter, update the client call to pass the user_id:

```python
async def chat_completions(self, request: OpenAIChatRequest, ...):
    # Read user_id from request (set by the endpoint)
    user_id = getattr(request, "_user_id", None)

    # Get the right client for this user
    gemini_client = self._get_available_gemini_client(user_id)

    # ... rest of the method stays the same
```

**Definition of Done for Phase 4:** When you call `/v1/chat/completions` with `X-Internal-User-ID: 1`, WebAI-to-API picks client for user 1. With user ID 2, it picks client for user 2. Without a user ID, it falls back to global client.

---

---

# Phase 5 — Testing

## Task 5.1 — Test registration and login

```bash
# Register
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user1@test.com", "password": "password123"}'

# Expected:
# {"success": true, "token": "eyJ...", "email": "user1@test.com"}
```

```bash
# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user1@test.com", "password": "password123"}'

# Expected: same — token returned
```

```bash
# Try wrong password
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user1@test.com", "password": "wrongpassword"}'

# Expected: 401 "Invalid email or password"
```

---

## Task 5.2 — Test protected routes reject unauthenticated requests

```bash
# Try cookie status without token
curl http://localhost:8000/api/cookies/status

# Expected: 401 "No authorization header"
```

```bash
# Try chat without token
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'

# Expected: 401
```

---

## Task 5.3 — Test full flow for User 1

```bash
# Save token as variable for convenience
TOKEN="paste_your_token_here"

# Check cookie status (should be not connected)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/cookies/status

# Connect Gemini (manual cookies)
curl -X POST http://localhost:8000/api/cookies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"psid": "your_psid", "psidts": "your_psidts"}'

# Check status again (should now be connected)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/cookies/status

# Send a chat message
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! Say one word back.", "model": "gemini-3-flash"}'
```

---

## Task 5.4 — Test two users at the same time

```bash
# Register User 2
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user2@test.com", "password": "password123"}'

# Login as User 2, get their token
# Connect User 2's Gemini cookies
# Send a message as User 2

# Confirm WebAI has both clients active:
curl http://localhost:6969/internal/gemini/active \
  -H "X-Internal-Key: your-secret-key-here"

# Expected:
# {"active_users": ["1", "2"], "count": 2}
```

---

## Task 5.5 — Test disconnect

```bash
curl -X DELETE http://localhost:8000/api/cookies \
  -H "Authorization: Bearer $TOKEN"

# Expected: {"success": true, "message": "Gemini disconnected"}

# Confirm active users dropped by 1:
curl http://localhost:6969/internal/gemini/active \
  -H "X-Internal-Key: your-secret-key-here"
```

---

---

# Phase 6 — Final Checklist

## Files created (verify all exist)

- [ ] `webai-bridge/database.py`
- [ ] `webai-bridge/models.py`
- [ ] `webai-bridge/auth.py`
- [ ] `webai-bridge/services/__init__.py`
- [ ] `webai-bridge/services/cookie_service.py`
- [ ] `WebAI-to-API/src/app/services/gemini_client_manager.py`

## Files modified (verify changes are in)

- [ ] `webai-bridge/main.py` — new imports, startup event, auth routes, protected routes, user_id in chat header
- [ ] `webai-bridge/.env` — `SECRET_KEY`, `DATABASE_URL`, `COOKIE_ENCRYPTION_KEY`
- [ ] `webai-bridge/requirements.txt` — new packages added
- [ ] `WebAI-to-API/src/app/endpoints/system.py` — three new internal endpoints
- [ ] `WebAI-to-API/src/app/endpoints/chat.py` — reads `X-Internal-User-ID`
- [ ] `WebAI-to-API/src/app/services/providers/gemini/webapi_adapter.py` — uses per-user client

## Behavior checklist

- [ ] `/auth/register` creates user and returns token
- [ ] `/auth/login` returns token for valid credentials, 401 for wrong password
- [ ] All `/api/*` routes return 401 without a token
- [ ] Cookie status is per-user (user1 connected does not affect user2)
- [ ] Chat uses the right Gemini client per user
- [ ] Two users can chat at the same time
- [ ] Disconnect removes only that user's client
- [ ] `/internal/gemini/*` returns 403 without the internal key
- [ ] Cookies are never stored as plain text (check the `user_gemini_cookies` table — values should look like garbled encrypted strings)
- [ ] `.env` is NOT in git

---

# API Contract for React

These are all the endpoints React needs to call:

| Method | Endpoint | Auth | Purpose |
|--------|---------|------|---------|
| POST | `/auth/register` | None | Create account |
| POST | `/auth/login` | None | Login, get token |
| GET | `/auth/me` | Bearer token | Check if token is still valid |
| GET | `/api/cookies/status` | Bearer token | Is Gemini connected? |
| POST | `/api/cookies/extract?browser=chrome` | Bearer token | Auto-connect Gemini |
| POST | `/api/cookies` | Bearer token | Manual cookie input |
| DELETE | `/api/cookies` | Bearer token | Disconnect Gemini |
| POST | `/api/chat` | Bearer token | Send message, stream response |
| GET | `/health` | None | Ping check |

React stores the token in `localStorage` and sends it as:
```
Authorization: Bearer eyJhbGci...
```

React never talks to port 6969. Never.

---

# Common Errors for This Phase

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: jose` | New packages not installed | `pip install python-jose[cryptography]` |
| `401 No authorization header` | Forgot to send `Authorization: Bearer <token>` | Add the header in React/curl |
| `401 Invalid or expired token` | Token expired (7 days) or `SECRET_KEY` changed | User logs in again |
| `KeyError: No Gemini client for user` | User called chat without connecting Gemini | Call `/api/cookies` first |
| `409 Email already registered` | Tried to register with existing email | Use `/auth/login` instead |
| `psycopg2.OperationalError` | Wrong `DATABASE_URL` or PostgreSQL not running | Check `.env` `DATABASE_URL` and run `pg_isready` |
| `psycopg2.errors.UniqueViolation` | Duplicate email insert race condition | Handled by the `existing` check in register |
| `cryptography.fernet.InvalidToken` | `COOKIE_ENCRYPTION_KEY` changed after cookies were saved | Clear `user_gemini_cookies` table and re-save cookies |
| `422` on register/login | Missing `email` or `password` field | Check request body |
