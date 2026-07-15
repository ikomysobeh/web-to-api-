# Scaling Fixes Explained (for a Laravel Developer)

This guide explains, in simple terms, why the app slows down with many users
and how to fix it. Every Python concept is compared to something you already
know in **Laravel**.

---

## First — Understand the Setup

Your Python backend (`webai-bridge`) is like a Laravel API.
The difference is Laravel does a LOT of things for you automatically that Python does not.

The scaling problems all come from **things Laravel does for free that our Python code does manually.**

---

# Problem 1 — Database Connections (THE IMPORTANT ONE)

## What Laravel does for you

In Laravel, when you write:
```php
User::find(5);
```
Laravel uses a **connection pool** behind the scenes. It keeps a few database
connections open and **reuses** them. You never think about it.

## What our Python code does (the problem)

Look at our `database.py`:
```python
def get_connection():
    conn = psycopg2.connect(DATABASE_URL, ...)  # opens a NEW connection
    return conn
```

Every single request does this:
```python
conn = get_connection()   # 1. OPEN a new connection (slow!)
cursor = conn.cursor()
cursor.execute("SELECT ...")
conn.close()              # 2. CLOSE it and throw it away
```

**This is like Laravel opening a brand-new database connection for every
`User::find()` and destroying it after — instead of reusing one.**

## Why it crashes with many users

PostgreSQL allows only **100 connections at once** by default.

```
300 users clicking send at the same time
   → 300 connections requested
   → PostgreSQL max is 100
   → connections 101–300 get REJECTED
   → those users see an error
```

Also, opening a connection is **slow** (takes 20–50 milliseconds each time).
Doing it 300 times per second wastes huge amounts of time.

## The Fix — Connection Pool

A connection pool = **open 20 connections once, reuse them forever.**

This is exactly what Laravel already does. We just have to do it manually in Python.

**Think of it like a taxi rank:**
- Without pool: every passenger builds a brand-new car, drives once, destroys it 🚗💥
- With pool: 20 taxis wait at the rank, passengers share them, cars never get destroyed 🚕♻️

**The code change** (in `database.py`):
```python
from psycopg2 import pool

# Create ONE pool when the app starts — 5 minimum, 20 maximum connections
connection_pool = pool.ThreadedConnectionPool(
    minconn=5,
    maxconn=20,
    dsn=DATABASE_URL,
    cursor_factory=psycopg2.extras.RealDictCursor,
)

def get_connection():
    return connection_pool.getconn()   # borrow a taxi from the rank

def release_connection(conn):
    connection_pool.putconn(conn)      # return the taxi to the rank
```

Then everywhere in the code that says `conn.close()`, we change it to
`release_connection(conn)` — meaning "give the taxi back" instead of "destroy the car".

**Result:** 20 connections can comfortably serve 300+ users, because no single
user holds a connection for more than a few milliseconds.

---

# Problem 2 — Gemini Sessions (Memory)

## The situation

Each user connects their own Gemini account. Behind the scenes, WebAI-to-API
keeps a **live session in memory** for each user.

```
User A → Gemini session A (uses RAM)
User B → Gemini session B (uses RAM)
...
User 300 → Gemini session 300 (uses RAM)
```

## Why it's a problem

300 live sessions = a LOT of RAM. Eventually the server runs out of memory and
the whole app dies.

## The Fix — Limit + Auto-Cleanup (LRU Cache)

We set a maximum, e.g. **50 active sessions**. When a 51st user comes:
- We find the session that has been **idle the longest**
- We close it (that user just reconnects automatically next time)
- We give the freed memory to the new user

**In Laravel terms:** this is like a cache with `Cache::put(..., $ttl)` where old
unused items expire automatically. You keep only what's being used.

```
LRU = "Least Recently Used"
= "throw away whoever hasn't been active the longest"
```

---

# Problem 3 — Ollama (Vector Search) Overload

## What happens on every message

```
User sends message
   → Ollama converts it to a vector (embedding)
   → pgvector finds the 5 best document chunks
```

## Why it's a problem

Ollama can only do **one embedding at a time** (it's single-threaded).

```
300 messages at once → 300 embedding jobs → they all QUEUE UP
→ the 300th user waits a long time
```

## The Fix — Semaphore (a Traffic Light)

A **semaphore** limits how many things run at once. We say "max 5 embeddings at
a time, the rest wait in line."

**In Laravel terms:** this is exactly like a **queue with limited workers**.
You don't run 300 jobs at once — you run 5 workers and the jobs wait their turn.

```python
import asyncio

# Traffic light: only 5 cars (embeddings) through at once
ollama_semaphore = asyncio.Semaphore(5)

async def search_chunks(...):
    async with ollama_semaphore:   # wait for a green light
        # ... do the embedding + search ...
```

**Result:** Ollama never gets overwhelmed. Requests wait a tiny bit instead of
crashing.

---

# Problem 4 — No Rate Limiting

## The situation

Right now, one user can send **1000 requests per second** and there is nothing
stopping them. This one user would use all the resources and everyone else's app
would freeze.

## The Fix — Rate Limiter

Laravel has this built in:
```php
Route::middleware('throttle:20,1')->group(...);  // 20 requests per minute
```

Python has the same thing via a library called `slowapi`:
```python
from slowapi import Limiter

limiter = Limiter(key_func=lambda req: req.state.user_id)

@app.post("/api/conversations/{id}/messages")
@limiter.limit("20/minute")   # same as Laravel throttle:20,1
async def send_message(...):
    ...
```

**Result:** no single user can abuse the server. Fair usage for everyone.

---

# About Your Worry — "The `for` loop will cause problems"

You mentioned `for` loops. Let me clarify — **`for` loops are not the problem.**

Look at this code from `send_message`:
```python
for i, chunk in enumerate(relevant_chunks, 1):
    system_parts.append(f"[{i}] {chunk}")
```

This loop runs over **5 items** (5 document chunks). It's instant. No problem at all.

The real problems are the 4 things above:
1. Opening/closing DB connections (not a loop — a resource problem)
2. Too many Gemini sessions in memory
3. Ollama doing one thing at a time
4. No limit on how fast users can send

**A `for` loop only becomes a problem if it does something heavy inside it** —
like calling the database or Ollama on every iteration. Our loops don't do that.

---

# Summary Table

| Problem | Laravel equivalent | Python Fix | How urgent |
|---|---|---|---|
| DB connections | Laravel pools automatically | `psycopg2.pool` (taxi rank) | 🔴 Do this first |
| Gemini sessions | `Cache` with TTL | LRU cache, max 50 sessions | 🟡 When you grow |
| Ollama overload | Queue with limited workers | `asyncio.Semaphore(5)` | 🟡 When you grow |
| No rate limit | `throttle:20,1` middleware | `slowapi` limiter | 🟡 When you grow |
| `for` loops | (not a real problem) | nothing needed | ⚪ Ignore |

---

# What To Do Right Now

**Just fix Problem 1 (the connection pool).** It is:
- The only real risk today
- A small, safe change
- Enough to handle ~50–100 concurrent users comfortably

The other 3 fixes you add **later, only when you actually see the app getting slow.**
Don't fix problems you don't have yet.

---

# The One Golden Rule

> Laravel hides all of this from you. Python makes you do it by hand.
> The fixes are just us **manually adding the things Laravel already does automatically.**

Nothing here is exotic or scary. It's the same connection pooling, caching,
queueing, and throttling you already know from Laravel — just written out
explicitly in Python.
