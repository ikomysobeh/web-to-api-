# main.py

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
import asyncio
import configparser
import httpx
import json
import os
import uuid
import logging
from dotenv import load_dotenv

from database import init_db, get_connection, close_pool
from auth import hash_password, verify_password, create_token, get_current_user, require_admin, require_permission, validate_with_laravel
from nats_sync import start_nats_sync, get_nats_status
from vector import ingest_document, search_chunks, extract_text
from services.cookie_service import save_cookies, load_cookies, has_cookies, delete_cookies
from schemas.conversations import ConversationCreate, ConversationUpdate
from schemas.messages import MessageCreate
from schemas.users import UserPreferencesUpdate
from schemas.models import ModelInfo
from schemas.agents import AgentCreate, AgentUpdate, AgentResponse, AgentPublicResponse
from schemas.documents import DocumentUploadResponse
from schemas.suggestions import GenerateRequest, SaveRequest
from services.suggestion_service import (
    rebuild_agent_document_text, build_suggestion_prompt, parse_questions,
    get_saved_suggestions, replace_suggestions
)
from schemas.embeds import EmbedCreate, EmbedUpdate, EmbedChatMessage
from services.embed_service import (
    create_embed, list_embeds, get_embed, get_embed_by_key,
    update_embed, soft_delete_embed, origin_allowed
)
from services.conversation_service import (
    create_conversation, get_conversations, get_conversation,
    update_conversation, delete_conversation, delete_all_conversations
)
from services.message_service import (
    create_message, get_messages, delete_message
)

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
async def startup():
    init_db()   # like php artisan migrate — creates tables if missing
    # Start NATS subscriber in background
    asyncio.create_task(start_nats_sync())
    logger.info("NATS sync task started")


@app.on_event("shutdown")
async def shutdown():
    # Return all pooled DB connections cleanly on shutdown.
    close_pool()

