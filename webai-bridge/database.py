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

    # users table — like creating users table in Laravel migration
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

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

    conn.commit()
    cursor.close()
    conn.close()
