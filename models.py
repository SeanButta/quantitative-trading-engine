"""
SQLAlchemy ORM Models
=====================
Full schema for the Quantitative Trading Platform.

Tables:
  Core (existing)
  ---------------
  projects, strategies, runs, options_refresh_jobs,
  signal_reading_jobs, portfolio_analysis_jobs,
  sector_refresh_jobs, daily_summaries

  New (multi-user)
  ----------------
  users               — account credentials, tier, metadata
  paper_portfolios    — one or more per user, named
  paper_positions     — open equity/options positions per portfolio
  paper_journal       — trade history log per portfolio
  watchlists          — named symbol lists per user

Database compatibility: SQLite (dev) + PostgreSQL (production).
All IDs are String UUIDs for portability across both engines.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


# ===========================================================================
# NEW: Multi-User Identity
# ===========================================================================

class User(Base):
    __tablename__ = "users"

    id               = Column(String, primary_key=True)            # UUID
    email            = Column(String, unique=True, nullable=False, index=True)
    hashed_password  = Column(String, nullable=False)
    display_name     = Column(String, default="")
    tier             = Column(String, default="free")              # free / pro / admin
    is_active        = Column(Boolean, default=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    last_login       = Column(DateTime, nullable=True)

    portfolios = relationship("PaperPortfolio", back_populates="user",  cascade="all, delete-orphan")
    watchlists = relationship("Watchlist",      back_populates="user",  cascade="all, delete-orphan")


class PaperPortfolio(Base):
    __tablename__ = "paper_portfolios"

    id            = Column(String, primary_key=True)                # UUID
    user_id       = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name          = Column(String, default="My Portfolio")
    starting_cash = Column(Float, default=100_000.0)
    cash          = Column(Float, default=100_000.0)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user      = relationship("User",         back_populates="portfolios")
    positions = relationship("PaperPosition", back_populates="portfolio", cascade="all, delete-orphan")
    journal   = relationship("PaperJournal",  back_populates="portfolio", cascade="all, delete-orphan")


class PaperPosition(Base):
    __tablename__ = "paper_positions"

    id                  = Column(String, primary_key=True)          # UUID
    portfolio_id        = Column(String, ForeignKey("paper_portfolios.id"), nullable=False, index=True)

    # Common fields
    type                = Column(String, nullable=False)            # equity / call / put
    symbol              = Column(String, nullable=False)
    side                = Column(String, default="buy")             # buy / sell
    entry_date          = Column(DateTime, default=datetime.utcnow)
    notes               = Column(Text, default="")

    # Equity-specific
    qty                 = Column(Float, nullable=True)
    entry_price         = Column(Float, nullable=True)

    # Options-specific
    contracts           = Column(Integer, nullable=True)
    strike              = Column(Float, nullable=True)
    expiry              = Column(String, nullable=True)             # YYYY-MM-DD
    entry_premium       = Column(Float, nullable=True)
    underlying_at_entry = Column(Float, nullable=True)
    iv                  = Column(Float, nullable=True)
    delta               = Column(Float, nullable=True)

    portfolio = relationship("PaperPortfolio", back_populates="positions")


class PaperJournal(Base):
    __tablename__ = "paper_journal"

    id           = Column(String, primary_key=True)                 # UUID
    portfolio_id = Column(String, ForeignKey("paper_portfolios.id"), nullable=False, index=True)

    date         = Column(DateTime, default=datetime.utcnow)
    action       = Column(String, nullable=False)                   # BUY / SELL / WRITE CALL / etc.
    type         = Column(String, nullable=False)                   # equity / call / put
    symbol       = Column(String, nullable=False)
    strike       = Column(Float, nullable=True)
    expiry       = Column(String, nullable=True)
    qty          = Column(Float, nullable=True)
    contracts    = Column(Integer, nullable=True)
    price        = Column(Float, nullable=True)
    total        = Column(Float, nullable=True)
    pnl          = Column(Float, nullable=True)
    notes        = Column(Text, default="")

    portfolio = relationship("PaperPortfolio", back_populates="journal")


class Watchlist(Base):
    __tablename__ = "watchlists"

    id         = Column(String, primary_key=True)                   # UUID
    user_id    = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name       = Column(String, default="My Watchlist")
    symbols    = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="watchlists")


# ===========================================================================
# EXISTING: Projects / Strategies / Runs
# ===========================================================================

class Project(Base):
    __tablename__ = "projects"

    id          = Column(String, primary_key=True)
    user_id     = Column(String, ForeignKey("users.id"), nullable=True, index=True)  # NEW: optional user scope
    name        = Column(String, nullable=False)
    description = Column(Text, default="")
    symbols     = Column(JSON, default=list)
    timeframe   = Column(String, default="1d")
    start_date  = Column(String, nullable=True)
    end_date    = Column(String, nullable=True)
    provider    = Column(String, default="yfinance")
    status      = Column(String, default="created")
    created_at  = Column(DateTime, default=datetime.utcnow)

    strategies = relationship("Strategy", back_populates="project", cascade="all, delete-orphan")
    runs       = relationship("Run",      back_populates="project", cascade="all, delete-orphan")


class Strategy(Base):
    __tablename__ = "strategies"

    id         = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name       = Column(String, nullable=False)
    signals    = Column(JSON, default=list)
    config     = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="strategies")


class Run(Base):
    __tablename__ = "runs"

    id           = Column(String, primary_key=True)
    project_id   = Column(String, ForeignKey("projects.id"), nullable=False)
    strategy_id  = Column(String, nullable=True)
    run_type     = Column(String, default="backtest")
    status       = Column(String, default="pending")
    config       = Column(JSON, default=dict)
    metrics      = Column(JSON, nullable=True)
    validation   = Column(JSON, nullable=True)
    error        = Column(Text, nullable=True)
    artifacts_dir = Column(String, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="runs")


# ===========================================================================
# EXISTING: Background Job Tracking
# ===========================================================================

class OptionsRefreshJob(Base):
    __tablename__ = "options_refresh_jobs"

    id             = Column(String, primary_key=True)
    status         = Column(String, default="running")      # running / complete / failed
    symbols_total  = Column(Integer, default=0)
    symbols_done   = Column(Integer, default=0)
    symbols_failed = Column(JSON, default=dict)             # {symbol: error_message}
    risk_free_rate = Column(JSON, default=0.05)
    started_at     = Column(DateTime, default=datetime.utcnow)
    completed_at   = Column(DateTime, nullable=True)


class SignalReadingJob(Base):
    __tablename__ = "signal_reading_jobs"

    id           = Column(String, primary_key=True)
    project_id   = Column(String, ForeignKey("projects.id"), nullable=False)
    symbol       = Column(String, nullable=False)
    status       = Column(String, default="pending")        # pending / running / complete / failed
    results      = Column(JSON, nullable=True)
    error        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class PortfolioAnalysisJob(Base):
    __tablename__ = "portfolio_analysis_jobs"

    id           = Column(String, primary_key=True)
    status       = Column(String, default="pending")        # pending / running / complete / failed
    holdings     = Column(JSON, nullable=False)
    results      = Column(JSON, nullable=True)
    error        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class SectorRefreshJob(Base):
    __tablename__ = "sector_refresh_jobs"

    id             = Column(String, primary_key=True)
    status         = Column(String, default="running")      # running / complete / failed
    sectors_total  = Column(Integer, default=0)
    sectors_done   = Column(Integer, default=0)
    sectors_failed = Column(JSON, default=dict)
    started_at     = Column(DateTime, default=datetime.utcnow)
    completed_at   = Column(DateTime, nullable=True)


class DailySummary(Base):
    __tablename__ = "daily_summaries"

    date            = Column(String, primary_key=True)      # YYYY-MM-DD (UTC)
    generated_at    = Column(DateTime, default=datetime.utcnow)
    theme           = Column(Text, nullable=True)
    paragraphs      = Column(JSON, default=list)
    sentiment       = Column(String, default="neutral")     # bullish / bearish / neutral
    sentiment_score = Column(JSON, default=0.0)
    top_tags        = Column(JSON, default=list)
    article_count   = Column(Integer, default=0)
    sources_used    = Column(JSON, default=list)


# ===========================================================================
# Persistent Response Cache
# ===========================================================================

class CacheEntry(Base):
    """
    Persistent key-value response cache stored in the primary DB.

    Survives process restarts (unlike in-memory dicts), is shared across
    all threads in a multi-worker deployment (unlike module-level dicts),
    and requires no extra infrastructure (unlike Redis).

    Design:
      - key is a namespaced string: "market:overview", "sentiment:SPY", etc.
      - value_json holds the JSON-serialised API response payload.
      - expires_at gates reads; stale rows are cleaned up by the warmer.
      - hit_count, size_bytes, source are observability fields exposed by
        the /cache/status admin endpoint.
    """
    __tablename__ = "cache_entries"

    key          = Column(String, primary_key=True)         # namespaced lookup key
    value_json   = Column(Text, nullable=False)             # JSON-serialised payload
    expires_at   = Column(DateTime, nullable=False, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    refreshed_at = Column(DateTime, default=datetime.utcnow)
    hit_count    = Column(Integer, default=0)
    size_bytes   = Column(Integer, default=0)
    source       = Column(String, default="")               # endpoint label for /cache/status