# CORS — like config/cors.php in Laravel
# Local dev origins are always allowed. Add production origins via the
# CORS_ORIGINS env var (comma-separated). Example in .env:
#   CORS_ORIGINS=http://2.25.70.122:3000,https://app.yourdomain.com
_default_cors_origins = [
    "http://127.0.0.1:3000",  # frontend via Docker (IP)
    "http://localhost:3000",   # frontend via Docker (hostname)
    "http://127.0.0.1:5173",  # Vite dev server (IP)
    "http://localhost:5173",   # Vite dev server (hostname)
]
_extra_cors_origins = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_cors_origins + _extra_cors_origins,
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
    agent_id: Optional[str] = None  # if set, inject instructions + vector context

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
    Returns the response from WebAI-to-API including status.
    """
    logger.info(f"=== Creating WebAI client for user_id: {user_id} ===")
    logger.info(f"WebAI-to-API URL: {WEBAI_URL}/internal/gemini/create")
    logger.info(f"Request body: user_id={user_id}, psid_length={len(psid)}, psidts_length={len(psidts)}")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            logger.info(f"Sending POST request to WebAI-to-API internal endpoint")
            response = await client.post(
                f"{WEBAI_URL}/internal/gemini/create",
                json={"user_id": str(user_id), "psid": psid, "psidts": psidts},
                headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
            )
            logger.info(f"WebAI-to-API response status: {response.status_code}")
            logger.info(f"WebAI-to-API response body: {response.text}")
            
            if response.status_code != 200:
                logger.error(f"WebAI client creation failed for user_id {user_id}: {response.text}")
                raise HTTPException(
                    status_code=500,
                    detail=f"WebAI-to-API failed to create client: {response.text}"
                )
            
            # Parse and return the response
            result = response.json()
            logger.info(f"WebAI client creation result for user_id {user_id}: {result}")
            return result
    except Exception as e:
        logger.exception(f"Exception during WebAI client creation for user_id {user_id}")
        raise


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


# GET /health/nats — NATS connection status
@app.get("/health/nats")
def health_nats():
    connected = get_nats_status()
    return {
        "nats_connected": connected,
        "status": "ok" if connected else "degraded",
        "message": "NATS connected" if connected else "NATS disconnected — user sync paused"
    }


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

    token = create_token(row["id"], data.email, "user")
    logger.info(f"Registration successful for email: {data.email}")
    return {"success": True, "token": token, "email": data.email, "role": "user"}


# POST /auth/login
@app.post("/auth/login")
async def login(data: LoginInput):
    """
    Proxy login request to pizzasys and return its Sanctum token directly.
    The frontend stores and uses this Sanctum token for all subsequent requests
    (both to pizzasys and to this bridge).
    """
    from auth import LARAVEL_AUTH_URL
    if not LARAVEL_AUTH_URL:
        raise HTTPException(status_code=503, detail="Auth service not configured (LARAVEL_AUTH_URL missing)")

    logger.info(f"Login proxy for: {data.email}")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                LARAVEL_AUTH_URL,
                json={"email": data.email, "password": data.password},
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Auth service unreachable")

    if resp.status_code == 422:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail="Auth service error")

    return resp.json()


# GET /auth/me
@app.get("/auth/me", dependencies=[Depends(get_current_user)])
def me(user = Depends(get_current_user)):
    """
    Return the currently logged-in user's info.
    React calls this on load to check if the token is still valid.
    Laravel equivalent: AuthController@me
    """
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": user["role"]
    }


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
    logger.info(f"=== Manual cookie save requested for user_id: {user['user_id']} ===")

    if len(data.psid) < 10:
        logger.warning("psid validation failed: too short")
        raise HTTPException(status_code=422, detail="psid looks too short")
    if len(data.psidts) < 10:
        logger.warning("psidts validation failed: too short")
        raise HTTPException(status_code=422, detail="psidts looks too short")

    # Save encrypted cookies to database
    try:
        logger.info(f"Saving cookies to database for user_id: {user['user_id']}")
        save_cookies(user["user_id"], data.psid.strip(), data.psidts.strip())
        logger.info(f"Cookies saved to database successfully for user_id: {user['user_id']}")
    except Exception as e:
        logger.exception("Failed to save cookies to database")
        raise HTTPException(status_code=500, detail=f"Could not save cookies: {str(e)}")

    # Tell WebAI-to-API to create a Gemini client for this user
    logger.info(f"About to call create_webai_client_for_user for user_id: {user['user_id']}")
    result = await create_webai_client_for_user(user["user_id"], data.psid.strip(), data.psidts.strip())

    # Verify the client was actually authenticated
    if not result.get("success"):
        logger.error(f"WebAI-to-API client creation failed for user_id: {user['user_id']}, status: {result.get('status')}")
        raise HTTPException(
            status_code=400,
            detail=f"Gemini authentication failed: {result.get('message', 'Unknown error')}"
        )

    logger.info(f"=== Manual cookie save completed for user_id: {user['user_id']} ===")
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
    logger.info(f"=== Chat Request Start ===")
    logger.info(f"User ID: {user['user_id']}")
    logger.info(f"Model: {data.model}")
    logger.info(f"Message length: {len(data.message)}")
    if not has_cookies(user["user_id"]):
        raise HTTPException(status_code=400, detail="Connect your Gemini account first")
    user_id = str(user["user_id"])
    model = data.model
    messages = [{"role": "user", "content": data.message}]

    # ─── Agent injection ────────────────────────────────────────────
    if data.agent_id:
        conn = get_connection()
        cursor = conn.cursor()

        # Check user is assigned to this agent
        cursor.execute("""
            SELECT a.instructions, a.model
            FROM agents a
            JOIN user_agents ua ON ua.agent_id = a.id
            WHERE a.id = %s AND ua.user_id = %s AND a.is_active = true
        """, (data.agent_id, user["user_id"]))
        agent_row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not agent_row:
            raise HTTPException(status_code=403, detail="Agent not assigned to you or does not exist")

        # Use the agent's model
        model = agent_row["model"]

        # Vector search — get top 5 relevant chunks
        relevant_chunks = await search_chunks(data.agent_id, data.message, limit=5)
        logger.info(f"Chat context: agent={data.agent_id}, chunks_injected={len(relevant_chunks)}")
        if not relevant_chunks:
            logger.warning("Chat context: NO document chunks found — AI will answer from general knowledge only")

        # Build system prompt
        system_parts = [agent_row["instructions"]]
        if relevant_chunks:
            system_parts.append("\n\n--- Relevant Knowledge ---")
            for i, chunk in enumerate(relevant_chunks, 1):
                logger.info(f"  chunk[{i}]: {chunk[:80]}...")
                system_parts.append(f"[{i}] {chunk}")

        system_prompt = "\n".join(system_parts)
        messages = [{"role": "system", "content": system_prompt}] + messages
    # ────────────────────────────────────────────────────────────────

    request_body = {
        "model": model,
        "stream": True,
        "messages": messages
    }
    logger.info(f"Request URL: {WEBAI_URL}/v1/chat/completions")
    logger.info(f"Headers: Content-Type=application/json, X-Internal-Key=***, X-Internal-User-ID={user_id}")
    logger.info(f"Request body: {json.dumps(request_body)}")
    logger.info(f"=== Sending to WebAI-to-API ===")

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
                    logger.info(f"WebAI-to-API response status: {response.status_code}")
                    logger.info(f"WebAI-to-API response headers: {dict(response.headers)}")
                    
                    if response.status_code != 200:
                        logger.error(f"WebAI chat failed with status {response.status_code}")
                        error = await response.aread()
                        logger.error(f"WebAI-to-API error body: {error.decode()}")
                        logger.error(f"Full error details: status={response.status_code}, body={error.decode()}")
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


# ----------------------------------------------------------------
# Conversation Management Routes
# ----------------------------------------------------------------

# GET /api/conversations - List user's conversations
@app.get("/api/conversations", dependencies=[Depends(get_current_user)])
def list_conversations(
    limit: int = 20,
    offset: int = 0,
    user = Depends(get_current_user)
):
    """
    List all conversations for the authenticated user with pagination.
    """
    conversations, total = get_conversations(user["user_id"], limit, offset)
    return {
        "success": True,
        "conversations": conversations,
        "total": total
    }

# POST /api/conversations - Create new conversation
@app.post("/api/conversations", dependencies=[Depends(get_current_user)])
def create_new_conversation(
    data: ConversationCreate,
    user = Depends(get_current_user)
):
    """
    Create a new conversation session.
    """
    conversation = create_conversation(
        user["user_id"],
        data.title or "New Conversation",
        data.model,
        data.agent_id
    )
    return {
        "success": True,
        "conversation": conversation
    }

# GET /api/conversations/{id} - Get specific conversation
@app.get("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def get_conversation_detail(
    conversation_id: UUID,
    user = Depends(get_current_user)
):
    """
    Get a specific conversation with its messages.
    """
    conversation = get_conversation(str(conversation_id), user["user_id"])
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Get messages for this conversation
    messages, _ = get_messages(str(conversation_id), user["user_id"])
    
    return {
        "success": True,
        "conversation": conversation,
        "messages": messages
    }

# PUT /api/conversations/{id} - Update conversation
@app.put("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def update_conversation_endpoint(
    conversation_id: UUID,
    data: ConversationUpdate,
    user = Depends(get_current_user)
):
    """
    Update conversation title or model.
    """
    conversation = update_conversation(
        str(conversation_id),
        user["user_id"],
        data.title,
        data.model
    )
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "success": True,
        "conversation": conversation
    }

# DELETE /api/conversations/{id} - Delete conversation
@app.delete("/api/conversations/{conversation_id}", dependencies=[Depends(get_current_user)])
def delete_conversation_endpoint(
    conversation_id: UUID,
    user = Depends(get_current_user)
):
    """
    Delete a specific conversation.
    """
    deleted = delete_conversation(str(conversation_id), user["user_id"])
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"success": True, "message": "Conversation deleted"}

# DELETE /api/conversations - Delete all conversations
@app.delete("/api/conversations", dependencies=[Depends(get_current_user)])
def delete_all_conversations_endpoint(user = Depends(get_current_user)):
    """
    Delete all conversations for the authenticated user.
    """
    deleted_count = delete_all_conversations(user["user_id"])
    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} conversations"
    }


# ----------------------------------------------------------------
# Message Management Routes
# ----------------------------------------------------------------

# POST /api/conversations/{id}/messages - Send message in conversation
@app.post("/api/conversations/{conversation_id}/messages", dependencies=[Depends(get_current_user)])
async def send_message(
    conversation_id: UUID,
    data: MessageCreate,
    user = Depends(get_current_user)
):
    """
    Send a message in a conversation and stream the response.
    Saves both user message and assistant response to database.
    """
    conversation_id_str = str(conversation_id)

    # Verify conversation belongs to user
    conversation = get_conversation(conversation_id_str, user["user_id"])
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # No Gemini connected → clear error before we save anything or stream
    if not has_cookies(user["user_id"]):
        raise HTTPException(status_code=400, detail="Connect your Gemini account first")

    # Save user message to database
    create_message(conversation_id_str, "user", data.message)

    # Stream response from WebAI-to-API (similar to existing /api/chat)
    model = data.model or conversation["model"]
    user_id_str = str(user["user_id"])
    messages = [{"role": "user", "content": data.message}]

    # ── Agent injection + vector search ──────────────────────────────
    logger.info(f"send_message: user={user['user_id']} agent_id={data.agent_id!r} msg='{data.message[:60]}'")
    if data.agent_id:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT a.instructions, a.model
            FROM agents a
            JOIN user_agents ua ON ua.agent_id = a.id
            WHERE a.id = %s AND ua.user_id = %s AND a.is_active = true
        """, (data.agent_id, user["user_id"]))
        agent_row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not agent_row:
            logger.warning(f"send_message: agent {data.agent_id} not found or not assigned to user {user['user_id']}")
        else:
            model = agent_row["model"]
            relevant_chunks = await search_chunks(data.agent_id, data.message, limit=5)
            logger.info(f"send_message: chunks_injected={len(relevant_chunks)}")
            if not relevant_chunks:
                logger.warning("send_message: NO chunks found — AI answers from general knowledge only")

            system_parts = [agent_row["instructions"]]
            if relevant_chunks:
                system_parts.append("\n\n--- Relevant Knowledge ---")
                for i, chunk in enumerate(relevant_chunks, 1):
                    logger.info(f"  chunk[{i}]: {chunk[:100]}...")
                    system_parts.append(f"[{i}] {chunk}")

            messages = [{"role": "system", "content": "\n".join(system_parts)}] + messages
    else:
        logger.info("send_message: no agent_id — sending without document context")
    # ─────────────────────────────────────────────────────────────────

    request_body = {
        "model": model,
        "stream": True,
        "messages": messages
    }
    
    async def stream_from_webai():
        assistant_content = ""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{WEBAI_URL}/v1/chat/completions",
                    json=request_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Key": WEBAI_INTERNAL_KEY,
                        "X-Internal-User-ID": user_id_str,
                    }
                ) as response:
                    if response.status_code != 200:
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
                            # Extract content for saving to database
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    data_json = json.loads(line[6:])
                                    if "choices" in data_json and len(data_json["choices"]) > 0:
                                        delta = data_json["choices"][0].get("delta", {})
                                        if "content" in delta:
                                            assistant_content += delta["content"]
                                except:
                                    pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Save assistant message to database after streaming completes
            if assistant_content:
                create_message(conversation_id_str, "assistant", assistant_content)
    
    return StreamingResponse(
        stream_from_webai(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

# GET /api/conversations/{id}/messages - Get conversation messages
@app.get("/api/conversations/{conversation_id}/messages", dependencies=[Depends(get_current_user)])
def list_messages(
    conversation_id: UUID,
    limit: int = 50,
    offset: int = 0,
    user = Depends(get_current_user)
):
    """
    Get messages for a conversation with pagination.
    """
    messages, total = get_messages(str(conversation_id), user["user_id"], limit, offset)
    return {
        "success": True,
        "messages": messages,
        "total": total
    }

# DELETE /api/conversations/{id}/messages/{message_id} - Delete message
@app.delete("/api/conversations/{conversation_id}/messages/{message_id}", dependencies=[Depends(get_current_user)])
def delete_message_endpoint(
    conversation_id: UUID,
    message_id: UUID,
    user = Depends(get_current_user)
):
    """
    Delete a specific message from a conversation.
    """
    deleted = delete_message(str(message_id), user["user_id"])
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    
    return {"success": True, "message": "Message deleted"}


# ----------------------------------------------------------------
# Model Information Route
# ----------------------------------------------------------------

# GET /api/models - List available models
@app.get("/api/models", dependencies=[Depends(get_current_user)])
def list_models(user = Depends(get_current_user)):
    """
    List available Gemini models.
    In production, this could query WebAI-to-API for available models.
    """
    # Check if user has Gemini connection
    connected = has_cookies(user["user_id"])
    
    models = [
        {
            "id": "gemini-3-flash",
            "name": "Gemini 3 Flash",
            "description": "Fast and efficient — best for quick questions",
            "contextWindow": "1M tokens",
            "badge": "Fast",
            "available": connected
        },
        {
            "id": "gemini-3-flash-plus",
            "name": "Gemini 3 Flash+",
            "description": "Enhanced Flash with better accuracy",
            "contextWindow": "1M tokens",
            "badge": "Fast+",
            "available": connected
        },
        {
            "id": "gemini-3-pro",
            "name": "Gemini 3 Pro",
            "description": "Advanced model for complex tasks",
            "contextWindow": "2M tokens",
            "badge": "Pro",
            "available": connected
        },
        {
            "id": "gemini-3-pro-plus",
            "name": "Gemini 3 Pro+",
            "description": "Enhanced Pro with deeper reasoning",
            "contextWindow": "2M tokens",
            "badge": "Pro+",
            "available": connected
        },
        {
            "id": "gemini-3-flash-thinking",
            "name": "Gemini 3 Flash Thinking",
            "description": "Flash with step-by-step reasoning",
            "contextWindow": "1M tokens",
            "badge": "Thinking",
            "available": connected
        },
        {
            "id": "gemini-3-pro-advanced",
            "name": "Gemini 3 Pro Advanced",
            "description": "Most capable model — best for hard problems",
            "contextWindow": "2M tokens",
            "badge": "Advanced",
            "available": connected
        },
    ]
    
    return {
        "success": True,
        "models": models
    }


# ----------------------------------------------------------------
# User Profile Routes
# ----------------------------------------------------------------

# GET /api/user/profile - Get user profile
@app.get("/api/user/profile", dependencies=[Depends(get_current_user)])
def get_user_profile(user = Depends(get_current_user)):
    """
    Get user profile and preferences.
    """
    from database import get_connection
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Get user info
    cursor.execute(
        "SELECT id, email, created_at FROM users WHERE id = %s",
        (user["user_id"],)
    )
    user_row = cursor.fetchone()
    
    # Get user preferences
    cursor.execute(
        """SELECT default_model, theme FROM user_preferences WHERE user_id = %s""",
        (user["user_id"],)
    )
    pref_row = cursor.fetchone()
    
    cursor.close()
    conn.close()
    
    preferences = {}
    if pref_row:
        preferences = {
            "default_model": pref_row["default_model"],
            "theme": pref_row["theme"]
        }
    else:
        # Create default preferences
        preferences = {"default_model": "gemini-3-flash", "theme": "dark"}
        conn2 = get_connection()
        cursor2 = conn2.cursor()
        cursor2.execute(
            """INSERT INTO user_preferences (user_id, default_model, theme)
               VALUES (%s, %s, %s)""",
            (user["user_id"], "gemini-3-flash", "dark")
        )
        conn2.commit()
        cursor2.close()
        conn2.close()
    
    return {
        "success": True,
        "user": {
            "user_id": user_row["id"],
            "email": user_row["email"],
            "created_at": user_row["created_at"],
            "last_login": None,
            "preferences": preferences
        }
    }

# PUT /api/user/profile - Update user preferences
@app.put("/api/user/profile", dependencies=[Depends(get_current_user)])
def update_user_profile(
    data: UserPreferencesUpdate,
    user = Depends(get_current_user)
):
    """
    Update user preferences.
    """
    from database import get_connection
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Check if preferences exist
    cursor.execute(
        "SELECT id FROM user_preferences WHERE user_id = %s",
        (user["user_id"],)
    )
    existing = cursor.fetchone()
    
    if existing:
        # Update
        updates = []
        params = []
        
        if data.default_model:
            updates.append("default_model = %s")
            params.append(data.default_model)
        if data.theme:
            updates.append("theme = %s")
            params.append(data.theme)
        
        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(user["user_id"])
            
            cursor.execute(
                f"""UPDATE user_preferences
                   SET {', '.join(updates)}
                   WHERE user_id = %s""",
                params
            )
    else:
        # Create
        cursor.execute(
            """INSERT INTO user_preferences (user_id, default_model, theme)
               VALUES (%s, %s, %s)""",
            (user["user_id"], data.default_model or "gemini-3-flash", data.theme or "dark")
        )
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return {"success": True, "message": "Preferences updated"}

# POST /api/user/logout - Explicit logout + Gemini disconnect
@app.post("/api/user/logout", dependencies=[Depends(get_current_user)])
async def logout(user = Depends(get_current_user)):
    """
    Logout: clear JWT on frontend AND disconnect Gemini session.
    Reuses the same cleanup as DELETE /api/cookies.
    """
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    return {"success": True, "message": "Logged out successfully"}


# ----------------------------------------------------------------
# Enhanced Gemini Status Routes
# ----------------------------------------------------------------

# GET /api/gemini/status - Enhanced Gemini status
@app.get("/api/gemini/status", dependencies=[Depends(get_current_user)])
def gemini_status_enhanced(user = Depends(get_current_user)):
    """
    Get Gemini connection status with available models.
    """
    connected = has_cookies(user["user_id"])
    
    available_models = []
    if connected:
        available_models = ["gemini-3-flash", "gemini-3-pro"]
    
    return {
        "success": True,
        "connected": connected,
        "user_id": user["user_id"],
        "message": "Gemini connected" if connected else "No Gemini session found",
        "available_models": available_models
    }

# POST /api/gemini/disconnect - Disconnect Gemini (semantic alias)
@app.post("/api/gemini/disconnect", dependencies=[Depends(get_current_user)])
async def disconnect_gemini_semantic(user = Depends(get_current_user)):
    """
    Disconnect Gemini (semantic alias for DELETE /api/cookies).
    """
    delete_cookies(user["user_id"])
    await remove_webai_client_for_user(user["user_id"])
    
    return {"success": True, "message": "Gemini disconnected"}


# ----------------------------------------------------------------
# Debug Endpoints
# ----------------------------------------------------------------

# GET /api/debug/session-registry - Check if user session exists
@app.get("/api/debug/session-registry", dependencies=[Depends(get_current_user)])
async def check_session_registry(user = Depends(get_current_user)):
    """
    Check if user's session exists in WebAI-to-API session registry.
    Debug endpoint to troubleshoot session registry issues.
    """
    user_id = str(user["user_id"])
    logger.info(f"=== Debug: Checking session registry for user_id: {user_id} ===")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"Debug: Calling GET {WEBAI_URL}/internal/gemini/{user_id}")
            response = await client.get(
                f"{WEBAI_URL}/internal/gemini/{user_id}",
                headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
            )
            logger.info(f"Debug: Response status: {response.status_code}")
            logger.info(f"Debug: Response body: {response.text}")
            
            return {
                "user_id": user_id,
                "status": response.status_code,
                "body": response.text,
                "session_exists": response.status_code == 200
            }
    except Exception as e:
        logger.exception(f"Debug: Exception checking session registry for user_id {user_id}")
        return {
            "user_id": user_id,
            "error": str(e),
            "session_exists": False
        }


# ════════════════════════════════════════════════════════
# ADMIN — AGENT CRUD
# All require require_admin dependency
# ════════════════════════════════════════════════════════

@app.get("/admin/agents")
def admin_list_agents(user = Depends(require_admin)):
    """List all agents (active and inactive)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, description, instructions, model, is_active, created_by, created_at, updated_at
        FROM agents ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agents": [dict(r) for r in rows]}


@app.post("/admin/agents")
def admin_create_agent(data: AgentCreate, user = Depends(require_admin)):
    """Create a new agent."""
    conn = get_connection()
    cursor = conn.cursor()
    agent_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO agents (id, name, description, instructions, model, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, name, description, instructions, model, is_active, created_by, created_at, updated_at
    """, (agent_id, data.name, data.description, data.instructions, data.model, user["user_id"]))
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "agent": dict(row)}


