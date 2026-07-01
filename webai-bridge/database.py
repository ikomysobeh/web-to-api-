# database.py

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/webai_bridge")


def get_connection():
    """
    Open a PostgreSQL connection.
    Like Laravel's DB::connection().
    psycopg2.extras.RealDictCursor lets you access columns by name: row["email"]
    """
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn


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

    # Index for fast cosine similarity search
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
        ON document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
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
