# database.py

import os
import logging
import psycopg2
import psycopg2.extras
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("database")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/webai_bridge")

# Pool size — how many real PostgreSQL connections we keep open and reuse.
# minconn: opened right away.  maxconn: hard ceiling shared by ALL requests.
# 20 is comfortably below PostgreSQL's default limit of 100.
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "5"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "20"))

# The one shared pool for the whole app. Created lazily on first use so that
# importing this module never fails just because the DB isn't up yet.
_pool: "pool.ThreadedConnectionPool | None" = None


def _get_pool() -> "pool.ThreadedConnectionPool":
    global _pool
    if _pool is None:
        _pool = pool.ThreadedConnectionPool(
            DB_POOL_MIN,
            DB_POOL_MAX,
            dsn=DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        logger.info(f"DB pool created (min={DB_POOL_MIN}, max={DB_POOL_MAX})")
    return _pool


class _PooledConnection:
    """
    A thin wrapper around a real psycopg2 connection borrowed from the pool.

    Everything (cursor(), commit(), rollback(), ...) is forwarded to the real
    connection. The ONLY difference is close(): instead of destroying the
    connection, it hands it back to the pool so the next request can reuse it.

    This lets every existing `conn = get_connection() ... conn.close()` in the
    codebase keep working unchanged — close() now means "return to pool".
    """

    def __init__(self, real_conn, owner_pool):
        # Use object.__setattr__ so we don't trigger our own __getattr__.
        object.__setattr__(self, "_real", real_conn)
        object.__setattr__(self, "_pool", owner_pool)
        object.__setattr__(self, "_returned", False)

    def close(self):
        if self._returned:
            return  # guard against double-close returning it twice
        object.__setattr__(self, "_returned", True)
        try:
            # Clear any leftover transaction state before reuse so a half-done
            # transaction from one request can never leak into the next.
            self._real.rollback()
        except Exception:
            pass
        self._pool.putconn(self._real)

    # Forward every other attribute/method to the real connection.
    def __getattr__(self, name):
        return getattr(self._real, name)

    # Support use as a context manager (with get_connection() as conn:)
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False


def get_connection():
    """
    Borrow a PostgreSQL connection from the shared pool.

    Drop-in replacement for the old "open a new connection" version — same
    usage everywhere. Call conn.close() when done; that now RETURNS the
    connection to the pool instead of destroying it (like Laravel's pool).
    """
    return _PooledConnection(_get_pool().getconn(), _get_pool())


def release_connection(conn):
    """
    Explicit alternative to conn.close(). Both do the same thing (return to
    pool). Provided so new code can be extra clear about intent.
    """
    try:
        conn.close()
    except Exception:
        pass


def close_pool():
    """Close every pooled connection. Call on app shutdown."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None
        logger.info("DB pool closed")


def init_db():
    """
    Create tables if they don't exist.
    Like running: php artisan migrate
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Enable UUID extension
    cursor.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

    # users table — id matches pizzasys user id directly (no auto-increment)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migration: remove SERIAL default from id so we control it (pizzasys id)
    cursor.execute("ALTER TABLE users ALTER COLUMN id DROP DEFAULT")
    cursor.execute("DROP SEQUENCE IF EXISTS users_id_seq CASCADE")

    # user_gemini_cookies table — stores each user's Gemini cookies
    # cookies are encrypted before storing (never plain text)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_gemini_cookies (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL,
            psid_encrypted TEXT NOT NULL,
            psidts_encrypted TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # conversations table — stores user chat conversations
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT 'gemini-3-flash',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # conversation_messages table — stores messages within conversations
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversation_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
    """)

    # user_preferences table — stores user preferences
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL,
            default_model TEXT DEFAULT 'gemini-3-flash',
            theme TEXT DEFAULT 'dark',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # --- Enable pgvector extension ---
    cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # --- Add role and external sync columns to users ---
    cursor.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='role'
            ) THEN
                ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
            END IF;
        END$$;
    """)

    # Migration: drop external_id — bridge id IS the pizzasys id now
    cursor.execute("ALTER TABLE users DROP COLUMN IF EXISTS external_id")

    cursor.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='users' AND column_name='synced_at'
            ) THEN
                ALTER TABLE users ADD COLUMN synced_at TIMESTAMP;
            END IF;
        END$$;
    """)

    # --- agents table ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agents (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name         TEXT NOT NULL,
            description  TEXT,
            instructions TEXT NOT NULL DEFAULT '',
            model        TEXT DEFAULT 'gemini-2.5-flash',
            created_by   INTEGER REFERENCES users(id),
            is_active    BOOLEAN DEFAULT true,
            created_at   TIMESTAMP DEFAULT NOW(),
            updated_at   TIMESTAMP DEFAULT NOW()
        )
    """)

    # --- document_chunks table (vector storage) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_chunks (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            filename    TEXT,
            chunk_index INTEGER NOT NULL,
            content     TEXT NOT NULL,
            embedding   vector(768),
            metadata    JSONB DEFAULT '{}',
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """)

    # --- Vector similarity index: HNSW (upgraded from IVFFlat) ---
    # HNSW keeps search fast as the table grows (logarithmic), gives better
    # recall, and needs no retraining when rows change. IVFFlat scaled linearly
    # and its clusters go stale after many inserts — so we drop it and use HNSW.
    #   m               = connections per node (16 = pgvector default, good)
    #   ef_construction = build-time accuracy/speed tradeoff (64 = default)
    # Query-time recall is tuned with hnsw.ef_search (see search_chunks / docs).
    cursor.execute("DROP INDEX IF EXISTS document_chunks_embedding_idx")
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)

    # --- user_agents assignment table ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_agents (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            assigned_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (user_id, agent_id)
        )
    """)

    # --- add agent_id to conversations ---
    cursor.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='conversations' AND column_name='agent_id'
            ) THEN
                ALTER TABLE conversations
                ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
            END IF;
        END$$;
    """)

    # --- embed_configs table (embeddable chat widgets) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS embed_configs (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            embed_key       TEXT UNIQUE NOT NULL,
            agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            created_by      INTEGER REFERENCES users(id),
            allowed_domains TEXT[] NOT NULL DEFAULT '{}',
            config          JSONB DEFAULT '{}',
            is_active       BOOLEAN DEFAULT true,
            created_at      TIMESTAMP DEFAULT NOW(),
            updated_at      TIMESTAMP DEFAULT NOW()
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_embed_configs_key
        ON embed_configs (embed_key)
    """)

    # --- agent_suggestions table (admin-approved starter questions per agent) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS agent_suggestions (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            question    TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_suggestions_agent
        ON agent_suggestions (agent_id, sort_order)
    """)

    conn.commit()
    cursor.close()
    conn.close()


def upsert_user(id: int, email: str, role: str = "user") -> dict:
    """
    Insert or update a user from a NATS event.
    id matches the pizzasys user id — same value in both systems.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO users (id, email, password_hash, role, synced_at)
        VALUES (%s, %s, 'EXTERNAL_AUTH', %s, NOW())
        ON CONFLICT (id) DO UPDATE
        SET email     = EXCLUDED.email,
            role      = EXCLUDED.role,
            synced_at = NOW()
        RETURNING id, email, role
    """, (id, email, role))
    row = cursor.fetchone()
    conn.commit()
    cursor.close()
    conn.close()
    return dict(row)


def delete_user_by_external_id(external_id: int) -> bool:
    """
    Delete a user from local DB when Laravel sends user.deleted event.
    Cascade deletes their conversations, messages, and assignments.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM users WHERE external_id = %s", (external_id,)
    )
    deleted = cursor.rowcount > 0
    conn.commit()
    cursor.close()
    conn.close()
    return deleted