@app.get("/admin/agents/{agent_id}")
def admin_get_agent(agent_id: str, user = Depends(require_admin)):
    """Get a single agent with full details including instructions."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM agents WHERE id = %s", (agent_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent": dict(row)}


@app.put("/admin/agents/{agent_id}")
def admin_update_agent(agent_id: str, data: AgentUpdate, user = Depends(require_admin)):
    """Update any field of an agent."""
    updates, params = [], []
    if data.name is not None:         updates.append("name = %s");         params.append(data.name)
    if data.description is not None:  updates.append("description = %s");  params.append(data.description)
    if data.instructions is not None: updates.append("instructions = %s"); params.append(data.instructions)
    if data.model is not None:        updates.append("model = %s");        params.append(data.model)
    if data.is_active is not None:    updates.append("is_active = %s");    params.append(data.is_active)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates.append("updated_at = NOW()")
    params.append(agent_id)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE agents SET {', '.join(updates)} WHERE id = %s RETURNING *",
        params
    )
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent": dict(row)}


@app.delete("/admin/agents/{agent_id}")
def admin_delete_agent(agent_id: str, user = Depends(require_admin)):
    """Soft-delete: set is_active = false. Does NOT remove data or chunks."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE agents SET is_active = false, updated_at = NOW() WHERE id = %s",
        (agent_id,)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "message": "Agent deactivated"}


