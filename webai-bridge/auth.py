# auth.py

import os
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

from database import get_connection

load_dotenv()
logger = logging.getLogger("auth")

SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7   # 7 days — like "remember me"

# Full URL: http://<laravel-host>/api/v1/auth/login
LARAVEL_AUTH_URL = os.getenv("LARAVEL_AUTH_URL", "")

# Auth server (pizzasys) — token verification on every request
AUTH_SERVER_BASE_URL     = os.getenv("AUTH_SERVER_BASE_URL", "")
AUTH_SERVER_VERIFY_PATH  = os.getenv("AUTH_SERVER_VERIFY_PATH", "/api/v1/auth/token-verify")
AUTH_SERVER_SERVICE_NAME = os.getenv("AUTH_SERVER_SERVICE_NAME", "webai-bridge")
AUTH_SERVER_CALL_TOKEN   = os.getenv("AUTH_SERVER_CALL_TOKEN", "")

# Laravel role names that map to Bridge "admin"
ADMIN_ROLES = {"super-admin", "admin"}

# Password hasher — like Laravel's Hash facade (uses bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for Swagger UI integration
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(plain_password: str) -> str:
    """
    Hash a password.
    Laravel equivalent: Hash::make($password)

    Note: bcrypt has a 72-byte limit, so we truncate if necessary.
    """
    password_bytes = plain_password.encode('utf-8')
    if len(password_bytes) > 72:
        truncated_bytes = password_bytes[:72]
        # Try to decode, if it fails (mid-character), remove bytes from end until it works
        while len(truncated_bytes) > 0:
            try:
                truncated_password = truncated_bytes.decode('utf-8')
                break
            except UnicodeDecodeError:
                truncated_bytes = truncated_bytes[:-1]
        else:
            truncated_password = ""
    else:
        truncated_password = plain_password

    return pwd_context.hash(truncated_password)


def verify_password(plain_password: str, hashed: str) -> bool:
    """
    Check a password against its hash.
    Laravel equivalent: Hash::check($password, $hash)

    Note: bcrypt has a 72-byte limit, so we truncate if necessary.
    """
    password_bytes = plain_password.encode('utf-8')
    if len(password_bytes) > 72:
        truncated_bytes = password_bytes[:72]
        while len(truncated_bytes) > 0:
            try:
                truncated_password = truncated_bytes.decode('utf-8')
                break
            except UnicodeDecodeError:
                truncated_bytes = truncated_bytes[:-1]
        else:
            truncated_password = ""
    else:
        truncated_password = plain_password

    return pwd_context.verify(truncated_password, hashed)


# ─── pizzasys token verification (called on every request) ───────────────────

async def verify_with_pizzasys(token: str, method: str, path: str) -> Optional[dict]:
    """
    Call pizzasys POST /api/v1/auth/token-verify.
    Returns { external_id, email, roles } if valid, None otherwise.
    Only runs when AUTH_SERVER_BASE_URL and AUTH_SERVER_CALL_TOKEN are set.
    """
    if not AUTH_SERVER_BASE_URL or not AUTH_SERVER_CALL_TOKEN:
        return None

    endpoint = AUTH_SERVER_BASE_URL.rstrip("/") + "/" + AUTH_SERVER_VERIFY_PATH.lstrip("/")

    payload = {
        "service":       AUTH_SERVER_SERVICE_NAME,
        "token":         token,
        "method":        method.upper(),
        "path":          path,
        "route_name":    None,
        "store_context": {"path": {}, "query": {}, "body": {}, "header": {}},
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                endpoint,
                json=payload,
                headers={
                    "Authorization":  f"Bearer {AUTH_SERVER_CALL_TOKEN}",
                    "Accept":         "application/json",
                    "Content-Type":   "application/json",
                },
            )
        if not resp.is_success:
            logger.warning(
                f"pizzasys token-verify returned {resp.status_code} | "
                f"call_token_len={len(AUTH_SERVER_CALL_TOKEN)} "
                f"call_token_prefix={AUTH_SERVER_CALL_TOKEN[:8]!r} | "
                f"user_token_prefix={token[:8]!r} | "
                f"service={AUTH_SERVER_SERVICE_NAME} | "
                f"endpoint={endpoint}"
            )
            return None

        data = resp.json()
        logger.info(f"token-verify response: active={data.get('active')} authorized={data.get('ext', {}).get('authorized')} user_id={data.get('user', {}).get('id')}")
        if not data.get("active"):
            logger.warning(f"token-verify: active=false. Full response: {data}")
            return None
        if not data.get("ext", {}).get("authorized"):
            logger.warning(f"token-verify: active=true but authorized=false. ext={data.get('ext')}")
            return None

        user_obj = data.get("user", {})
        return {
            "external_id": int(user_obj.get("id", 0)),
            "email":       str(user_obj.get("email", "")),
            "roles":       data.get("roles", []),
            "permissions": data.get("permissions", []),
            "ext":         data.get("ext", {}),
        }
    except Exception:
        logger.exception("pizzasys token-verify call failed")
        return None


