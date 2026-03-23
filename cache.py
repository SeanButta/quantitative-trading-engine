"""
Caching Layer
=============
Two-tier cache: Redis (preferred, when REDIS_URL is set) with automatic
fallback to an in-memory TTLCache (cachetools). No Redis? No problem —
the app degrades gracefully and just hits the origin APIs more often.

Usage
-----
from cache import cache

# Set a value (auto-serialises to JSON)
cache.set("price:SPY", 523.45, ttl=3600)

# Get a value (returns None on miss)
val = cache.get("price:SPY")

# Delete
cache.delete("price:SPY")

# Decorator (caches return value of async or sync function)
@cache.cached(ttl=3600, key="price:{sym}")
def fetch_price(sym: str) -> float: ...

TTL constants (seconds)
-----------------------
PRICE_TTL   = 3 600   ( 1 hour  ) — market price / OHLCV
SECTOR_TTL  = 3 600   ( 1 hour  ) — sector snapshots
MACRO_TTL   = 21 600  ( 6 hours ) — FRED macro series
SEC_TTL     = 86 400  ( 24 hrs  ) — SEC EDGAR company facts
OPTIONS_TTL = 3 600   ( 1 hour  ) — options chain data
"""
from __future__ import annotations

import json
import logging
import os
import time
from functools import wraps
from threading import Lock
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------

PRICE_TTL   = 3_600
SECTOR_TTL  = 3_600
MACRO_TTL   = 21_600
SEC_TTL     = 86_400
OPTIONS_TTL = 3_600

# ---------------------------------------------------------------------------
# In-memory fallback store (thread-safe TTL cache)
# ---------------------------------------------------------------------------

class _MemoryCache:
    """Simple thread-safe dict-based TTL cache."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key → (value, expiry_ts)
        self._lock = Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expiry = entry
            if time.monotonic() > expiry:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self, prefix: Optional[str] = None) -> int:
        with self._lock:
            if prefix is None:
                count = len(self._store)
                self._store.clear()
                return count
            keys = [k for k in self._store if k.startswith(prefix)]
            for k in keys:
                del self._store[k]
            return len(keys)

    def size(self) -> int:
        with self._lock:
            # Evict expired first
            now = time.monotonic()
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
            return len(self._store)


# ---------------------------------------------------------------------------
# Redis wrapper
# ---------------------------------------------------------------------------

class _RedisCache:
    def __init__(self, redis_url: str) -> None:
        import redis as _redis
        self._client = _redis.from_url(redis_url, decode_responses=True, socket_timeout=2)
        self._client.ping()  # raises if unreachable
        logger.info("Redis cache connected: %s", redis_url.split("@")[-1])

    def get(self, key: str) -> Optional[Any]:
        raw = self._client.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw

    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        self._client.setex(key, ttl, json.dumps(value))

    def delete(self, key: str) -> None:
        self._client.delete(key)

    def clear(self, prefix: Optional[str] = None) -> int:
        if prefix:
            keys = self._client.keys(f"{prefix}*")
            if keys:
                return self._client.delete(*keys)
            return 0
        # Dangerous in production — only called from tests or admin routes
        return self._client.flushdb()

    def size(self) -> int:
        return self._client.dbsize()


# ---------------------------------------------------------------------------
# Unified CacheLayer (picks the right backend at construction time)
# ---------------------------------------------------------------------------

class CacheLayer:
    """
    Unified caching facade. Automatically uses Redis if REDIS_URL is set;
    otherwise falls back to the in-memory store.
    """

    def __init__(self) -> None:
        redis_url = os.getenv("REDIS_URL", "")
        self._backend: _RedisCache | _MemoryCache
        self._using_redis = False

        if redis_url:
            try:
                self._backend = _RedisCache(redis_url)
                self._using_redis = True
            except Exception as exc:
                logger.warning(
                    "Redis unavailable (%s). Falling back to in-memory cache.", exc
                )
                self._backend = _MemoryCache()
        else:
            logger.info("REDIS_URL not set — using in-memory cache (not suitable for multi-process deployment)")
            self._backend = _MemoryCache()

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[Any]:
        return self._backend.get(key)

    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        try:
            self._backend.set(key, value, ttl)
        except Exception as exc:
            logger.warning("Cache set failed for key=%s: %s", key, exc)

    def delete(self, key: str) -> None:
        try:
            self._backend.delete(key)
        except Exception as exc:
            logger.warning("Cache delete failed for key=%s: %s", key, exc)

    def clear(self, prefix: Optional[str] = None) -> int:
        try:
            return self._backend.clear(prefix)
        except Exception as exc:
            logger.warning("Cache clear failed: %s", exc)
            return 0

    def size(self) -> int:
        try:
            return self._backend.size()
        except Exception:
            return -1

    # ------------------------------------------------------------------
    # Decorator
    # ------------------------------------------------------------------

    def cached(self, ttl: int = 3600, key_prefix: str = ""):
        """
        Decorator that caches the return value of a function.

        Usage:
            @cache.cached(ttl=PRICE_TTL, key_prefix="price")
            def fetch_price(sym: str) -> float: ...

        The cache key is built as:   f"{key_prefix}:{':'.join(str(a) for a in args)}"
        Works with both sync and async functions.
        """
        def decorator(fn: Callable):
            @wraps(fn)
            def sync_wrapper(*args, **kwargs):
                k = _build_key(key_prefix or fn.__name__, args, kwargs)
                cached_val = self.get(k)
                if cached_val is not None:
                    return cached_val
                result = fn(*args, **kwargs)
                if result is not None:
                    self.set(k, result, ttl)
                return result

            @wraps(fn)
            async def async_wrapper(*args, **kwargs):
                import asyncio as _asyncio
                k = _build_key(key_prefix or fn.__name__, args, kwargs)
                cached_val = self.get(k)
                if cached_val is not None:
                    return cached_val
                result = await fn(*args, **kwargs)
                if result is not None:
                    self.set(k, result, ttl)
                return result

            import asyncio as _asyncio
            import inspect
            if inspect.iscoroutinefunction(fn):
                return async_wrapper
            return sync_wrapper

        return decorator

    @property
    def using_redis(self) -> bool:
        return self._using_redis


def _build_key(prefix: str, args: tuple, kwargs: dict) -> str:
    parts = [str(a) for a in args] + [f"{k}={v}" for k, v in sorted(kwargs.items())]
    return f"{prefix}:{':'.join(parts)}" if parts else prefix


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

cache = CacheLayer()