# ════════════════════════════════════════════════════════
# ADMIN — DOCUMENT UPLOAD (vector ingestion)
# ════════════════════════════════════════════════════════

@app.post("/admin/agents/{agent_id}/documents")
async def admin_upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    user = Depends(require_admin)
):
    """
    Upload a document for an agent.
    Extracts text → chunks → embeds → stores in document_chunks.
    Supported: PDF, DOCX, TXT, MD
    """
    # Verify agent exists
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM agents WHERE id = %s", (agent_id,))
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Agent not found")
    cursor.close()
    conn.close()

    file_bytes = await file.read()
    try:
        text = extract_text(file.filename, file_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not text.strip():
        raise HTTPException(status_code=400, detail="Document appears to be empty or unreadable")

    result = await ingest_document(agent_id, file.filename, text)
    return {
        "success": True,
        **result,
        "message": f"Uploaded and indexed {result['stored']} chunks from '{file.filename}'"
    }


@app.get("/admin/agents/{agent_id}/documents")
def admin_list_documents(agent_id: str, user = Depends(require_admin)):
    """List all documents (grouped by filename) for an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT filename, COUNT(*) as chunk_count, MIN(created_at) as created_at
        FROM document_chunks
        WHERE agent_id = %s
        GROUP BY filename
        ORDER BY created_at DESC
    """, (agent_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agent_id": agent_id, "documents": [dict(r) for r in rows]}


@app.delete("/admin/agents/{agent_id}/documents/{filename}")
def admin_delete_document(agent_id: str, filename: str, user = Depends(require_admin)):
    """Delete all chunks for a specific filename from an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM document_chunks WHERE agent_id = %s AND filename = %s",
        (agent_id, filename)
    )
    deleted = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "deleted_chunks": deleted, "message": f"Removed '{filename}'"}


# ════════════════════════════════════════════════════════
# ADMIN — SUGGESTIONS (Gemini-generated starter questions)
# ════════════════════════════════════════════════════════

def _extract_completion_text(payload: dict) -> str:
    """Pull the assistant text out of a (non-streaming) chat completion response."""
    try:
        choices = payload.get("choices")
        if choices:
            msg = choices[0].get("message") or {}
            if msg.get("content"):
                return msg["content"]
            if choices[0].get("text"):
                return choices[0]["text"]
    except (AttributeError, IndexError, TypeError):
        pass
    # legacy {"response": "..."} shape
    if isinstance(payload.get("response"), str):
        return payload["response"]
    return ""


@app.post("/admin/agents/{agent_id}/suggestions/generate")
async def admin_generate_suggestions(agent_id: str, data: GenerateRequest, user = Depends(require_admin)):
    """
    Ask Gemini (using THIS admin's connected account) to write starter questions
    from the agent's uploaded documents. Returns the list — does NOT save it.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, instructions, model FROM agents WHERE id = %s", (agent_id,))
    agent = cursor.fetchone()
    cursor.close()
    conn.close()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    count = data.count or 6
    doc_text = rebuild_agent_document_text(agent_id)
    messages = build_suggestion_prompt(agent["name"], agent["instructions"], doc_text, count)

    user_id = str(user["user_id"])
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{WEBAI_URL}/v1/chat/completions",
                json={"model": agent["model"], "stream": False, "messages": messages},
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Key": WEBAI_INTERNAL_KEY,
                    "X-Internal-User-ID": user_id,
                },
            )
    except Exception:
        logger.exception("Suggestion generation: WebAI-to-API call failed")
        raise HTTPException(status_code=502, detail="Could not reach the Gemini service. Try again.")

    if resp.status_code != 200:
        logger.error(f"Suggestion generation failed: status={resp.status_code} body={resp.text[:300]}")
        raise HTTPException(
            status_code=502,
            detail="Gemini request failed. Make sure your Gemini account is connected, then try again."
        )

    text = _extract_completion_text(resp.json())
    questions = parse_questions(text, count)
    logger.info(f"Suggestions generated for agent={agent_id}: {len(questions)} questions")
    return {"success": True, "questions": questions}


@app.get("/admin/agents/{agent_id}/suggestions")
def admin_get_suggestions(agent_id: str, user = Depends(require_admin)):
    """Return the currently saved (approved) suggestions for an agent."""
    return {"success": True, "suggestions": get_saved_suggestions(agent_id)}


@app.put("/admin/agents/{agent_id}/suggestions")
def admin_save_suggestions(agent_id: str, data: SaveRequest, user = Depends(require_admin)):
    """Replace the saved suggestions with the admin-approved list."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM agents WHERE id = %s", (agent_id,))
    found = cursor.fetchone()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    count = replace_suggestions(agent_id, data.questions)
    return {"success": True, "count": count, "message": f"Saved {count} suggestion(s)"}


# ════════════════════════════════════════════════════════
# ADMIN — USER-AGENT ASSIGNMENT
# ════════════════════════════════════════════════════════

@app.get("/admin/agents/{agent_id}/users")
def admin_get_agent_users(agent_id: str, user = Depends(require_admin)):
    """List all users assigned to an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT u.id, u.email, u.role, ua.assigned_at
        FROM users u
        JOIN user_agents ua ON ua.user_id = u.id
        WHERE ua.agent_id = %s
        ORDER BY ua.assigned_at DESC
    """, (agent_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "users": [dict(r) for r in rows]}


class AssignUsersInput(BaseModel):
    user_ids: list   # list of integer user IDs

@app.post("/admin/agents/{agent_id}/users")
def admin_assign_users(agent_id: str, data: AssignUsersInput, user = Depends(require_admin)):
    """Assign one or more users to an agent. Skips duplicates."""
    conn = get_connection()
    cursor = conn.cursor()
    assigned = 0
    for uid in data.user_ids:
        try:
            cursor.execute("""
                INSERT INTO user_agents (user_id, agent_id)
                VALUES (%s, %s)
                ON CONFLICT (user_id, agent_id) DO NOTHING
            """, (uid, agent_id))
            assigned += cursor.rowcount
        except Exception:
            logger.exception(f"Failed to assign user {uid} to agent {agent_id}")
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True, "assigned": assigned, "message": f"Assigned {assigned} user(s)"}


@app.delete("/admin/agents/{agent_id}/users/{target_user_id}")
def admin_remove_user_from_agent(agent_id: str, target_user_id: int, user = Depends(require_admin)):
    """Remove a user's assignment from an agent."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM user_agents WHERE agent_id = %s AND user_id = %s",
        (agent_id, target_user_id)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"success": True, "message": "User removed from agent"}


