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

        # Initialize per-user session registry immediately so chat requests don't race
        from app.services.providers.gemini.session_manager import get_or_create_user_registry
        await get_or_create_user_registry(user_id, client)

        return client


_MAX_INIT_RETRIES = 3
_RETRY_DELAY_SECONDS = 2.0


async def _create_client(user_id: str, psid: str, psidts: str):
    """
    Initialize a new Gemini client from scratch for one user.
    Retries with a fresh client instance on UNAUTHENTICATED — the gemini_webapi
    library can report UNAUTHENTICATED on a first init attempt even with valid
    cookies (internal token refresh), but a clean second instance succeeds.
    """
    from app.services.providers.gemini.webapi_client import MyGeminiClient

    gemini_proxy = CONFIG["Proxy"].get("http_proxy") or None
    last_status = "UNKNOWN"

    for attempt in range(1, _MAX_INIT_RETRIES + 1):
        # New unique_id per attempt = new temp path = clean library state
        unique_id = f"{user_id}_{os.getpid()}_{int(time.time())}_{attempt}"
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

        last_status = "UNKNOWN"
        if hasattr(client, "client") and hasattr(client.client, "account_status"):
            last_status = client.client.account_status.name

        if last_status == "AVAILABLE":
            logger.info(f"GeminiClientManager: Client for user {user_id} status: {last_status} (attempt {attempt})")
            return client

        logger.warning(f"GeminiClientManager: Attempt {attempt}/{_MAX_INIT_RETRIES} for user {user_id} — status: {last_status}")
        if attempt < _MAX_INIT_RETRIES:
            await asyncio.sleep(_RETRY_DELAY_SECONDS)

    raise RuntimeError(f"Gemini client for user {user_id} has invalid status: {last_status} after {_MAX_INIT_RETRIES} attempts")


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

            from app.services.providers.gemini.session_manager import remove_user_registry
            await remove_user_registry(user_id)

            logger.info(f"GeminiClientManager: Client removed for user {user_id}")


def list_active_users() -> list:
    """Return list of user IDs with active clients. For status/debug."""
    return list(_clients.keys())
