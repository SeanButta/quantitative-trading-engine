"""
Authentication Module
=====================
JWT-based auth for the Quantitative Trading Platform.

Flow:
  POST /auth/register  → create user, return access token
  POST /auth/login     → verify credentials, return access token
  GET  /auth/me        → return current user profile
  POST /auth/refresh   → issue fresh access token (called from frontend on 401)
  POST /auth/logout    → (stateless; client discards token)
  POST /auth/change-password

Tokens are Bearer JWTs (Authorization: Bearer <token>).
Frontend stores access token in memory / sessionStorage for cross-origin
Vercel → Railway deployments. Production upgrade path: httpOnly cookie
with SameSite=None;Secure once a single-origin deployment is in place.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta
from typing import Optional

# ---------------------------------------------------------------------------
# Demo Mode — set DEMO_MODE=true to disable auth (for local dev / demos only)
# ---------------------------------------------------------------------------
# When True: all protected endpoints accept any/no token and return a demo user.
# Defaults to False so production deployments enforce authentication by
# default.  Opt-in explicitly via DEMO_MODE=true for demos or local dev.
DEMO_MODE: bool = os.getenv("DEMO_MODE", "false").lower() in ("true", "1", "yes")

_DEMO_USER = {"sub": "demo@picador.app", "email": "demo@picador.app",
              "tier": "free", "display_name": "Demo", "user_id": 0}

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Use bcrypt directly — passlib 1.7.4 + bcrypt 4.x has a compatibility bug
# where truncation errors are raised even for short passwords.  The bcrypt
# library itself is always installed (it's passlib's own dependency) and its
# API is stable across 3.x and 4.x.
import bcrypt as _bcrypt

logger = logging.getLogger(__name__)

if DEMO_MODE:
    logger.warning("DEMO_MODE is ON — authentication is bypassed. Set DEMO_MODE=false for production.")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SECRET_KEY: str = os.getenv("SECRET_KEY", "CHANGE_ME_IN_PRODUCTION_USE_openssl_rand_hex_32")
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

if SECRET_KEY == "CHANGE_ME_IN_PRODUCTION_USE_openssl_rand_hex_32":
    if not DEMO_MODE:
        raise RuntimeError(
            "SECRET_KEY environment variable is REQUIRED in production. "
            "Generate one with: openssl rand -hex 32"
        )
    logger.warning(
        "SECRET_KEY is using the insecure default value. "
        "Set SECRET_KEY env var before deploying to production."
    )

# ---------------------------------------------------------------------------
# Password hashing  (bcrypt direct — bypasses passlib compatibility issues)
# ---------------------------------------------------------------------------

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login/form", auto_error=False)


def hash_password(plain: str) -> str:
    """Hash a plaintext password with bcrypt.  Passwords are explicitly
    capped at 72 bytes (the bcrypt limit) before hashing so that very long
    passwords produce a stable, deterministic hash rather than raising."""
    pw_bytes = plain.encode("utf-8")[:72]
    return _bcrypt.hashpw(pw_bytes, _bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash.
    Works with hashes created by this function AND with any previous
    passlib-generated ``$2b$`` bcrypt hashes (same wire format)."""
    try:
        pw_bytes = plain.encode("utf-8")[:72]
        return _bcrypt.checkpw(pw_bytes, hashed.encode("ascii"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(
    user_id: str,
    email: str,
    tier: str,
    display_name: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": str(user_id),
        "email": email,
        "tier": tier,
        "display_name": display_name,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ---------------------------------------------------------------------------
# FastAPI dependency — get current user (required)
# ---------------------------------------------------------------------------

def get_current_user(
    token: str = Depends(oauth2_scheme),
):
    """
    Dependency for protected endpoints. Raises 401 if token is missing or invalid.
    When DEMO_MODE=True, returns a demo user for any/no token.
    """
    if DEMO_MODE:
        return _DEMO_USER
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    return payload  # dict: sub, email, tier, display_name, exp


def get_optional_user(
    token: str = Depends(oauth2_scheme),
) -> Optional[dict]:
    """
    Dependency for endpoints that work both authenticated and unauthenticated.
    Returns None if no/invalid token (instead of raising 401).
    When DEMO_MODE=True, always returns the demo user.
    """
    if DEMO_MODE:
        return _DEMO_USER
    if not token:
        return None
    try:
        return decode_token(token)
    except HTTPException:
        return None


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    display_name: str
    tier: str


class UserProfile(BaseModel):
    user_id: str
    email: str
    display_name: str
    tier: str
    created_at: str


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_db_dependency():
    """Late import to avoid circular dependency at module load."""
    from main import get_db
    return get_db


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest):
    """Register a new user. Returns an access token immediately."""
    from main import get_db
    from models import User

    # Email validation
    import re as _re_auth
    if not _re_auth.match(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$", req.email or ""):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(req.email) > 254:
        raise HTTPException(status_code=400, detail="Email address too long")
    # Password strength
    if len(req.password) < 10:
        raise HTTPException(status_code=400, detail="Password must be at least 10 characters")
    if not _re_auth.search(r"[A-Z]", req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not _re_auth.search(r"[a-z]", req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not _re_auth.search(r"[0-9]", req.password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")

    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        # Check duplicate email
        existing = db.query(User).filter(User.email == req.email.lower().strip()).first()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        import uuid as _uuid
        user = User(
            id=str(_uuid.uuid4()),
            email=req.email.lower().strip(),
            hashed_password=hash_password(req.password),
            display_name=req.display_name.strip() or req.email.split("@")[0],
            tier="free",
            is_active=True,
            created_at=datetime.utcnow(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        token = create_access_token(user.id, user.email, user.tier, user.display_name)
        logger.info("New user registered: %s (id=%s)", user.email, user.id)
        return TokenResponse(
            access_token=token,
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            tier=user.tier,
        )
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Registration failed for %s: %s", req.email, e)
        raise HTTPException(status_code=500, detail="Registration failed. Please try again.")
    finally:
        db.close()


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    """Login with email + password. Returns access token."""
    from main import get_db
    from models import User

    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        user = db.query(User).filter(User.email == req.email.lower().strip()).first()
        if not user or not verify_password(req.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account is disabled")

        # Update last login
        user.last_login = datetime.utcnow()
        db.commit()

        token = create_access_token(user.id, user.email, user.tier, user.display_name)
        logger.info("User logged in: %s", user.email)
        return TokenResponse(
            access_token=token,
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            tier=user.tier,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Login failed for %s: %s", req.email, e)
        raise HTTPException(status_code=500, detail="Login failed. Please check your credentials.")
    finally:
        db.close()


@router.post("/login/form", response_model=TokenResponse, include_in_schema=False)
def login_form(form: OAuth2PasswordRequestForm = Depends()):
    """OAuth2 form-compatible login endpoint (for Swagger UI 'Authorize' button)."""
    return login(LoginRequest(email=form.username, password=form.password))


@router.get("/me", response_model=UserProfile)
def get_me(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    from main import get_db
    from models import User

    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        user = db.query(User).filter(User.id == current_user["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserProfile(
            user_id=user.id,
            email=user.email,
            display_name=user.display_name,
            tier=user.tier,
            created_at=user.created_at.isoformat(),
        )
    finally:
        db.close()


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """Change the authenticated user's password."""
    from main import get_db
    from models import User

    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        user = db.query(User).filter(User.id == current_user["sub"]).first()
        if not user or not verify_password(req.current_password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        if len(req.new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        user.hashed_password = hash_password(req.new_password)
        db.commit()
        return {"message": "Password changed successfully"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Password change failed")
        raise HTTPException(status_code=500, detail="Password change failed")
    finally:
        db.close()


@router.post("/logout")
def logout():
    """
    Stateless JWT logout. Client should discard the token.
    In a cookie-based setup, this would also clear the httpOnly cookie.
    """
    return {"message": "Logged out successfully"}
