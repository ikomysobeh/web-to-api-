# Error Analysis: UNAUTHENTICATED and Session Registry Not Initialized

## Problem Summary

The logs show two critical errors occurring in the multi-user WebAI-to-API system:

1. **UNAUTHENTICATED Status Error**: Gemini client creation fails with "Gemini client for user X has invalid status: UNAUTHENTICATED"
2. **Session Registry Not Initialized Error**: Chat requests fail with "Session registry is not initialized." (503 error)

## Error Timeline from Logs

### User 4 (Failed)
```
2026-06-08 16:17:37 - Creating WebAI client for user_id: 4
2026-06-08 16:17:41 - WARNING: Account status: UNAUTHENTICATED
2026-06-08 16:17:43 - SUCCESS: Gemini client initialized successfully
2026-06-08 16:17:43 - ERROR: Gemini client for user 4 has invalid status: UNAUTHENTICATED
2026-06-08 16:20:54 - Chat request fails: No Gemini session found for this user (401)
```

### User 5 (Partial Success then Failure)
```
2026-06-08 16:19:51 - Creating WebAI client for user_id: 5
2026-06-08 16:19:55 - WARNING: Account status: UNAUTHENTICATED
2026-06-08 16:19:56 - SUCCESS: Gemini client initialized successfully
2026-06-08 16:19:56 - ERROR: Gemini client for user 5 has invalid status: UNAUTHENTICATED

2026-06-08 16:20:39 - Retry: Creating WebAI client for user_id: 5
2026-06-08 16:20:44 - SUCCESS: Client for user 5 status: AVAILABLE
2026-06-08 16:20:44 - SUCCESS: Gemini client created successfully

2026-06-08 16:21:02 - Chat request fails: Session registry is not initialized (503)
2026-06-08 16:21:27 - Chat request fails: Session registry is not initialized (503)
```

## Root Cause Analysis

### Issue 1: UNAUTHENTICATED Status During Client Creation

**Location**: `WebAI-to-API/src/app/services/gemini_client_manager.py` (lines 58-63)

```python
status_name = "UNKNOWN"
if hasattr(client, "client") and hasattr(client.client, "account_status"):
    status_name = client.client.account_status.name

if status_name != "AVAILABLE":
    raise RuntimeError(f"Gemini client for user {user_id} has invalid status: {status_name}")
```

**Problem**: 
- The Gemini client initialization process from `gemini_webapi` library shows a race condition
- The client reports "UNAUTHENTICATED" initially during initialization
- But then reports "initialized successfully" shortly after
- The status check happens too early, before the authentication completes

**Evidence from logs**:
```
2026-06-08 16:17:41.604 - WARNING - Account status: UNAUTHENTICATED
2026-06-08 16:17:43.073 - SUCCESS - Gemini client initialized successfully.
```
The status changes from UNAUTHENTICATED to initialized within ~1.5 seconds, but the check happens before this completes.

### Issue 2: Session Registry Not Initialized (Critical Architecture Problem)

**Location**: `WebAI-to-API/src/app/services/providers/gemini/session_manager.py` (lines 402-430)

```python
async def init_session_managers():
    global _translate_session_manager, _gemini_chat_registry
    try:
        client = get_gemini_client()  # Gets GLOBAL client
        
        if _translate_session_manager is not None and _gemini_chat_registry is not None:
            _translate_session_manager.client = client
            await _gemini_chat_registry.update_client(client)
            return

        from app.services.providers.sqlite_repository import SQLiteConversationRepository
        repository = SQLiteConversationRepository(...)
        _translate_session_manager = SessionManager(client)
        _gemini_chat_registry = SessionRegistry(client, repository=repository)
```

**Location**: `WebAI-to-API/src/app/main.py` (lines 46-51)

```python
# Initialize session managers
try:
    await init_session_managers()
    logger.info("Session managers initialized for WebAI-to-API.")
except GeminiClientNotInitializedError as e:
    logger.warning(f"Session managers not initialized: {e}")
```

