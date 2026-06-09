# Current Problem Analysis

> Analysis of the "Session registry is not initialized" error in the webai-bridge backend.

---

## Problem Description

**Error Message:**
```
{"error": "{\"detail\":\"Session registry is not initialized.\"}"}
Status: 503
```

**When it occurs:**
When sending a message via the new endpoint: `POST /api/conversations/{id}/messages`

---

## Current State Analysis

### 1. Cookie Save Endpoint (`POST /api/cookies`)

**Location:** `main.py` lines 313-346

**Current Implementation:**
```python
# Tell WebAI-to-API to create a Gemini client for this user
await create_webai_client_for_user(user["user_id"], data.psid.strip(), data.psidts.strip())
```

**What it does:**
- Saves encrypted cookies to database
- Calls WebAI-to-API internal endpoint: `POST /internal/gemini/create`
- Sends: `{"user_id": str(user_id), "psid": psid, "psidts": psidts}`
- Headers: `X-Internal-Key: {WEBAI_INTERNAL_KEY}`

**Purpose:** Creates a per-user Gemini client in WebAI-to-API's session registry

---

### 2. Message Send Endpoint (`POST /api/conversations/{id}/messages`)

**Location:** `main.py` lines 623-699

**Current Implementation:**
```python
async with client.stream(
    "POST",
    f"{WEBAI_URL}/v1/chat/completions",
    json=request_body,
    headers={
        "Content-Type": "application/json",
        "X-Internal-Key": WEBAI_INTERNAL_KEY,
    }
) as response:
```

**What it does:**
- Saves user message to database
- Streams chat request to WebAI-to-API
- Sends: `{"model": model, "stream": True, "messages": [...]}`
- Headers: `X-Internal-Key: {WEBAI_INTERNAL_KEY}`
- **MISSING:** `X-Internal-User-ID` header

---

### 3. WebAI-to-API Session Registry

**Expected Behavior:**
- WebAI-to-API maintains a session registry for per-user Gemini clients
- When a client is created via `/internal/gemini/create`, it's stored in the registry
- When sending chat requests, the `X-Internal-User-ID` header tells WebAI-to-API which user's client to use
- Without this header, WebAI-to-API doesn't know which client to use
- If the session registry is not properly initialized, it returns "Session registry is not initialized"

---

## Root Cause

**The Problem:**
1. Cookie save endpoint creates a per-user client in WebAI-to-API's session registry
2. Message send endpoint does NOT send the `X-Internal-User-ID` header
3. WebAI-to-API cannot identify which user's client to use
4. WebAI-to-API returns "Session registry is not initialized" error

**Why this happens:**
- The message endpoint was modified to remove the `X-Internal-User-ID` header
- This was done to avoid the session registry error
- But this breaks the multi-user architecture
- WebAI-to-API expects the user ID header to route to the correct per-user client

---

## The Fix

**Add back the `X-Internal-User-ID` header to the message endpoint:**

**Location:** `main.py` line 659-662

**Current code:**
```python
headers={
    "Content-Type": "application/json",
    "X-Internal-Key": WEBAI_INTERNAL_KEY,
}
```

**Should be:**
```python
headers={
    "Content-Type": "application/json",
    "X-Internal-Key": WEBAI_INTERNAL_KEY,
    "X-Internal-User-ID": str(user["user_id"]),
}
```

**Also need to add the variable:**
```python
user_id_str = str(user["user_id"])
```

---

## Why the Multi-User Session Architecture is Important

1. **User Isolation:** Each user has their own Gemini client with their own cookies
2. **Security:** Users cannot access each other's Gemini sessions
3. **Scalability:** Supports multiple concurrent users with different Gemini accounts
4. **Resource Management:** WebAI-to-API can manage per-user client lifecycles

---

## WebAI-to-API Internal Endpoints Used

### Create User Client
```
POST {WEBAI_URL}/internal/gemini/create
Headers: X-Internal-Key: {key}
Body: {"user_id": str, "psid": str, "psidts": str}
```

### Remove User Client
```
DELETE {WEBAI_URL}/internal/gemini/{user_id}
Headers: X-Internal-Key: {key}
```

### Chat with User Client
```
POST {WEBAI_URL}/v1/chat/completions
Headers: 
  X-Internal-Key: {key}
  X-Internal-User-ID: {user_id}  <-- CRITICAL
Body: {"model": str, "stream": bool, "messages": [...]}
```

---

## Summary

**Problem:** Message endpoint missing `X-Internal-User-ID` header

**Current State:**
- Cookie save creates per-user client ✓
- Message send doesn't identify which user ✗
- WebAI-to-API can't route to correct client ✗

**Solution:** Add `X-Internal-User-ID` header to message endpoint

**Impact:** Without this fix, multi-user architecture is broken and all users share the same global Gemini client (if it works at all).

---

**Document Version:** 1.0  
**Created:** 2026-06-08  
**Status:** Analysis Complete
