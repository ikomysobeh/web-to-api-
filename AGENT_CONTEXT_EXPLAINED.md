# How the Agent Handles Conversation & Memory

## The Short Answer

> **The agent does NOT remember the full conversation history.**
> Every message sends only: the agent instructions + relevant documents + the current user message.
> Previous messages in the conversation are stored in the database but are NOT sent to Gemini.

---

## The Full Picture — What Happens on Every Message

When a user sends a message, this is exactly what gets built and sent to Gemini:

```
┌─────────────────────────────────────────────────────┐
│  Message sent to Gemini                             │
│                                                     │
│  1. [system]  Agent instructions                    │
│               + top 5 relevant document chunks      │
│                 (found by vector search)            │
│                                                     │
│  2. [user]    The current message only              │
│               (NOT the previous messages)           │
└─────────────────────────────────────────────────────┘
```

**Example:**

User says: *"What is the return policy?"*
User then says: *"Can you explain that again?"*

On the second message, Gemini receives:
- Agent instructions
- Document chunks about return policy (vector search finds them again)
- "Can you explain that again?" ← current message only

Gemini does NOT receive *"What is the return policy?"* from before.
So Gemini does not know what "that" refers to.

---

## What IS Stored (But Not Sent)

Every message (user and assistant) is saved in the PostgreSQL database in the `messages` table, linked to a `conversation_id`. This means:

- The user can scroll up and see the full chat history in the UI ✓
- The history is safe and never lost ✓
- But Gemini does not get to read it ✗

---

## Why Is It Built This Way?

Gemini (via the WebAI-to-API wrapper) is called like a single-turn API:

```
POST /v1/chat/completions
{
  "messages": [
    { "role": "system", "content": "...instructions + docs..." },
    { "role": "user",   "content": "current message only" }
  ]
}
```

The conversation history is never included in the `messages` array.

---

## What This Means in Practice

| Scenario | Result |
|---|---|
| User asks a simple factual question | ✅ Works perfectly — agent finds the answer from documents |
| User asks a follow-up ("and what about X?") | ✅ Works if X is in the documents |
| User refers to a previous answer ("explain that again") | ❌ Gemini does not know what "that" is |
| User asks "what did I ask before?" | ❌ Gemini has no memory of it |
| User changes topic in the same conversation | ✅ Works fine — each message is independent |

---

## How to Fix This — Add Conversation History

To make the agent remember the conversation, the `send_message` function in `webai-bridge/main.py` needs to load the previous messages from the DB and include them in the array sent to Gemini.

**Current code (line ~782-815):**
```python
messages = [{"role": "user", "content": data.message}]
# ... adds system message on top
# Result: [system, user_current]
```

**What it should be to support history:**
```python
# 1. Load past messages from DB
history, _ = get_messages(conversation_id_str, user["user_id"])

# 2. Build history array (oldest first, skip the one we just saved)
history_messages = [
    {"role": m["role"], "content": m["content"]}
    for m in history[:-1]   # exclude the message we just saved
]

# 3. Send: [system] + [all past messages] + [current user message]
messages = [system_message] + history_messages + [{"role": "user", "content": data.message}]
```

---

## Important Consideration Before Adding History

Adding full history has a cost:

| History depth | Token usage per message | Risk |
|---|---|---|
| 0 messages (current) | Low | Cannot follow up |
| Last 5 messages | Medium | Good balance |
| Full history | High | Can exceed Gemini's context limit on long chats |

**Recommended approach:** send only the last **N** messages (e.g. 10), not the full history.

```python
HISTORY_LIMIT = 10
history_messages = [
    {"role": m["role"], "content": m["content"]}
    for m in history[-(HISTORY_LIMIT + 1):-1]  # last 10, exclude current
]
```

---

## How Vector Search Works (The Document Part)

Even without conversation history, the agent still finds the right documents for each message. This is how:

```
User message: "What is the return policy?"
       │
       ▼
Ollama (nomic-embed-text) converts the message to a 768-dimension vector
       │
       ▼
pgvector searches document_chunks for the 5 most similar chunks
       │
       ▼
Those 5 chunks are injected into the system message sent to Gemini
       │
       ▼
Gemini answers based on those chunks
```

So the agent always has the **right documents** for the current question, even without history.
This is called **RAG (Retrieval-Augmented Generation)**.

---

## Summary for Your Manager

| Question | Answer |
|---|---|
| Does the agent remember the conversation? | No — each message is independent |
| Does the agent lose the chat history? | No — history is saved in the DB and shown in the UI |
| Can the user scroll back and read old messages? | Yes |
| Does the agent read the uploaded documents? | Yes — via vector search on every message |
| Can we add conversation memory? | Yes — requires a code change in `webai-bridge/main.py` |
| What is the risk of adding full history? | Long conversations may exceed Gemini's token limit |
| What is the recommended fix? | Send the last 10 messages as history (not the full conversation) |
