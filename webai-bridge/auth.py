# auth.py

import os
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Security
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

from database import get_connection

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7   # 7 days — like "remember me"

# Password hasher — like Laravel's Hash facade (uses bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for Swagger UI integration
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


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


def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    """
    FastAPI Dependency — reads and validates the Authorization header.
    Uses oauth2_scheme for Swagger UI integration.

    Usage in a route:
        @app.get("/protected")
        def my_route(user = Depends(get_current_user)):
            print(user["user_id"])   # the logged-in user's ID

    Laravel equivalent:
        Route::middleware('auth:api')->group(...)
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

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
