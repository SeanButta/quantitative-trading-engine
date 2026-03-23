"""
Request Middleware
==================
Three pieces of middleware wired into main.py:

1. RequestIDMiddleware
   Injects a unique X-Request-ID header into every request/response.
   Used for correlating logs, tracing errors, and client-side debugging.

2. StructuredLoggingMiddleware
   Logs every request as JSON: method, path, status, latency_ms, request_id.
   Structured format is compatible with Datadog, Logtail, Railway Logs,
   and any log aggregation service.

3. sanitize_exception_handler
   Global 500 handler that:
   - Logs the full traceback server-side (with request_id)
   - Returns a generic, safe JSON error to the client (no stack traces leaked)

Rate limiting is implemented via slowapi, configured in main.py.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JSON Structured Logger
# ---------------------------------------------------------------------------

class _JSONFormatter(logging.Formatter):
    """Emit log records as single-line JSON for log aggregation services."""

    def format(self, record: logging.LogRecord) -> str:
        base = {
            "ts":      self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":   record.levelname,
            "logger":  record.name,
            "msg":     record.getMessage(),
        }
        if record.exc_info:
            base["exc"] = self.formatException(record.exc_info)
        # Copy any extra fields attached to the record
        for key in ("request_id", "method", "path", "status", "latency_ms", "user_id"):
            if hasattr(record, key):
                base[key] = getattr(record, key)
        return json.dumps(base)


def configure_structured_logging(level: int = logging.INFO) -> None:
    """
    Replace the root handler with a JSON-emitting one.
    Call once at app startup (before any other logging).
    """
    root = logging.getLogger()
    root.setLevel(level)
    # Remove existing handlers
    for h in root.handlers[:]:
        root.removeHandler(h)
    handler = logging.StreamHandler()
    handler.setFormatter(_JSONFormatter())
    root.addHandler(handler)


# ---------------------------------------------------------------------------
# 1. Request ID Middleware
# ---------------------------------------------------------------------------

class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Attach a UUID to every request under request.state.request_id.
    Echoes it back in the X-Request-ID response header so clients
    can reference it when filing bug reports or tracing errors.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Accept forwarded ID (e.g. from a load balancer) or generate one
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


# ---------------------------------------------------------------------------
# 2. Structured Access Logging Middleware
# ---------------------------------------------------------------------------

class AccessLogMiddleware(BaseHTTPMiddleware):
    """
    Log every HTTP request as structured JSON after the response is sent.
    Skips /health to avoid polluting logs with liveness probes.
    """

    SKIP_PATHS = {"/health", "/favicon.ico"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        start = time.perf_counter()
        request_id = getattr(request.state, "request_id", "-")

        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "Unhandled exception",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                },
            )
            raise

        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        status_code = response.status_code

        log_fn = logger.warning if status_code >= 400 else logger.info
        log_fn(
            "%s %s %s",
            request.method,
            request.url.path,
            status_code,
            extra={
                "request_id": request_id,
                "method":     request.method,
                "path":       request.url.path,
                "status":     status_code,
                "latency_ms": latency_ms,
            },
        )
        return response


# ---------------------------------------------------------------------------
# 3. Global 500 Exception Handler
# ---------------------------------------------------------------------------

async def sanitize_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch any unhandled exception, log the full traceback server-side,
    and return a safe, generic JSON error to the client.

    Wired in main.py via:
        app.add_exception_handler(Exception, sanitize_exception_handler)
    """
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(
        "Internal server error",
        extra={"request_id": request_id, "path": request.url.path},
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal error occurred. Please try again later.",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


# ---------------------------------------------------------------------------
# Convenience: attach all middleware to a FastAPI app
# ---------------------------------------------------------------------------

def attach_middleware(app: FastAPI) -> None:
    """
    One-call setup. Import and call this in main.py after creating the app:

        from middleware import attach_middleware
        attach_middleware(app)
    """
    # Order matters: RequestID must come before AccessLog so the ID is available
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_exception_handler(Exception, sanitize_exception_handler)