# ════════════════════════════════════════════════════════
# ADMIN — USER MANAGEMENT
# ════════════════════════════════════════════════════════

@app.get("/admin/users")
def admin_list_users(user = Depends(require_admin)):
    """List all users (synced from NATS/Laravel)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, email, role, synced_at, created_at
        FROM users ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "users": [dict(r) for r in rows]}


class RoleUpdate(BaseModel):
    role: str

@app.put("/admin/users/{target_user_id}/role")
def admin_update_user_role(target_user_id: int, data: RoleUpdate, user = Depends(require_admin)):
    """
    Roles are managed in pizzasys, not here.
    This endpoint now returns a clear error so callers know where to go.
    """
    raise HTTPException(
        status_code=400,
        detail="Roles are managed in pizzasys. Use POST /api/v1/roles/assign in pizzasys to change user roles."
    )

    # Dead code kept for reference — remove once frontend is updated
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE users SET role = %s WHERE id = %s",
        (data.role, target_user_id)
    )
    found = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": f"Role updated to '{data.role}'"}


# ════════════════════════════════════════════════════════
# USER — AGENT DISCOVERY
# ════════════════════════════════════════════════════════

@app.get("/api/agents")
def user_list_my_agents(user = Depends(get_current_user)):
    """List agents assigned to the logged-in user. Instructions are hidden."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.name, a.description, a.model
        FROM agents a
        JOIN user_agents ua ON ua.agent_id = a.id
        WHERE ua.user_id = %s AND a.is_active = true
        ORDER BY a.name ASC
    """, (user["user_id"],))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return {"success": True, "agents": [dict(r) for r in rows]}


@app.get("/api/agents/{agent_id}")
def user_get_agent(agent_id: str, user = Depends(get_current_user)):
    """Get details of an agent assigned to this user. Instructions are hidden."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.name, a.description, a.model
        FROM agents a
        JOIN user_agents ua ON ua.agent_id = a.id
        WHERE a.id = %s AND ua.user_id = %s AND a.is_active = true
    """, (agent_id, user["user_id"]))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found or not assigned to you")
    return {"success": True, "agent": dict(row)}


@app.get("/api/agents/{agent_id}/suggestions")
def user_get_agent_suggestions(agent_id: str, user = Depends(get_current_user)):
    """Approved starter questions for an agent the logged-in user is assigned to."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 1
        FROM user_agents ua
        JOIN agents a ON a.id = ua.agent_id
        WHERE ua.agent_id = %s AND ua.user_id = %s AND a.is_active = true
    """, (agent_id, user["user_id"]))
    assigned = cursor.fetchone()
    cursor.close()
    conn.close()
    if not assigned:
        raise HTTPException(status_code=404, detail="Agent not found or not assigned to you")
    return {"success": True, "suggestions": get_saved_suggestions(agent_id)}


# ════════════════════════════════════════════════════════
# EMBEDDABLE CHAT WIDGETS
# ════════════════════════════════════════════════════════

async def _build_messages_with_context(agent_id: str, instructions: str, message: str) -> list:
    """Build the [system, user] messages for an agent, injecting vector context."""
    relevant_chunks = await search_chunks(agent_id, message, limit=5)
    system_parts = [instructions or ""]
    if relevant_chunks:
        system_parts.append("\n\n--- Relevant Knowledge ---")
        for i, chunk in enumerate(relevant_chunks, 1):
            system_parts.append(f"[{i}] {chunk}")
    system_prompt = "\n".join(system_parts)
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]


def _stream_webai(model: str, messages: list, user_id):
    """Stream a chat completion from WebAI-to-API using a user's Gemini client."""
    request_body = {"model": model, "stream": True, "messages": messages}
    uid = str(user_id)

    async def gen():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{WEBAI_URL}/v1/chat/completions",
                    json=request_body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Internal-Key": WEBAI_INTERNAL_KEY,
                        "X-Internal-User-ID": uid,
                    },
                ) as response:
                    if response.status_code != 200:
                        error = await response.aread()
                        yield f"data: {json.dumps({'error': error.decode()})}\n\n"
                        return
                    async for line in response.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            logger.exception("Embed chat streaming error")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Admin CRUD ──────────────────────────────────────────────────────────────