**Problem**: 
- The session registry is initialized **globally** with a **single** Gemini client
- In multi-user mode, each user has their own client stored in `gemini_client_manager._clients`
- The session registry (`_gemini_chat_registry`) is NOT updated when per-user clients are created
- When chat requests come in with `X-Internal-User-ID`, the adapter tries to use the session registry
- But the registry is either:
  - Not initialized at all (if global client failed)
  - Or initialized with the wrong client (global instead of per-user)

**Location**: `WebAI-to-API/src/app/services/providers/gemini/webapi_adapter.py` (lines 316-318)

```python
registry = get_gemini_chat_registry()
if not registry:
    raise HTTPException(status_code=503, detail="Session registry is not initialized.")
```

**Architecture Mismatch**:
```
Global Session Registry (single client)
    ↓
Used by chat endpoint for ALL users
    ↓
But each user has their own client in gemini_client_manager._clients
    ↓
Result: Registry doesn't have the right client for the user
```

## Why User 5 Succeeded Initially Then Failed

User 5's client creation eventually succeeded (status: AVAILABLE) because:
1. The authentication completed after a retry
2. The client was stored in `gemini_client_manager._clients["5"]`

But chat requests still failed because:
1. The session registry was never initialized with User 5's client
2. The registry either:
   - Doesn't exist (if global client never initialized)
   - Or has the global client (which may be UNAUTHENTICATED or for a different user)

## Fix Recommendations

### Fix 1: Add Retry/Wait for Authentication Status

**File**: `WebAI-to-API/src/app/services/gemini_client_manager.py`

**Change**: Add a retry loop with exponential backoff to wait for the client to reach AVAILABLE status:

```python
async def _create_client(user_id: str, psid: str, psidts: str):
    from app.services.providers.gemini.webapi_client import MyGeminiClient
    import asyncio

    gemini_proxy = CONFIG["Proxy"].get("http_proxy") or None
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

    # NEW: Retry loop to wait for AVAILABLE status
    max_retries = 10
    retry_delay = 1.0
    
    for attempt in range(max_retries):
        status_name = "UNKNOWN"
        if hasattr(client, "client") and hasattr(client.client, "account_status"):
            status_name = client.client.account_status.name
        
        if status_name == "AVAILABLE":
            break
            
        if attempt < max_retries - 1:
            logger.info(f"Attempt {attempt + 1}/{max_retries}: Client status is {status_name}, retrying in {retry_delay}s...")
            await asyncio.sleep(retry_delay)
            retry_delay *= 2  # Exponential backoff
        else:
            raise RuntimeError(f"Gemini client for user {user_id} has invalid status: {status_name} after {max_retries} attempts")

    logger.info(f"GeminiClientManager: Client for user {user_id} status: {status_name}")
    return client
```

### Fix 2: Per-User Session Registries (Recommended)

**File**: `WebAI-to-API/src/app/services/providers/gemini/session_manager.py`

**Change**: Replace the global session registry with a per-user registry:

```python
# Global instances
_translate_session_manager = None
_gemini_chat_registry = None  # Legacy: kept for backward compatibility
_per_user_registries: Dict[str, SessionRegistry] = {}  # NEW: user_id -> SessionRegistry
_registries_lock = asyncio.Lock()

async def get_or_create_user_registry(user_id: str, client) -> SessionRegistry:
    """Get or create a session registry for a specific user."""
    async with _registries_lock:
        if user_id in _per_user_registries:
            # Update client reference if needed
            await _per_user_registries[user_id].update_client(client)
            return _per_user_registries[user_id]
        
        # Create new registry for this user
        from app.services.providers.sqlite_repository import SQLiteConversationRepository
        repository = SQLiteConversationRepository(
            db_path=os.getenv("CONVERSATION_SNAPSHOT_DB", get_default_conversation_snapshot_db())
        )
        repository.initialize_sync()
        registry = SessionRegistry(client, repository=repository)
        _per_user_registries[user_id] = registry
        logger.info(f"Created new session registry for user {user_id}")
        return registry

async def get_user_registry(user_id: str) -> Optional[SessionRegistry]:
    """Get the session registry for a specific user."""
    async with _registries_lock:
        return _per_user_registries.get(user_id)
```

