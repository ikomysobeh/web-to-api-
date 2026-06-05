# main.py

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import configparser
import httpx
import json
import os
import logging
from dotenv import load_dotenv

from database import init_db
from auth import hash_password, verify_password, create_token, get_current_user
from services.cookie_service import save_cookies, load_cookies, has_cookies, delete_cookies

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("webai-bridge")

load_dotenv()  # reads your .env file — same as Laravel's config loading

# ----------------------------------------------------------------
# App Setup (like bootstrap/app.php)
# ----------------------------------------------------------------

app = FastAPI(
    title="WebAI Bridge",
    version="1.0"
)

# Add security scheme to OpenAPI schema
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = FastAPI.openapi(app)  # Call the original method
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT"
        }
    }
    app.openapi_schema = openapi_schema
    return openapi_schema

app.openapi = custom_openapi

@app.on_event("startup")
def startup():
    init_db()   # like php artisan migrate — creates tables if missing

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

class RegisterInput(BaseModel):
    email: str
    password: str

class LoginInput(BaseModel):
    email: str
    password: str

# ----------------------------------------------------------------
# Helper Functions (like app/Helpers/)
# ----------------------------------------------------------------

def write_cookies_to_config(psid: str, psidts: str):
    """
    Writes the user's cookies into WebAI-to-API's config.conf.
    Like writing to a config file in Laravel's storage/ folder.
    """
    logger.info(f"Writing cookies to config file: {WEBAI_CONFIG_PATH}")

    try:
        config = configparser.ConfigParser()
        config.optionxform = str  # CRITICAL: keeps original case (__Secure-1PSID stays as-is)
        config.read(WEBAI_CONFIG_PATH, encoding="utf-8")

        if "Gemini" not in config:
            logger.info("Gemini section not found. Creating [Gemini] section")
            config["Gemini"] = {}

        config["Gemini"]["__Secure-1PSID"] = psid.strip()
        config["Gemini"]["__Secure-1PSIDTS"] = psidts.strip()
        config["Gemini"]["backend"] = "webapi"
        config["Gemini"]["default_model"] = "gemini-3-flash"

        with open(WEBAI_CONFIG_PATH, "w", encoding="utf-8") as f:
            config.write(f)

        logger.info("Cookies written to config.conf successfully")

    except Exception:
        logger.exception("Failed to write cookies to config.conf")
        raise


async def reinit_webai_client():
    """
    Tells WebAI-to-API to reload its Gemini client with the new cookies.
    Like calling an internal API in a microservice.
    """
    url = f"{WEBAI_URL}/internal/reinit-gemini"
    logger.info(f"Calling WebAI reinit endpoint: {url}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
            )

        logger.info(f"WebAI reinit response status: {response.status_code}")

        if response.status_code != 200:
            logger.error(f"WebAI reinit failed: {response.text}")
            raise HTTPException(
                status_code=500,
                detail=f"WebAI-to-API reinit failed: {response.text}"
            )

        logger.info("WebAI reinit completed successfully")

    except Exception:
        logger.exception("Failed to reinitialize WebAI Gemini client")
        raise


async def create_webai_client_for_user(user_id: int, psid: str, psidts: str):
    """
    Tell WebAI-to-API to create a Gemini client for this specific user.
    Called after saving cookies.
    """
    logger.info(f"Creating WebAI client for user_id: {user_id}")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{WEBAI_URL}/internal/gemini/create",
            json={"user_id": str(user_id), "psid": psid, "psidts": psidts},
            headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
        )
        if response.status_code != 200:
            logger.error(f"WebAI client creation failed for user_id {user_id}: {response.text}")
            raise HTTPException(
                status_code=500,
                detail=f"WebAI-to-API failed to create client: {response.text}"
            )
        logger.info(f"WebAI client created successfully for user_id: {user_id}")


