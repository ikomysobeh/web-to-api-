# /api/chat Endpoint Problem Analysis

> Analysis of the "Session registry is not initialized" error when calling the `/api/chat` endpoint.

---

## Problem Description

**Error Message:**
```
{"error": "{\"detail\":\"Session registry is not initialized.\"}"}
Status: 200 (but error in response body)
```

**Endpoint Called:** `POST /api/chat`

**Request Headers:**
```
Authorization: Bearer {token}
Content-Type: application/json
```

---

## Current State of `/api/chat` Endpoint

**Location:** `main.py` lines 434-487

**Current Implementation:**
```python
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
                        "X-Internal-User-ID": user_id,   # ← Header IS present
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
```

**Key Observation:** The `X-Internal-User-ID` header IS being sent (line 463).

---

## Root Cause Analysis

Since the `X-Internal-User-ID` header is present, the error "Session registry is not initialized" means:

**WebAI-to-API is not configured to use the session registry feature.**

The session registry is a feature in WebAI-to-API that:
1. Stores per-user Gemini clients in memory
2. Allows routing requests to specific user clients via `X-Internal-User-ID` header
3. Must be explicitly enabled/configured in WebAI-to-API

---

## Possible Causes

### 1. Session Registry Not Enabled in WebAI-to-API

WebAI-to-API may need configuration to enable the session registry. Check:
- WebAI-to-API config file for session registry settings
- Environment variables for session registry
- WebAI-to-API version supports session registry

### 2. User Client Not Created in Session Registry

Before calling `/api/chat`, the user must:
1. Save cookies via `POST /api/cookies`
2. This calls `create_webai_client_for_user()` which creates the client in WebAI-to-API
3. If this step was skipped or failed, no client exists in the registry

### 3. WebAI-to-API Internal Endpoints Not Available

The session registry depends on these internal endpoints:
- `POST /internal/gemini/create` - Create user client
- `DELETE /internal/gemini/{user_id}` - Remove user client

If these endpoints don't exist or return errors, the session registry won't work.

---

## Verification Steps

### Step 1: Check if User Has Saved Cookies

Call `GET /api/cookies/status` to verify cookies are saved:
```bash
curl -X GET http://localhost:8000/api/cookies/status \
  -H "Authorization: Bearer {token}"
```

Expected response:
```json
{
  "connected": true,
  "message": "Gemini connected"
}
```

If `connected: false`, cookies need to be saved first.

### Step 2: Check WebAI-to-API Logs

Check WebAI-to-API container logs for:
- Session registry initialization errors
- Internal endpoint errors
- Configuration issues

### Step 3: Check WebAI-to-API Configuration

Review WebAI-to-API config file at `../WebAI-to-API/config.conf`:
- Look for session registry settings
- Check if multi-user support is enabled
- Verify internal API key is correct

---

## WebAI-to-API Configuration Analysis

From `WebAI-to-API/config.conf.example`:

**Relevant Settings:**
```ini
[Playwright]
auth_lock_backend = in_memory
max_persistent_conversations = 20
```

**Missing:** No explicit session registry configuration found in example config.

This suggests the session registry may:
- Not be a standard feature
- Require specific configuration not in the example
- Be part of a different WebAI-to-API version

---

## Potential Solutions

### Solution 1: Use Global Client (No Session Registry)

If session registry is not available, modify `/api/chat` to use the global Gemini client:

**Remove the `X-Internal-User-ID` header:**
```python
headers={
    "Content-Type": "application/json",
    "X-Internal-Key": WEBAI_INTERNAL_KEY,
    # Remove: "X-Internal-User-ID": user_id,
}
```

**Implication:** All users share the same Gemini client (not multi-user safe).

### Solution 2: Enable Session Registry in WebAI-to-API

Check WebAI-to-API documentation for:
- How to enable session registry
- Required configuration settings
- Version compatibility

### Solution 3: Use Config File Instead of Session Registry

Modify cookie save to write to WebAI-to-API config file (old method):
```python
write_cookies_to_config(psid, psidts)
await reinit_webai_client()
```

**Implication:** Only one user can be connected at a time (global config).

---

## Current Flow Analysis

**Expected Flow:**
1. User saves cookies → `POST /api/cookies`
2. Bridge calls `POST /internal/gemini/create` → Creates client in session registry
3. User sends chat → `POST /api/chat`
4. Bridge sends `X-Internal-User-ID` header
5. WebAI-to-API routes to correct user's client
6. Response streams back

**Actual Flow (with error):**
1. User saves cookies → `POST /api/cookies`
2. Bridge calls `POST /internal/gemini/create` → May fail or session registry not initialized
3. User sends chat → `POST /api/chat`
4. Bridge sends `X-Internal-User-ID` header
5. WebAI-to-API returns "Session registry is not initialized"
6. Error streams back

---

## Summary

**Problem:** WebAI-to-API's session registry is not initialized or not available.

**Evidence:**
- `/api/chat` correctly sends `X-Internal-User-ID` header
- WebAI-to-API returns "Session registry is not initialized"
- This is a WebAI-to-API configuration/feature issue, not a bridge code issue

**Next Steps:**
1. Verify user has saved cookies (check `/api/cookies/status`)
2. Check WebAI-to-API logs for session registry errors
3. Review WebAI-to-API documentation for session registry setup
4. Consider using global client approach if session registry unavailable

**Immediate Workaround:**
Remove `X-Internal-User-ID` header from `/api/chat` to use global client (not multi-user safe).

---

**Document Version:** 1.0  
**Created:** 2026-06-08  
**Status:** Analysis Complete