# ─── Laravel auth validation ──────────────────────────────────────────────────

async def validate_with_laravel(email: str, password: str) -> Optional[dict]:
    """
    Call Laravel POST /api/v1/auth/login with email + password.
    Parses the Sanctum response and maps the role to Bridge format.

    Returns: { "user_id": int, "email": str, "role": "admin"|"user" }
    Returns None if credentials are wrong (422).
    Raises HTTPException(503) if Laravel is unreachable.
    """
    if not LARAVEL_AUTH_URL:
        logger.warning("LARAVEL_AUTH_URL not set — falling back to local validation")
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                LARAVEL_AUTH_URL,
                json={"email": email, "password": password},
                headers={
                    # Required by Laravel's CorrelationIdMiddleware
                    "X-Correlation-Id": "webai-bridge",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                }
            )

        # 200 = valid credentials
        if resp.status_code == 200:
            data = resp.json()
            user = data.get("user", {})

            # Roles come as a list of objects: [{"id":1,"name":"admin","guard_name":"web"}]
            # Extract just the name strings
            laravel_roles = [r["name"] for r in user.get("roles", [])]

            # Map to Bridge role: "admin" or "user"
            bridge_role = "admin" if any(r in ADMIN_ROLES for r in laravel_roles) else "user"

            return {
                "user_id": user["id"],
                "email":   user["email"],
                "role":    bridge_role
            }

        # 422 = wrong credentials
        if resp.status_code == 422:
            logger.warning(f"Laravel rejected credentials for {email}")
            return None

        logger.error(f"Laravel auth returned unexpected status: {resp.status_code}")
        return None

    except httpx.ConnectError:
        logger.error(f"Cannot reach Laravel at {LARAVEL_AUTH_URL}")
        raise HTTPException(status_code=503, detail="Auth service unavailable")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Laravel auth validation failed")
        return None


# ─── JWT ──────────────────────────────────────────────────────────────────────

def create_token(user_id: int, email: str, role: str = "user") -> str:
    """Create a JWT. Includes role so frontend can gate routes."""
    payload = {
        "sub": str(user_id),    # "subject" = who this token is for
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Verify and decode a JWT token.
    Returns the payload dict if valid.
    Raises HTTPException if invalid or expired.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ─── FastAPI dependencies ─────────────────────────────────────────────────────

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
) -> dict:
    """
    Validate the bearer token.
    Mode 1 (preferred): calls pizzasys token-verify when AUTH_SERVER_* vars are set.
    Mode 2 (fallback):  decodes the bridge's own JWT when no auth server is configured.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # ── Mode 1: pizzasys token-verify ────────────────────────────────────────
    if AUTH_SERVER_BASE_URL and AUTH_SERVER_CALL_TOKEN:
        pizzasys_result = await verify_with_pizzasys(token, request.method, request.url.path)
        if not pizzasys_result:
            raise HTTPException(status_code=401, detail="Invalid or unauthorized token")

        pizzasys_id = pizzasys_result["external_id"]
        if not pizzasys_id:
            raise HTTPException(status_code=401, detail="Token missing user id")

        # Auto-upsert: no need to wait for NATS — token-verify already gave us the data
        roles = pizzasys_result.get("roles", [])
        bridge_role = "admin" if any(r in ADMIN_ROLES for r in roles) else "user"

        from database import upsert_user
        upsert_user(id=pizzasys_id, email=pizzasys_result["email"], role=bridge_role)

        return {
            "user_id":     pizzasys_id,
            "email":       pizzasys_result["email"],
            "role":        bridge_role,
            "roles":       roles,
            "permissions": pizzasys_result.get("permissions", []),
        }

    # ── Mode 2: decode bridge JWT (local-only fallback) ───────────────────────
    payload = decode_token(token)

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, role FROM users WHERE id = %s",
        (int(payload["sub"]),)
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    return {"user_id": row["id"], "email": row["email"], "role": row["role"]}


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Allows super-admin or admin roles. Use on /admin/* routes."""
    if not any(r in ADMIN_ROLES for r in user.get("roles", [])):
        # fallback: also accept the legacy role string for JWT-only mode
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_permission(permission: str):
    """
    Dependency factory for specific permission checks.

    Usage:
        @app.post("/admin/agents/{id}/documents")
        async def upload(user = Depends(require_permission("upload documents"))):
            ...
    """
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if permission not in user.get("permissions", []):
            raise HTTPException(
                status_code=403,
                detail=f"Missing permission: {permission}"
            )
        return user
    return dep