async def remove_webai_client_for_user(user_id: int):
    """
    Tell WebAI-to-API to drop this user's Gemini client from memory.
    Called when user disconnects Gemini.
    """
    logger.info(f"Removing WebAI client for user_id: {user_id}")
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.delete(
            f"{WEBAI_URL}/internal/gemini/{user_id}",
            headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
        )
        # Don't raise if this fails — user is disconnecting anyway
        logger.info(f"WebAI client removal completed for user_id: {user_id}")


# ----------------------------------------------------------------
# Routes (like routes/api.php)
# ----------------------------------------------------------------

# GET /health  — like a ping route
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "webai-bridge"}


# POST /auth/register
@app.post("/auth/register")
def register(data: RegisterInput):
    """
    Create a new user account.
    Laravel equivalent: AuthController@register
    """
    from database import get_connection

    logger.info(f"Registration attempt for email: {data.email}")

    # Basic validation
    if not data.email or "@" not in data.email:
        logger.warning("Registration failed: invalid email")
        raise HTTPException(status_code=422, detail="Invalid email")
    if len(data.password) < 6:
        logger.warning("Registration failed: password too short")
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
        logger.warning(f"Registration failed: email already exists: {data.email}")
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
    logger.info(f"Registration successful for email: {data.email}")
    return {"success": True, "token": token, "email": data.email}


