from fastapi import APIRouter, Response, status, HTTPException, Header
from typing import Optional
from pydantic import BaseModel
import os
from app.services.browser.engine import BrowserEngine
from app.services.browser.auth_manager import get_auth_manager

router = APIRouter(tags=["System"])

# This internal key protects these endpoints from public access
INTERNAL_KEY = os.getenv("WEBAI_INTERNAL_KEY", "")


class CreateClientInput(BaseModel):
    user_id: str
    psid: str
    psidts: str


def verify_internal_key(x_internal_key: Optional[str] = Header(None)):
    """
    Simple security check — only your bridge can call these endpoints.
    Like a middleware in Laravel that checks an API key.
    """
    if INTERNAL_KEY and x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Unauthorized internal request")

def get_existing_browser_engine() -> Optional[BrowserEngine]:
    """
    Non-initializing access to the BrowserEngine singleton.
    Safe for liveness probes to avoid triggering bootstrap.
    """
    return BrowserEngine._instance

@router.get(
    "/health",
    summary="Liveness Probe",
    description=(
        "Standard liveness check. Returns 200 if the application process is alive and "
        "the BrowserEngine is not in a terminal shutdown state. This endpoint is "
        "strictly side-effect-free and does not trigger browser initialization or recovery."
    ),
    responses={
        200: {"description": "Application is healthy and running."},
        503: {"description": "Application is in terminal shutdown state."}
    }
)
async def health():
    engine = get_existing_browser_engine()
    # If engine doesn't exist yet, it's 'alive' (it just hasn't been used)
    if engine and engine.is_shutting_down:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(status_code=status.HTTP_200_OK)

@router.get(
    "/ready",
    summary="Readiness Probe",
    description=(
        "Standard readiness check. Returns 200 only if the structural runtime is fully "
        "initialized and capable of accepting work. This includes verifying the browser "
        "process connectivity and session liveness. This endpoint is side-effect-free, "
        "does not validate authentication, and does not trigger recovery logic."
    ),
    responses={
        200: {"description": "Runtime is ready to accept requests."},
        503: {"description": "Runtime is not initialized, browser is disconnected, or no sessions are alive."}
    }
)
async def ready():
    engine = get_existing_browser_engine()
    
    # 1. If engine isn't initialized, we aren't structurally ready
    if not engine:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

    # 2. Engine must not be shutting down
    if engine.is_shutting_down:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        
    # 3. Browser must be connected
    if not engine.browser or not engine.browser.is_connected():
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        
    # 4. At least one session must be structurally alive
    # Lock-free check of existing sessions
    has_alive_session = False
    for session in engine.sessions.values():
        if session.is_alive:
            has_alive_session = True
            break
            
    if not has_alive_session:
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        
    return Response(status_code=status.HTTP_200_OK)

@router.get(
    "/v1/runtime/status",
    summary="Runtime Diagnostics",
    description=(
        "Returns a detailed diagnostic payload regarding the internal state of the "
        "hardened browser runtime. Includes engine status, browser generation, lease "
        "usage, and a cached summary of authentication status. This endpoint is "
        "strictly side-effect-free and does not refresh authentication or trigger recovery."
    )
)
async def runtime_status():
    engine = get_existing_browser_engine()
    auth_mgr = get_auth_manager()
    
    if not engine:
        return {
            "engine": {"status": "NOT_INITIALIZED"},
            "auth": auth_mgr.get_status()
        }

    # Side-effect free collection
    status_payload = {
        "engine": {
            "status": "SHUTTING_DOWN" if engine.is_shutting_down else "RUNNING",
            "browser_connected": engine.browser.is_connected() if engine.browser else False,
            "browser_generation": engine.browser_generation,
            "is_bootstrap": engine.is_bootstrap
        },
        "sessions": {},
        "auth": auth_mgr.get_status() # Cached only
    }
    
    for name, session in engine.sessions.items():
        status_payload["sessions"][name] = {
            "is_alive": session.is_alive,
            "metrics": session.metrics,
            "is_recovering": session._recovery_task is not None
        }

    return status_payload


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


# POST /internal/gemini/create
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
