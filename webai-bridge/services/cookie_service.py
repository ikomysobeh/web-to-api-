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