**File**: `WebAI-to-API/src/app/services/providers/gemini/webapi_adapter.py`

**Change**: Update `_get_available_gemini_client` to use per-user registry:

```python
async def chat_completions(self, request: OpenAIChatRequest, cid: str, is_new_conversation: bool, tools_prompt: str) -> Any:
    user_id = getattr(request, "_user_id", None)
    
    # Get the right client for this user
    gemini_client = self._get_available_gemini_client(user_id)
    
    # 1. Retrieve stateful SessionManager from SessionRegistry
    if user_id:
        # Multi-user path: use per-user registry
        from app.services.providers.gemini.session_manager import get_or_create_user_registry
        registry = await get_or_create_user_registry(user_id, gemini_client)
    else:
        # Legacy path: use global registry
        registry = get_gemini_chat_registry()
    
    if not registry or not registry.repository:
        raise HTTPException(status_code=503, detail="Session registry is not initialized.")
    
    # ... rest of the function
```

### Fix 3: Initialize Session Registry When Creating User Client

**File**: `WebAI-to-API/src/app/services/gemini_client_manager.py`

**Change**: Initialize the session registry when creating a user's client:

```python
async def get_or_create_client(user_id: str, psid: str, psidts: str):
    async with _lock:
        if user_id in _clients:
            logger.info(f"GeminiClientManager: Reusing existing client for user {user_id}")
            return _clients[user_id]

        logger.info(f"GeminiClientManager: Creating new Gemini client for user {user_id}")
        client = await _create_client(user_id, psid, psidts)
        _clients[user_id] = client
        
        # NEW: Initialize session registry for this user
        from app.services.providers.gemini.session_manager import get_or_create_user_registry
        await get_or_create_user_registry(user_id, client)
        
        return client
```

### Fix 4: Update Session Registry on Client Removal

**File**: `WebAI-to-API/src/app/services/gemini_client_manager.py`

**Change**: Clean up the session registry when removing a client:

```python
async def remove_client(user_id: str):
    async with _lock:
        if user_id in _clients:
            client = _clients.pop(user_id)
            try:
                if hasattr(client, "close"):
                    await client.close()
            except Exception as e:
                logger.warning(f"GeminiClientManager: Error closing client for user {user_id}: {e}")
            
            # NEW: Clean up session registry
            from app.services.providers.gemini.session_manager import _per_user_registries, _registries_lock
            async with _registries_lock:
                if user_id in _per_user_registries:
                    del _per_user_registries[user_id]
                    logger.info(f"GeminiClientManager: Session registry removed for user {user_id}")
            
            logger.info(f"GeminiClientManager: Client removed for user {user_id}")
```

## Summary

The errors occur due to two architectural issues:

1. **Race condition in client initialization**: The status check happens before authentication completes
2. **Global session registry mismatch**: The session registry is designed for a single global client, but multi-user mode requires per-user registries

The recommended fix is to implement per-user session registries (Fix 2) combined with retry logic for authentication (Fix 1). This ensures each user has their own session registry with their authenticated client, eliminating the "Session registry is not initialized" error.

## Priority

- **High**: Fix 2 (Per-user session registries) - This is the root cause of the 503 errors
- **High**: Fix 1 (Retry logic) - This will reduce the UNAUTHENTICATED failures
- **Medium**: Fix 3 (Initialize registry on client creation) - Ensures registries are created proactively
- **Medium**: Fix 4 (Cleanup on removal) - Prevents memory leaks