# POST /auth/login
@app.post("/auth/login")
def login(data: LoginInput):
    """
    Login with email + password. Returns JWT token.
    Laravel equivalent: AuthController@login
    """
    from database import get_connection

    logger.info(f"Login attempt for email: {data.email}")

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
        logger.warning(f"Login failed for email: {data.email}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_token(row["id"], row["email"])
    logger.info(f"Login successful for email: {data.email}")
    return {"success": True, "token": token, "email": row["email"]}


# GET /auth/me
@app.get("/auth/me", dependencies=[Depends(get_current_user)])
def me(user = Depends(get_current_user)):
    """
    Return the currently logged-in user's info.
    React calls this on load to check if the token is still valid.
    Laravel equivalent: AuthController@me
    """
    return {"user_id": user["user_id"], "email": user["email"]}


# POST /api/cookies  — save Gemini cookies (per-user)
@app.post("/api/cookies", dependencies=[Depends(get_current_user)])
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
    logger.info(f"Manual cookie save requested for user_id: {user['user_id']}")

    if len(data.psid) < 10:
        logger.warning("psid validation failed: too short")
        raise HTTPException(status_code=422, detail="psid looks too short")
    if len(data.psidts) < 10:
        logger.warning("psidts validation failed: too short")
        raise HTTPException(status_code=422, detail="psidts looks too short")

    # Save encrypted cookies to database
    try:
        save_cookies(user["user_id"], data.psid.strip(), data.psidts.strip())
    except Exception as e:
        logger.exception("Failed to save cookies to database")
        raise HTTPException(status_code=500, detail=f"Could not save cookies: {str(e)}")

    # Tell WebAI-to-API to create a Gemini client for this user
    await create_webai_client_for_user(user["user_id"], data.psid.strip(), data.psidts.strip())

    logger.info(f"Manual cookie save completed for user_id: {user['user_id']}")
    return {"success": True, "message": "Gemini connected successfully"}


# POST /api/cookies/extract  — auto-extract from browser (per-user)
@app.post("/api/cookies/extract", dependencies=[Depends(get_current_user)])
async def extract_cookies_from_browser(browser: str = "chrome", user = Depends(get_current_user)):
    """
    Reads cookies directly from the user's browser on this machine.
    Uses the browser-cookie3 library.
    Works because the backend is LOCAL — same machine as the browser.

    Laravel equivalent: no direct equivalent (PHP can't read browser cookies)
    """
    logger.info(f"Cookie extraction started. browser={browser}, user_id={user['user_id']}")

    allowed = ["chrome", "firefox", "brave", "edge", "safari"]
    if browser.lower() not in allowed:
        logger.warning(f"Unknown browser selected: {browser}")
        raise HTTPException(
            status_code=400,
            detail=f"Unknown browser '{browser}'. Use: {', '.join(allowed)}"
        )

    try:
        import browser_cookie3

        logger.info("Checking selected browser")

        # browser_cookie3 works like: browser_cookie3.chrome(domain_name=...)
        browser_fn = getattr(browser_cookie3, browser.lower(), None)

        if browser_fn is None:
            logger.warning(f"Unknown browser selected: {browser}")
            raise HTTPException(
                status_code=400,
                detail=f"Unknown browser '{browser}'. Use: {', '.join(allowed)}"
            )

        logger.info(f"Trying to read cookies from {browser}")
        cookie_jar = browser_fn(domain_name=".google.com")

        logger.info("Browser cookies loaded. Searching for Gemini cookies")

        psid = None
        psidts = None

        for cookie in cookie_jar:
            if cookie.name == "__Secure-1PSID":
                psid = cookie.value
                logger.info("__Secure-1PSID found")
            if cookie.name == "__Secure-1PSIDTS":
                psidts = cookie.value
                logger.info("__Secure-1PSIDTS found")

        if not psid or not psidts:
            logger.warning("Gemini cookies not found. User may not be logged into Gemini")
            return {"success": False, "message": "Not logged into gemini.google.com", "action_needed": "login"}

        logger.info("Gemini cookies found. Saving to database")
        save_cookies(user["user_id"], psid, psidts)
        await create_webai_client_for_user(user["user_id"], psid, psidts)

        logger.info("Cookie extraction completed successfully")
        return {"success": True, "message": "Cookies found and applied automatically"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Cookie extraction failed")
        return {"success": False, "message": f"Extraction failed: {str(e)}", "action_needed": "manual"}


# GET /api/cookies/status  — check if cookies are set (per-user)
@app.get("/api/cookies/status", dependencies=[Depends(get_current_user)])
def cookies_status(user = Depends(get_current_user)):
    """
    Check if THIS user has Gemini cookies saved.
    Like a middleware check in Laravel.
    """
    logger.info(f"Cookie status check requested for user_id: {user['user_id']}")
    connected = has_cookies(user["user_id"])
    logger.info(f"Cookie status check result: connected={connected}")
    return {
        "connected": connected,
        "message": "Gemini connected" if connected else "No Gemini session found"
    }


# POST /api/chat  — proxy chat messages with streaming (per-user)
@app.post("/api/chat", dependencies=[Depends(get_current_user)])
async def chat(data: ChatMessage, user = Depends(get_current_user)):
    """
    Stream chat — uses THIS user's Gemini client in WebAI-to-API.
    Passes X-Internal-User-ID header so WebAI knows which client to use.
    """
    logger.info(f"Chat request received. model={data.model}, user_id={user['user_id']}")
    user_id = str(user["user_id"])

    request_body = {
        "model": data.model,
        "stream": True,
        "messages": [
            {"role": "user", "content": data.message}
        ]
    }

    async def stream_from_webai():
        try:
            logger.info(f"Streaming to WebAI-to-API: {WEBAI_URL}/v1/chat/completions for user_id={user_id}")
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
                        logger.error(f"WebAI chat failed with status {response.status_code}")
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    logger.info("WebAI chat streaming started")
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            logger.exception("WebAI chat streaming error")
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


# DELETE /api/cookies  — disconnect Gemini (per-user)
@app.delete("/api/cookies", dependencies=[Depends(get_current_user)])
async def disconnect_gemini(user = Depends(get_current_user)):
    """Remove THIS user's cookies and drop their Gemini client."""
    logger.info(f"Gemini disconnect requested for user_id: {user['user_id']}")
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    logger.info(f"Gemini disconnected successfully for user_id: {user['user_id']}")
    return {"success": True, "message": "Gemini disconnected"}
