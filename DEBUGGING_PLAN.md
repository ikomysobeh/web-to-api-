# Debugging Plan: WebAI-to-API 503 Error

> Plan to add logging and track the flow to understand why WebAI-to-API returns 503 Service Unavailable.

---

## Current Issue

**Error:** WebAI-to-API returns 503 Service Unavailable when calling `/api/chat`

**Log Evidence:**
```
webai-bridge: Chat request received. model=gemini-3-flash, user_id=3
webai-bridge: Streaming to WebAI-to-API: http://webai:6969/v1/chat/completions for user_id=3
webai-api: POST /v1/chat/completions HTTP/1.1 503 Service Unavailable
webai-bridge: WebAI chat failed with status 503
```

**Working:**
- Cookie status: `connected=True` ✓
- Cookie save: Working ✓
- User authentication: Working ✓

**Failing:**
- `/api/chat` endpoint: 503 from WebAI-to-API ✗

---

## Debugging Strategy

### Phase 1: Add Detailed Logging to webai-bridge

#### 1.1 Log Cookie Save Flow

**Location:** `main.py` - `save_user_cookies()` function (lines 313-346)

**Add logs:**
```python
logger.info(f"Starting cookie save for user_id: {user['user_id']}")
logger.info(f"Calling create_webai_client_for_user with user_id: {user['user_id']}")
# After the call
logger.info(f"create_webai_client_for_user completed for user_id: {user['user_id']}")
```

#### 1.2 Log Client Creation Flow

**Location:** `main.py` - `create_webai_client_for_user()` function (lines 168-186)

**Add logs:**
```python
logger.info(f"Sending POST to {WEBAI_URL}/internal/gemini/create")
logger.info(f"Request body: user_id={user_id}, psid_length={len(psid)}, psidts_length={len(psidts)}")
# Before the call
logger.info(f"About to call WebAI-to-API internal endpoint")
# After response
logger.info(f"WebAI-to-API response status: {response.status_code}")
logger.info(f"WebAI-to-API response body: {response.text}")
```

#### 1.3 Log Chat Request Flow

**Location:** `main.py` - `chat()` function (lines 434-487)

**Add logs:**
```python
logger.info(f"=== Chat Request Start ===")
logger.info(f"User ID: {user_id}")
logger.info(f"Model: {data.model}")
logger.info(f"Message length: {len(data.message)}")
logger.info(f"Request URL: {WEBAI_URL}/v1/chat/completions")
logger.info(f"Headers: Content-Type=application/json, X-Internal-Key=***, X-Internal-User-ID={user_id}")
logger.info(f"Request body: {json.dumps(request_body)}")
logger.info(f"=== Sending to WebAI-to-API ===")
```

#### 1.4 Log Response Details

**Location:** `main.py` - `stream_from_webai()` function (lines 452-477)

**Add logs:**
```python
logger.info(f"WebAI-to-API response status: {response.status_code}")
logger.info(f"WebAI-to-API response headers: {dict(response.headers)}")
if response.status_code != 200:
    error = await response.aread()
    logger.error(f"WebAI-to-API error body: {error.decode()}")
    logger.error(f"Full error details: status={response.status_code}, body={error.decode()}")
```

---

### Phase 2: Test WebAI-to-API Internal Endpoints Directly

#### 2.1 Test Health Endpoint

```bash
curl http://localhost:6969/health
```

**Expected:** 200 OK

#### 2.2 Test Client Creation Endpoint

```bash
curl -X POST http://localhost:6969/internal/gemini/create \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: {YOUR_INTERNAL_KEY}" \
  -d '{"user_id": "3", "psid": "...", "psidts": "..."}'
```

**Expected:** 200 OK with success message

**Check logs:** WebAI-to-API logs for any errors

#### 2.3 Test Chat Endpoint Without User ID

```bash
curl -X POST http://localhost:6969/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: {YOUR_INTERNAL_KEY}" \
  -d '{"model": "gemini-3-flash", "stream": false, "messages": [{"role": "user", "content": "test"}]}'
```

**Expected:** 200 OK or specific error message

#### 2.4 Test Chat Endpoint With User ID

```bash
curl -X POST http://localhost:6969/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: {YOUR_INTERNAL_KEY}" \
  -H "X-Internal-User-ID: 3" \
  -d '{"model": "gemini-3-flash", "stream": false, "messages": [{"role": "user", "content": "test"}]}'
```

**Expected:** 200 OK or specific error about session registry

---

### Phase 3: Check WebAI-to-API Configuration

#### 3.1 Review WebAI-to-API Config File

**Location:** `../WebAI-to-API/config.conf`

**Check:**
- Is `auth_lock_backend` set correctly?
- Are Gemini cookies configured?
- Is the internal API key matching?
- Are there any session registry settings?

#### 3.2 Check WebAI-to-API Environment Variables

**Check Docker environment:**
```bash
docker exec webai-api env | grep -i webai
```

**Look for:**
- `WEBAI_INTERNAL_KEY`
- Any session registry related variables
- Gemini configuration variables