@app.get("/admin/embeds")
def admin_list_embeds(agent_id: str = None, user = Depends(require_admin)):
    return {"success": True, "embeds": list_embeds(agent_id)}


@app.post("/admin/embeds")
def admin_create_embed(data: EmbedCreate, user = Depends(require_admin)):
    # verify agent exists
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM agents WHERE id = %s", (data.agent_id,))
    found = cursor.fetchone()
    cursor.close()
    conn.close()
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    embed = create_embed(data.agent_id, user["user_id"], data.allowed_domains, data.config)
    return {"success": True, "embed": embed}


@app.get("/admin/embeds/{embed_id}")
def admin_get_embed(embed_id: str, user = Depends(require_admin)):
    embed = get_embed(embed_id)
    if not embed:
        raise HTTPException(status_code=404, detail="Embed not found")
    return {"success": True, "embed": embed}


@app.put("/admin/embeds/{embed_id}")
def admin_update_embed(embed_id: str, data: EmbedUpdate, user = Depends(require_admin)):
    embed = update_embed(embed_id, data.allowed_domains, data.config, data.is_active)
    if not embed:
        raise HTTPException(status_code=404, detail="Embed not found")
    return {"success": True, "embed": embed}


@app.delete("/admin/embeds/{embed_id}")
def admin_delete_embed(embed_id: str, user = Depends(require_admin)):
    if not soft_delete_embed(embed_id):
        raise HTTPException(status_code=404, detail="Embed not found")
    return {"success": True, "message": "Embed deactivated"}


