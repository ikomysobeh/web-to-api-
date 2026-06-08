# Frontend-Backend Integration Suggestions

> Comprehensive guide for enhancing the web2api-ui frontend to fully integrate with the webai-bridge backend API.
> This document provides endpoint suggestions, implementation patterns, and architectural improvements.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Frontend Current Limitations](#frontend-current-limitations)
3. [Backend Current Endpoints](#backend-current-endpoints)
4. [Recommended New Backend Endpoints](#recommended-new-backend-endpoints)
5. [Frontend API Integration Layer](#frontend-api-integration-layer)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Benefits & Trade-offs](#benefits--trade-offs)

---

## Current State Analysis

### Backend (webai-bridge) Summary

**Tech Stack:** Python FastAPI + PostgreSQL + JWT Authentication

**Purpose:** Acts as a middleware between React frontend and WebAI-to-API (Gemini service)

**Current Responsibilities:**
- User authentication (register/login/logout)
- Gemini cookie management (save, extract, delete)
- Chat streaming proxy to WebAI-to-API
- User session management

### Frontend (web2api-ui) Summary

**Tech Stack:** React 19 + TypeScript + Vite + TailwindCSS

**Purpose:** Modern chat interface for interacting with Gemini through the bridge

**Current State:** Using mock data (mockChats.ts) - no live backend integration yet

---

## Frontend Current Limitations

### 1. **No API Integration Layer**
- Frontend is currently using mock chat sessions and mock responses
- No HTTP client configured for communicating with backend
- No authentication token management
- Mock data in `mockChats.ts` is static

### 2. **No Real-time Chat Streaming**
- Chat messages are mocked with hardcoded responses
- Not using Server-Sent Events (SSE) to stream responses from backend
- Manual reply generation instead of AI responses

### 3. **No User Authentication Flow**
- No login/register UI components
- No JWT token storage or refresh logic
- No protected API calls
- No session persistence

### 4. **No Conversation Persistence**
- Chat sessions are local to browser (reset on refresh)
- No backend database storage
- Cannot resume conversations later
- No conversation history sync

### 5. **No Model Selection Backend Integration**
- Model selection exists in UI but not used
- Models are hardcoded in mockChats.ts
- No dynamic model listing from backend

### 6. **No User Profile/Settings**
- No user info display
- No Gemini connection status check UI
- No cookie management UI
- No settings panel

---

## Backend Current Endpoints

### Authentication Endpoints

```
POST   /auth/register
       Input: { email, password }
       Output: { success, token, email }
       
POST   /auth/login
       Input: { email, password }
       Output: { success, token, email }
       
GET    /auth/me
       Headers: Authorization: Bearer {token}
       Output: { user_id, email }
```

### Cookie/Gemini Connection Endpoints

```
POST   /api/cookies
       Headers: Authorization: Bearer {token}
       Input: { psid, psidts }
       Output: { success, message }
       
POST   /api/cookies/extract
       Headers: Authorization: Bearer {token}
       Query: ?browser=chrome
       Output: { success, message, action_needed? }
       
GET    /api/cookies/status
       Headers: Authorization: Bearer {token}
       Output: { connected, message }
       
DELETE /api/cookies
       Headers: Authorization: Bearer {token}
       Output: { success, message }
```

### Chat Endpoint

```
POST   /api/chat
       Headers: Authorization: Bearer {token}
       Input: { message, model }
       Output: Server-Sent Events stream (text/event-stream)
```

### Health Check

```
GET    /health
       Output: { status, service }
```

---

## Recommended New Backend Endpoints

### 1. **Conversation Management Endpoints**

```
GET    /api/conversations
       Headers: Authorization: Bearer {token}
       Query: ?limit=20&offset=0 (pagination)
       Output: {
         success: boolean,
         conversations: [
           {
             id: string,
             title: string,
             model: string,
             created_at: ISO8601,
             updated_at: ISO8601,
             message_count: number
           }
         ],
         total: number
       }
       
       Benefits:
       - Retrieve saved conversation history
       - Display conversation list in sidebar
       - Enable conversation browsing
```

```
POST   /api/conversations
       Headers: Authorization: Bearer {token}
       Input: {
         title?: string,
         model: string
       }
       Output: {
         success: boolean,
         conversation: {
           id: string,
           title: string,
           model: string,
           created_at: ISO8601,
           messages: []
         }
       }
       
       Benefits:
       - Create new conversation sessions
       - Initialize with selected model
       - Backend stores conversation metadata
```

```
GET    /api/conversations/{id}
       Headers: Authorization: Bearer {token}
       Output: {
         success: boolean,
         conversation: {
           id: string,
           title: string,
           model: string,
           created_at: ISO8601,
           updated_at: ISO8601,
           messages: [
             {
               id: string,
               role: "user" | "assistant",
               content: string,
               created_at: ISO8601
             }
           ]
         }
       }
       
       Benefits:
       - Load specific conversation history
       - Resume past conversations
       - Display full chat history
```

```
PUT    /api/conversations/{id}
       Headers: Authorization: Bearer {token}
       Input: { title?: string, model?: string }
       Output: {
         success: boolean,
         conversation: { id, title, model, updated_at }
       }
       
       Benefits:
       - Rename conversations
       - Change conversation settings
       - Track last update time
```

```
DELETE /api/conversations/{id}
       Headers: Authorization: Bearer {token}
       Output: { success: boolean, message: string }
       
       Benefits:
       - Delete unwanted conversations
       - Clean up UI
       - Free database storage
```

```
DELETE /api/conversations
       Headers: Authorization: Bearer {token}
       Output: {
         success: boolean,
         deleted_count: number,
         message: string
       }
       
       Benefits:
       - Clear all conversation history at once
       - User privacy/cleanup
```

### 2. **Chat Message Management Endpoints**

```
POST   /api/conversations/{id}/messages
       Headers: Authorization: Bearer {token}
       Input: {
         message: string,
         model?: string
       }
       Output: Server-Sent Events stream (text/event-stream)
       
       Benefits:
       - Save messages to database while streaming
       - Associate messages with conversation
       - Enable conversation persistence
```

```
GET    /api/conversations/{id}/messages
       Headers: Authorization: Bearer {token}
       Query: ?limit=50&offset=0
       Output: {
         success: boolean,
         messages: [
           {
             id: string,
             role: "user" | "assistant",
             content: string,
             created_at: ISO8601
           }
         ],
         total: number
       }
       
       Benefits:
       - Load message history
       - Support pagination
       - Reduce payload for large conversations
```

```
DELETE /api/conversations/{id}/messages/{message_id}
       Headers: Authorization: Bearer {token}
       Output: { success: boolean, message: string }
       
       Benefits:
       - Remove specific messages
       - Edit conversation history
       - User control
```

### 3. **Model Information Endpoint**

```
GET    /api/models
       Headers: Authorization: Bearer {token}
       Output: {
         success: boolean,
         models: [
           {
             id: string,
             name: string,
             description: string,
             contextWindow: string,
             badge?: string,
             available: boolean
           }
         ]
       }
       
       Benefits:
       - Dynamic model listing from WebAI-to-API
       - Shows available models for user
       - Model descriptions and context window
       - Can be unavailable if Gemini not connected
```

### 4. **User Profile/Settings Endpoints**

```
GET    /api/user/profile
       Headers: Authorization: Bearer {token}
       Output: {
         success: boolean,
         user: {
           user_id: number,
           email: string,
           created_at: ISO8601,
           last_login: ISO8601?,
           preferences: {
             default_model: string?,
             theme?: string
           }
         }
       }
       
       Benefits:
       - User profile information
       - Preferences storage
       - Account creation date
```

```
PUT    /api/user/profile
       Headers: Authorization: Bearer {token}
       Input: {
         preferences?: {
           default_model?: string,
           theme?: string
         }
       }
       Output: {
         success: boolean,
         user: { ... }
       }
       
       Benefits:
       - Save user preferences
       - Remember model selection
       - Theme preferences
```

```
POST   /api/user/logout
       Headers: Authorization: Bearer {token}
       Output: { success: boolean, message: string }
       
       Benefits:
       - Explicit logout endpoint
       - Backend session cleanup
       - Security compliance
```

### 5. **Gemini Status & Connection Endpoints**

```
GET    /api/gemini/status
       Headers: Authorization: Bearer {token}
       Output: {
         success: boolean,
         connected: boolean,
         user_id: number,
         message: string,
         available_models: [string]
       }
       
       Benefits:
       - Check Gemini connection status
       - Show available models
       - Inform UI state
```

```
POST   /api/gemini/disconnect
       Headers: Authorization: Bearer {token}
       Output: { success: boolean, message: string }
       
       Benefits:
       - Alternative to DELETE /api/cookies
       - More semantic naming
       - Same functionality
```

### 6. **Search/Filter Endpoints** (Optional, Phase 2)

```
GET    /api/conversations/search
       Headers: Authorization: Bearer {token}
       Query: ?q=search_term&limit=10
       Output: {
         success: boolean,
         conversations: [...]
       }
       
       Benefits:
       - Search through conversation titles
       - Quick conversation lookup
       - Improved UX for many conversations
```

---

## Frontend API Integration Layer

### Recommended Architecture

```
src/
├── api/
│   ├── client.ts          # HTTP client setup, interceptors, auth
│   ├── auth.ts            # Authentication endpoints
│   ├── conversations.ts   # Conversation management
│   ├── messages.ts        # Message operations
│   ├── chat.ts            # Chat streaming
│   ├── user.ts            # User profile/settings
│   ├── models.ts          # Model information
│   └── types.ts           # API response types
├── hooks/
│   ├── useAuth.ts         # Authentication state management
│   ├── useConversations.ts # Conversation state management
│   ├── useChat.ts         # Chat streaming hook
│   ├── useModels.ts       # Models state management
│   └── useUser.ts         # User profile state
├── store/                 # (Optional) Zustand/Redux for state
├── context/               # React Context if needed
└── types/
    └── api.ts             # API types
```

### Example API Client Setup

```typescript
// src/api/client.ts
import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add JWT token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Example Conversation Hook

```typescript
// src/hooks/useConversations.ts
import { useState, useCallback } from 'react';
import { apiClient } from '@/api/client';

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export const useConversations = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get('/api/conversations');
      setConversations(response.data.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  const createConversation = useCallback(async (title: string, model: string) => {
    try {
      const response = await apiClient.post('/api/conversations', { title, model });
      setConversations((prev) => [response.data.conversation, ...prev]);
      return response.data.conversation;
    } catch (err) {
      throw err;
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await apiClient.delete(`/api/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      throw err;
    }
  }, []);

  return {
    conversations,
    loading,
    error,
    fetchConversations,
    createConversation,
    deleteConversation,
  };
};
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Backend:**
1. Add conversation model to PostgreSQL
2. Create conversation CRUD endpoints
3. Add conversation persistence to chat endpoint
4. Implement conversation listing with pagination

**Frontend:**
1. Create API client setup with auth interceptors
2. Create auth hooks and context
3. Create conversation hooks
4. Update AppShell to use real conversations

**Result:** Conversations are saved and retrieved from backend

### Phase 2: Enhanced Chat Experience (Week 2)

**Backend:**
1. Add message storage to conversation_messages table
2. Implement message history retrieval
3. Add models endpoint
4. Add user profile endpoints

**Frontend:**
1. Create message API functions
2. Update chat components to load history
3. Implement dynamic model selection
4. Add message streaming with real responses

**Result:** Full chat history, model selection, user settings

### Phase 3: User Experience (Week 3)

**Backend:**
1. Add search/filter endpoints
2. Add conversation titles auto-generation
3. Add better error handling
4. Add logging and monitoring

**Frontend:**
1. Add login/register pages
2. Add settings/profile page
3. Add search functionality
4. Add loading states and error boundaries

**Result:** Complete user experience with all features

### Phase 4: Polish & Optimization (Week 4)

**Backend:**
1. Add rate limiting
2. Add response caching
3. Optimize database queries
4. Add data validation

**Frontend:**
1. Add offline support (service workers)
2. Add local caching
3. Optimize bundle size
4. Add accessibility improvements

**Result:** Production-ready application

---

## Benefits & Trade-offs

### Benefits of Adding These Endpoints

#### For Backend (webai-bridge)

| Benefit | Why | Impact |
|---------|-----|--------|
| **Conversation Persistence** | Users want to resume chats | Higher user retention |
| **User Preferences** | Each user has different needs | Better personalization |
| **Search Capability** | Lots of conversations → need to find them | Improved UX at scale |
| **Model Information** | Users need to know available models | Better feature discoverability |
| **Clear Separation of Concerns** | Backend handles state, frontend handles UI | Easier maintenance |

#### For Frontend (web2api-ui)

| Benefit | Why | Impact |
|---------|-----|--------|
| **Real Data** | Mock data limits testing | More realistic development |
| **Multi-session Support** | Switch between conversations | Better user workflow |
| **Persistence** | Conversations survive refresh | Trust in app reliability |
| **Authentication** | Secure user isolation | Multi-user safety |
| **Dynamic UI** | Content from backend drives UI | More flexible features |

#### For Users

| Benefit | Why | Impact |
|---------|-----|--------|
| **Conversation History** | Don't lose important chats | Peace of mind |
| **Multi-device Support** | Access chats from anywhere | Better flexibility |
| **Organized Chats** | Find old conversations | Improved productivity |
| **Preferences** | App remembers preferences | Better UX |
| **Privacy** | User data isolated on backend | Security/compliance |

### Trade-offs to Consider

#### Complexity Trade-offs

```
More Endpoints = More Backend Code = More Testing Required
↓
Consider starting with MVP (conversation CRUD + messages)
Then add search/filters in future phases
```

#### Performance Trade-offs

```
Database Queries for Every Operation = Slower Than Local Mock Data
↓
Solutions:
- Add caching (Redis)
- Use pagination
- Optimize database indexes
- Consider GraphQL or API aggregation
```

#### Development Time Trade-offs

```
Full Implementation = 3-4 weeks
Quick MVP = 1 week (conversations + basic chat)
↓
Recommend: Start with Phase 1 + Phase 2 core features
```

#### Data Storage Considerations

```
Option 1: Store Messages in DB
  Pros: Persistent, searchable, analyzable
  Cons: More storage, more DB queries
  
Option 2: Store Only Conversation Metadata
  Pros: Lighter weight, faster
  Cons: Need to reconstruct from WebAI-to-API
  
Recommend: Option 1 (store messages)
- Enable full history
- Support search/filtering
- Better user experience
```

---

## Database Schema Extensions

### Add to `database.py`

```python
# conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'gemini-3-flash',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

# conversation_messages table
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

# user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    default_model TEXT DEFAULT 'gemini-3-flash',
    theme TEXT DEFAULT 'dark',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN font (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## Security Considerations

### For New Endpoints

1. **Authentication Required**
   - All endpoints except `/health` need JWT token
   - Use `@app.get(..., dependencies=[Depends(get_current_user)])`

2. **Authorization Checks**
   - Verify user owns the conversation
   - Prevent accessing other users' data
   - Use `user_id` from token

3. **Input Validation**
   - Validate all input with Pydantic models
   - Sanitize strings (XSS prevention)
   - Check conversation title length

4. **Rate Limiting**
   - Limit conversations per user
   - Limit messages per conversation
   - Prevent abuse

5. **Data Privacy**
   - Never expose other users' data
   - Encrypt sensitive fields if needed
   - Follow GDPR/privacy regulations

---

## Testing Strategy

### Unit Tests for Backend

```python
# test_conversations.py
def test_create_conversation():
    response = client.post(
        "/api/conversations",
        json={"title": "Test", "model": "gemini-3-flash"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 201
    assert response.json()["success"] is True

def test_get_conversations_requires_auth():
    response = client.get("/api/conversations")
    assert response.status_code == 401

def test_user_cannot_access_other_users_conversations():
    # Create conversation as user1
    # Try to access as user2
    # Should get 403 Forbidden
    pass
```

### Integration Tests for Frontend

```typescript
// src/__tests__/useConversations.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';

test('fetches conversations on mount', async () => {
  const { result } = renderHook(() => useConversations());
  
  await waitFor(() => {
    expect(result.current.conversations.length).toBeGreaterThan(0);
  });
});

test('creates new conversation', async () => {
  const { result } = renderHook(() => useConversations());
  
  await act(async () => {
    await result.current.createConversation('Test', 'gemini-3-flash');
  });
  
  expect(result.current.conversations[0].title).toBe('Test');
});
```

---

## Monitoring & Analytics

### Metrics to Track

```
Backend:
- Average response time per endpoint
- Error rate by endpoint
- Database query performance
- User active conversations count
- Chat message throughput

Frontend:
- Time to first message
- Chat streaming latency
- Conversation load time
- UI render performance
- API error handling success rate
```

---

## Deployment Checklist

Before deploying new endpoints:

- [ ] Database migrations run successfully
- [ ] All new endpoints tested (unit + integration)
- [ ] Frontend API client updated
- [ ] Error handling implemented
- [ ] Logging added
- [ ] CORS settings correct
- [ ] JWT token refresh handled
- [ ] Rate limiting configured
- [ ] Database backups scheduled
- [ ] Rollback plan documented

---

## Quick Reference: Complete API Flow

### User Journey: Send Chat Message

```
1. User opens app
   → GET /auth/me (check if logged in)
   
2. User selects conversation or creates new
   → GET /api/conversations (list)
   → POST /api/conversations (create new)
   
3. User selects model
   → GET /api/models (list available)
   
4. User types and sends message
   → POST /api/conversations/{id}/messages
      - Frontend sends: { message, model }
      - Backend saves user message
      - Backend calls WebAI-to-API
      - Backend streams response back to frontend
      - Backend saves assistant message
   
5. Message appears in UI
   → Components update with new message
   → useChat hook handles streaming
   → Message appears as it streams in
   
6. User can view history anytime
   → GET /api/conversations/{id}
   → Load all messages for conversation
```

---

## Conclusion

Adding these endpoints will transform the web2api-ui from a mock-based prototype into a production-ready application with:

✅ **Persistent storage** - Users don't lose conversations  
✅ **Multi-session support** - Organize multiple chat sessions  
✅ **User isolation** - Secure multi-user environment  
✅ **Scalability** - Backend handles state management  
✅ **Better UX** - Features users expect from chat apps  

**Recommended approach:** Implement in phases, starting with Phase 1 (conversations) + Phase 2 (messages), then expand based on user feedback.

---

## Questions Before Implementation?

Consider these:

1. Should conversations be searchable? (Phase 3 feature)
2. Should messages be exportable? (New endpoint?)
3. Should there be rate limiting? (Security feature)
4. Should we use WebSockets instead of SSE? (Bidirectional comms)
5. Should conversations be shareable? (Social feature)
6. Should there be user analytics? (Tracking feature)

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-07  
**Author:** Backend-Frontend Integration Analysis  
**Status:** Ready for Implementation