#### 3.3 Check WebAI-to-API Logs

**View real-time logs:**
```bash
docker logs -f webai-api
```

**Look for:**
- Session registry initialization errors
- Internal endpoint errors
- Configuration errors
- Any 503 related errors

---

### Phase 4: Add Logging to WebAI-to-API (if possible)

#### 4.1 Enable Debug Logging

If WebAI-to-API supports debug logging, enable it:

**Check for debug mode:**
```bash
docker exec webai-api env | grep DEBUG
```

**If available, set:**
```yaml
environment:
  - DEBUG=true
  - LOG_LEVEL=debug
```

#### 4.2 Add Custom Logging (if source code available)

If you have access to WebAI-to-API source code, add logs to:
- Session registry initialization
- Internal endpoint handlers
- Chat completion handler

---

### Phase 5: Verify Session Registry State

#### 5.1 Check if Session Registry Exists

**Add a debug endpoint to webai-bridge:**

```python
@app.get("/api/debug/session-registry", dependencies=[Depends(get_current_user)])
async def check_session_registry(user = Depends(get_current_user)):
    """Check if user's session exists in WebAI-to-API"""
    user_id = str(user["user_id"])
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{WEBAI_URL}/internal/gemini/{user_id}",
                headers={"X-Internal-Key": WEBAI_INTERNAL_KEY}
            )
            return {
                "user_id": user_id,
                "status": response.status_code,
                "body": response.text
            }
    except Exception as e:
        return {
            "user_id": user_id,
            "error": str(e)
        }
```

#### 5.2 Test the Debug Endpoint

```bash
curl -X GET http://localhost:8000/api/debug/session-registry \
  -H "Authorization: Bearer {token}"
```

**Expected:** 200 OK if session exists, 404 if not

---

### Phase 6: Test Without Session Registry (Fallback)

#### 6.1 Test Global Client Mode

**Modify `/api/chat` temporarily to remove user ID header:**

```python
headers={
    "Content-Type": "application/json",
    "X-Internal-Key": WEBAI_INTERNAL_KEY,
    # "X-Internal-User-ID": user_id,  # Comment out
}
```

**Test if this works:**
- If yes: Session registry is the issue
- If no: WebAI-to-API has a broader configuration problem

#### 6.2 Test with Config File Method

**Modify cookie save to use config file:**

```python
write_cookies_to_config(data.psid.strip(), data.psidts.strip())
await reinit_webai_client()
```

**Test if this works:**
- If yes: Session registry endpoints are the issue
- If no: WebAI-to-API has a broader problem

---

## Implementation Order

### Step 1: Add Logging (Immediate)
1. Add logs to `create_webai_client_for_user()`
2. Add logs to `chat()` function
3. Add logs to response handling
4. Restart webai-bridge container
5. Test `/api/chat` again
6. Review logs

### Step 2: Test Direct Endpoints (After Step 1)
1. Test health endpoint
2. Test client creation endpoint
3. Test chat without user ID
4. Test chat with user ID
5. Compare results

### Step 3: Check WebAI-to-API (After Step 2)
1. Review config file
2. Check environment variables
3. View WebAI-to-API logs
4. Look for session registry errors

### Step 4: Add Debug Endpoint (After Step 3)
1. Add `/api/debug/session-registry` endpoint
2. Test if session exists
3. Verify session creation worked

### Step 5: Test Fallback Methods (After Step 4)
1. Test without user ID header
2. Test with config file method
3. Determine root cause

---

## Expected Outcomes

### Scenario A: Session Registry Not Initialized
- Internal endpoints return 404 or 500
- Debug endpoint shows session doesn't exist
- Solution: Enable/configure session registry in WebAI-to-API

### Scenario B: Session Registry Exists but Fails
- Client creation returns error
- Debug endpoint shows session creation failed
- Solution: Fix WebAI-to-API configuration

### Scenario C: WebAI-to-API Broader Issue
- Even global client mode fails
- Health endpoint may fail
- Solution: Fix WebAI-to-API deployment/configuration

### Scenario D: Configuration Mismatch
- Internal key doesn't match
- URL is wrong
- Solution: Fix environment variables

---

## Log Analysis Checklist

After adding logs and testing, check for:

**In webai-bridge logs:**
- [ ] Cookie save completes successfully
- [ ] Client creation returns 200
- [ ] Chat request includes correct headers
- [ ] WebAI-to-API returns specific error details

**In webai-api logs:**
- [ ] Session registry initialization message
- [ ] Client creation success/failure
- [ ] Chat request received
- [ ] Specific error about 503
- [ ] Any configuration errors

---

## Next Actions

1. **Add logging to webai-bridge** (Phase 1)
2. **Restart containers and test**
3. **Review logs from both containers**
4. **Test WebAI-to-API endpoints directly** (Phase 2)
5. **Check WebAI-to-API configuration** (Phase 3)
6. **Add debug endpoint** (Phase 4)
7. **Test fallback methods** (Phase 5)

---

**Document Version:** 1.0  
**Created:** 2026-06-08  
**Status:** Ready for Implementation