# ─── Public bootstrap + chat (embed-granted, Sanctum-authenticated) ──────────

@app.get("/api/embeds/{embed_key}")
def embed_bootstrap(embed_key: str, request: Request, user = Depends(get_current_user)):
    """Load a widget's appearance + agent (no instructions). Origin-checked."""
    embed = get_embed_by_key(embed_key)
    if not embed or not embed["is_active"]:
        raise HTTPException(status_code=404, detail="Embed not found")
    if not origin_allowed(embed, request.headers.get("origin")):
        raise HTTPException(status_code=403, detail="Origin not allowed for this embed")

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT name, description, model FROM agents WHERE id = %s AND is_active = true",
        (embed["agent_id"],),
    )
    agent = cursor.fetchone()
    cursor.close()
    conn.close()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not available")

    return {
        "success": True,
        "agent": {"name": agent["name"], "description": agent["description"], "model": agent["model"]},
        "config": embed["config"],
        "suggestions": get_saved_suggestions(embed["agent_id"]),
    }


@app.post("/api/embeds/{embed_key}/chat")
async def embed_chat(embed_key: str, data: EmbedChatMessage, request: Request,
                     user = Depends(get_current_user)):
    """Embed-granted chat — the embed key is the permission (no user_agents check)."""
    embed = get_embed_by_key(embed_key)
    if not embed or not embed["is_active"]:
        raise HTTPException(status_code=404, detail="Embed not found")
    if not origin_allowed(embed, request.headers.get("origin")):
        raise HTTPException(status_code=403, detail="Origin not allowed for this embed")

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT instructions, model FROM agents WHERE id = %s AND is_active = true",
        (embed["agent_id"],),
    )
    agent = cursor.fetchone()
    cursor.close()
    conn.close()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not available")

    if not has_cookies(user["user_id"]):
        raise HTTPException(status_code=400, detail="Connect your Gemini account first")

    messages = await _build_messages_with_context(embed["agent_id"], agent["instructions"], data.message)
    return _stream_webai(agent["model"], messages, user["user_id"])
