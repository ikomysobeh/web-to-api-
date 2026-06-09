# Fix Guide: UNAUTHENTICATED + Session Registry Errors

## My Assessment of the Previous Analysis (ERROR_ANALYSIS_AND_FIX.md)

The previous analysis is **mostly correct** on root causes but **overly complex** in its proposed fixes. The per-user registry approach is right, but Fix 3 and Fix 4 are unnecessary complexity — they can be collapsed into Fix 2.

There is also one thing the previous doc **missed**: Issue 1 (UNAUTHENTICATED) is not purely a race condition — it is a `gemini_webapi` library behavior where cookies are valid but the first init attempt returns UNAUTHENTICATED, and a **clean re-init** (no shared state from first attempt) succeeds. User 5 succeeded on second try with **identical cookies**, 44 seconds later. The fix must destroy the first client attempt and create a fresh one, not just wait and re-check status on the same object.

---

## What is Actually Happening (Step by Step)

### Error 1: UNAUTHENTICATED (returns `success: false`)

**Flow:**
1. Bridge calls `POST /internal/gemini/create`
2. `get_or_create_client()` → `_create_client()` → `client.init()`
3. `gemini_webapi` internally calls `_fetch_user_status` → logs **WARNING: UNAUTHENTICATED**
4. `init()` still returns (it does not raise on UNAUTHENTICATED)
5. Status check: `client.client.account_status.name` → `"UNAUTHENTICATED"` → `RuntimeError` raised
6. Exception caught in `system.py:create_user_client` → returns `{"success": false, "status": "FAILED"}`
7. Bridge sees `success: false` → returns **400** to the frontend

**Why second attempt for user 5 worked:**
The second attempt created a completely **new** `MyGeminiClient` instance with a **fresh environment** (new `unique_id` for the temp path). The `gemini_webapi` library has an internal token-refresh mechanism — the first init triggers a refresh (hence the UNAUTHENTICATED warning), but a second fresh init picks up the refreshed state. This is library behavior, not a timing race.

**Affected file:** `WebAI-to-API/src/app/services/gemini_client_manager.py`

---

### Error 2: "Session registry is not initialized" (503)

**Flow:**
1. Bridge calls `POST /v1/chat/completions` with `X-Internal-User-ID: 5`
2. `chat_completions()` in `webapi_adapter.py:313` calls `_get_available_gemini_client("5")` → succeeds (user 5 has a client)
3. Line 316: `registry = get_gemini_chat_registry()` → returns **`None`**
4. → raises `HTTPException(503, "Session registry is not initialized.")`

**Why is the global registry `None`?**

`init_session_managers()` in `session_manager.py` calls `get_gemini_client()` which returns the **global singleton client** from `app.services.providers.gemini.client`. In multi-user Docker mode, the global client is never initialized (no cookies in `config.conf` for the global client). So `init_session_managers()` catches `GeminiClientNotInitializedError` and silently skips — `_gemini_chat_registry` stays `None` forever.

Meanwhile, per-user clients exist in `gemini_client_manager._clients`, but **nobody ever creates a registry for them**.

**Affected files:**
- `WebAI-to-API/src/app/services/providers/gemini/webapi_adapter.py` (line 316)
- `WebAI-to-API/src/app/services/providers/gemini/session_manager.py` (global registry assumption)
- `WebAI-to-API/src/app/services/gemini_client_manager.py` (never initializes a registry)

---

## What Needs to Change

### Change 1 — `gemini_client_manager.py`: Retry with fresh client on UNAUTHENTICATED

The current code fails fast on UNAUTHENTICATED. Instead, retry up to N times, each time creating a **completely new** `MyGeminiClient` instance (fresh temp path).

```python
# In _create_client(), replace the status check block at lines 58-65 with:

MAX_INIT_RETRIES = 3
RETRY_DELAY_SECONDS = 2.0

async def _create_client(user_id: str, psid: str, psidts: str):
    from app.services.providers.gemini.webapi_client import MyGeminiClient
    import asyncio

    gemini_proxy = CONFIG["Proxy"].get("http_proxy") or None

    last_status = "UNKNOWN"
    for attempt in range(1, MAX_INIT_RETRIES + 1):
        # New unique_id per attempt = new temp path = clean state
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

        logger.warning(f"GeminiClientManager: Attempt {attempt}/{MAX_INIT_RETRIES} for user {user_id} — status: {last_status}")
        if attempt < MAX_INIT_RETRIES:
            await asyncio.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(f"Gemini client for user {user_id} has invalid status: {last_status} after {MAX_INIT_RETRIES} attempts")
```

**Why fresh instance per retry:** The old code retried on the same object (`client`). The `gemini_webapi` library stores internal state in the client object after the first `init()`. A fresh object with a new temp path avoids polluting state from the UNAUTHENTICATED attempt.

---

### Change 2 — `session_manager.py`: Add per-user registry support

Add a `_per_user_registries` dict and two helper functions. Keep all existing global code intact (backward compatibility with legacy single-user mode).

