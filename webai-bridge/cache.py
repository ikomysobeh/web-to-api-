# cache.py
"""
Shared Redis cache for the bridge (Phase 2).

Design goal: caching is an OPTIMIZATION, never a dependency. If Redis is down,
missing, or misbehaving, every function here silently degrades to "no cache" and
the app keeps working exactly as before. Nothing in here can crash a request.

Used by:
  - Task 6  embedding cache      (cache_get_json / cache_set_json)
  - Task 10 semantic response cache (later)
  - Task 11 search-result cache  (later)
"""
import hashlib
import json
import logging
import os
from typing import Optional

logger = logging.getLogger("cache")

REDIS_URL = os.getenv("REDIS_URL", "")

# One shared client for the whole app. None means "caching disabled".
_client = None
_init_done = False


def _get_client():
    """Lazily create the Redis client. Returns None if Redis isn't configured
    or can't be reached — callers then just skip the cache."""
    global _client, _init_done
    if _init_done:
        return _client
    _init_done = True

    if not REDIS_URL:
        logger.info("REDIS_URL not set — cache disabled (app runs normally)")
        _client = None
        return None

    try:
        import redis
        client = redis.Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        client.ping()  # fail fast if unreachable
        _client = client
        logger.info(f"Redis cache connected: {REDIS_URL}")
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}) — cache disabled, app continues")
        _client = None
    return _client


def make_key(*parts: str) -> str:
    """Build a namespaced cache key. Long parts are hashed to keep keys short."""
    safe = []
    for p in parts:
        p = str(p)
        if len(p) > 64:
            p = hashlib.sha256(p.encode("utf-8")).hexdigest()
        safe.append(p)
    return ":".join(safe)


def cache_get_json(key: str) -> Optional[object]:
    """Return the cached JSON value for key, or None on miss / any error."""
    client = _get_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception:
        return None  # never let a cache error break a request


def cache_set_json(key: str, value: object, ttl_seconds: int) -> None:
    """Store value as JSON under key with a TTL. Silent no-op on any error."""
    client = _get_client()
    if client is None:
        return
    try:
        client.setex(key, ttl_seconds, json.dumps(value))
    except Exception:
        pass


def cache_available() -> bool:
    """True if Redis is connected and usable."""
    return _get_client() is not None