```python
# Add near line 399, after the global declarations:

_per_user_registries: Dict[str, "SessionRegistry"] = {}
_per_user_registries_lock = asyncio.Lock()


async def get_or_create_user_registry(user_id: str, client) -> "SessionRegistry":
    """Get existing or create new SessionRegistry for one user."""
    async with _per_user_registries_lock:
        if user_id in _per_user_registries:
            await _per_user_registries[user_id].update_client(client)
            return _per_user_registries[user_id]

        from app.services.providers.sqlite_repository import SQLiteConversationRepository
        repository = SQLiteConversationRepository(
            db_path=os.getenv("CONVERSATION_SNAPSHOT_DB", get_default_conversation_snapshot_db())
        )
        repository.initialize_sync()
        registry = SessionRegistry(client, repository=repository)
        _per_user_registries[user_id] = registry
        logger.info(f"SessionManager: Created registry for user {user_id}")
        return registry


def get_user_registry(user_id: str) -> Optional["SessionRegistry"]:
    """Return existing registry for a user, or None."""
    return _per_user_registries.get(user_id)


async def remove_user_registry(user_id: str) -> None:
    """Clean up a user's registry on disconnect."""
    async with _per_user_registries_lock:
        _per_user_registries.pop(user_id, None)
        logger.info(f"SessionManager: Registry removed for user {user_id}")
```

---

### Change 3 — `gemini_client_manager.py`: Initialize registry after client creation

In `get_or_create_client()`, after successfully creating a client, immediately create its registry. This ensures the registry always exists by the time a chat request arrives.

```python
# In get_or_create_client(), replace lines 30-31:

        client = await _create_client(user_id, psid, psidts)
        _clients[user_id] = client

        # Initialize per-user session registry immediately
        from app.services.providers.gemini.session_manager import get_or_create_user_registry
        await get_or_create_user_registry(user_id, client)

        return client
```

Also update `remove_client()` to clean up the registry on disconnect:

```python
# In remove_client(), after the close() call:

            # Clean up per-user session registry
            from app.services.providers.gemini.session_manager import remove_user_registry
            await remove_user_registry(user_id)
```

---

### Change 4 — `webapi_adapter.py`: Use per-user registry when user_id is present

In `chat_completions()`, replace the global registry lookup (lines 316-318) with a per-user aware lookup:

```python
# Replace lines 315-318:
        # 1. Retrieve stateful SessionManager from SessionRegistry
        registry = get_gemini_chat_registry()
        if not registry:
            raise HTTPException(status_code=503, detail="Session registry is not initialized.")

# With:
        # 1. Retrieve stateful SessionManager from SessionRegistry
        if user_id:
            from app.services.providers.gemini.session_manager import get_user_registry
            registry = get_user_registry(user_id)
        else:
            registry = get_gemini_chat_registry()

        if not registry:
            raise HTTPException(status_code=503, detail="Session registry is not initialized.")
```

That's the only place in `chat_completions` that needs changing. The `registry.save_session_snapshot()` calls on lines 365 and 386 use the same `registry` local variable, so they automatically use the correct per-user registry.

---

## Summary Table

| # | File | Lines | Change | Fixes |
|---|------|-------|--------|-------|
| 1 | `gemini_client_manager.py` | `_create_client` | Retry loop with fresh client instance per attempt | UNAUTHENTICATED (Error 1) |
| 2 | `session_manager.py` | After line 400 | Add `_per_user_registries` dict + 3 helper functions | Infrastructure for Error 2 |
| 3 | `gemini_client_manager.py` | `get_or_create_client`, `remove_client` | Init registry after client creation; remove on disconnect | Error 2 + no memory leaks |
| 4 | `webapi_adapter.py` | Lines 315-318 in `chat_completions` | Use per-user registry when `user_id` is set | "Session registry not initialized" (Error 2) |

**Total: ~35 lines changed across 3 files.**

---

## What to NOT Do

- **Do not** share one `SessionRegistry` across multiple users. The registry holds in-memory `SessionManager` objects, each of which holds a `GeminiClient` reference. Cross-user contamination would cause one user's chat to use another's session.
- **Do not** initialize the global session registry with a user's client as a workaround. `delete_conversations` and `list_conversations` in `webapi_adapter.py` use `get_gemini_chat_registry()` directly without checking `user_id`, which would break if we repurpose the global.
- **Do not** add the retry delay inside the status-check loop without creating a new client — re-checking the same object's `account_status` after sleeping won't change the state.

---

## Minor Issue (Non-blocking)

The bcrypt warning in the logs:
```
AttributeError: module 'bcrypt' has no attribute '__about__'
```
This is a `passlib` compatibility warning with newer versions of `bcrypt` (≥ 4.0). It does not break hashing. Fix by pinning `bcrypt==4.0.1` in `webai-bridge/requirements.txt`, or by upgrading `passlib` to a version that handles the new bcrypt API. Not urgent — it's logged as WARNING and registration succeeds.
