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
    Boolean, Column, Date, DateTime, Float, ForeignKey,
    Index, Integer, JSON, PrimaryKeyConstraint, String, Text,
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


class TradeThesis(Base):
    """Track investment theses with invalidation criteria and outcome monitoring."""
    __tablename__ = "trade_theses"

    id              = Column(String, primary_key=True)
    user_id         = Column(String, default="0", index=True)
    symbol          = Column(String, nullable=False, index=True)
    direction       = Column(String, default="long")                # long / short
    thesis          = Column(String, nullable=False)                 # why you're entering
    entry_price     = Column(Float, nullable=True)
    entry_date      = Column(String, nullable=True)
    target_price    = Column(Float, nullable=True)
    stop_price      = Column(Float, nullable=True)
    invalidation    = Column(String, nullable=True)                  # what kills the thesis
    timeframe       = Column(String, default="medium")               # short / medium / long
    confidence      = Column(Integer, default=50)                    # 0-100
    status          = Column(String, default="active")               # active / won / lost / invalidated / closed
    outcome_notes   = Column(String, nullable=True)
    tags            = Column(JSON, default=list)                     # e.g. ["momentum", "value", "earnings"]
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at       = Column(DateTime, nullable=True)


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


# ===========================================================================
# Time-Series Data Tables (Production DB Cache)
# ===========================================================================

class OHLCVDaily(Base):
    """
    Daily OHLCV price bars cached from upstream data providers.
    Composite PK on (symbol, date). Upserted by the DB cache provider
    and batch ingestion jobs.
    """
    __tablename__ = "ohlcv_daily"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "date"),
    )

    symbol     = Column(String, nullable=False, index=True)
    date       = Column(Date, nullable=False, index=True)
    open       = Column(Float, nullable=False)
    high       = Column(Float, nullable=False)
    low        = Column(Float, nullable=False)
    close      = Column(Float, nullable=False)
    volume     = Column(Float, nullable=False)
    adj_close  = Column(Float, nullable=True)
    provider   = Column(String, default="yfinance")
    fetched_at = Column(DateTime, default=datetime.utcnow)


class Fundamental(Base):
    """
    Quarterly / annual fundamental data snapshots.
    Composite PK on (symbol, period_end).
    """
    __tablename__ = "fundamentals"
    __table_args__ = (
        PrimaryKeyConstraint("symbol", "period_end"),
    )

    symbol      = Column(String, nullable=False, index=True)
    period_end  = Column(Date, nullable=False, index=True)
    period_type = Column(String, default="Q")               # Q = quarterly, A = annual
    revenue     = Column(Float, nullable=True)
    net_income  = Column(Float, nullable=True)
    eps         = Column(Float, nullable=True)
    total_assets = Column(Float, nullable=True)
    total_debt  = Column(Float, nullable=True)
    cash        = Column(Float, nullable=True)
    shares_out  = Column(Float, nullable=True)
    raw_json    = Column(JSON, nullable=True)                # full snapshot for ad-hoc queries
    fetched_at  = Column(DateTime, default=datetime.utcnow)


class MacroSeries(Base):
    """
    FRED / macro economic time-series data.
    Composite PK on (series_id, date).
    """
    __tablename__ = "macro_series"
    __table_args__ = (
        PrimaryKeyConstraint("series_id", "date"),
    )

    series_id  = Column(String, nullable=False, index=True)
    date       = Column(Date, nullable=False, index=True)
    value      = Column(Float, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)


class SecFiling(Base):
    """
    SEC EDGAR filing metadata.
    Composite PK on (cik, accession).
    """
    __tablename__ = "sec_filings"
    __table_args__ = (
        PrimaryKeyConstraint("cik", "accession"),
    )

    cik         = Column(String, nullable=False, index=True)
    accession   = Column(String, nullable=False)
    form_type   = Column(String, nullable=True)             # 10-K, 10-Q, 8-K, etc.
    filed_date  = Column(Date, nullable=True, index=True)
    period_end  = Column(Date, nullable=True)
    raw_json    = Column(JSON, nullable=True)
    fetched_at  = Column(DateTime, default=datetime.utcnow)


# ===========================================================================
# Macro Regime Engine Tables
# ===========================================================================

class MacroSeriesCatalog(Base):
    """Master metadata for every supported macro series."""
    __tablename__ = "macro_series_catalog"

    id                    = Column(String, primary_key=True)     # UUID
    provider              = Column(String, nullable=False)        # fred, bls, bea, etc.
    provider_series_id    = Column(String, nullable=False)
    canonical_key         = Column(String, nullable=False, unique=True, index=True)
    label                 = Column(String, nullable=False)
    description           = Column(Text, nullable=True)
    category              = Column(String, nullable=True)
    subcategory           = Column(String, nullable=True)
    geography             = Column(String, default="US")
    frequency             = Column(String, nullable=True)        # daily, weekly, monthly, quarterly, annual
    unit                  = Column(String, nullable=True)
    seasonal_adjustment   = Column(String, nullable=True)
    source_url            = Column(String, nullable=True)
    supports_vintages     = Column(Boolean, default=False)
    supports_realtime     = Column(Boolean, default=False)
    is_active             = Column(Boolean, default=True)
    created_at            = Column(DateTime, default=datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroSeriesObservation(Base):
    """Normalized macro observations from any provider."""
    __tablename__ = "macro_series_observations"
    __table_args__ = (
        PrimaryKeyConstraint("id"),
    )

    id                = Column(String, primary_key=True)         # UUID
    series_id         = Column(String, nullable=False, index=True)  # FK to catalog.id
    observation_date  = Column(Date, nullable=False, index=True)
    value             = Column(Float, nullable=True)
    raw_value_text    = Column(String, nullable=True)
    realtime_start    = Column(Date, nullable=True)
    realtime_end      = Column(Date, nullable=True)
    vintage_date      = Column(Date, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroSeriesDerivative(Base):
    """Computed transforms (YoY, MoM, z-score, etc.)."""
    __tablename__ = "macro_series_derivatives"
    __table_args__ = (
        PrimaryKeyConstraint("id"),
    )

    id                = Column(String, primary_key=True)         # UUID
    series_id         = Column(String, nullable=False, index=True)
    observation_date  = Column(Date, nullable=False, index=True)
    transform_type    = Column(String, nullable=False)           # yoy, mom, qoq_ann, zscore, ma
    value             = Column(Float, nullable=True)
    window            = Column(String, nullable=True)            # e.g. "3m", "12m"
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroPillarSnapshot(Base):
    """Daily pillar scores for the macro regime engine."""
    __tablename__ = "macro_pillar_snapshots"
    __table_args__ = (
        PrimaryKeyConstraint("id"),
    )

    id              = Column(String, primary_key=True)           # UUID
    snapshot_date   = Column(Date, nullable=False, index=True)
    pillar          = Column(String, nullable=False)              # growth, inflation, labor, etc.
    score           = Column(Float, nullable=False)
    trend           = Column(String, nullable=True)              # Improving, Stable, Deteriorating
    confidence      = Column(String, nullable=True)
    interpretation  = Column(Text, nullable=True)
    drivers_json    = Column(JSON, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroRegimeSnapshot(Base):
    """Daily macro regime classification and composite score."""
    __tablename__ = "macro_regime_snapshots"

    id                = Column(String, primary_key=True)         # UUID
    snapshot_date     = Column(Date, nullable=False, unique=True, index=True)
    regime            = Column(String, nullable=False)
    composite_score   = Column(Float, nullable=False)
    trend             = Column(String, nullable=True)
    confidence        = Column(String, nullable=True)
    summary_bullets   = Column(JSON, nullable=True)
    risks_json        = Column(JSON, nullable=True)
    implications_json = Column(JSON, nullable=True)
    metadata_json     = Column(JSON, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroCatalyst(Base):
    """Upcoming macro events (CPI, NFP, FOMC, etc.)."""
    __tablename__ = "macro_catalysts"

    id              = Column(String, primary_key=True)           # UUID
    event_key       = Column(String, nullable=False)
    event_name      = Column(String, nullable=False)
    event_date      = Column(DateTime, nullable=False, index=True)
    region          = Column(String, default="US")
    expected_value  = Column(String, nullable=True)
    actual_value    = Column(String, nullable=True)
    prior_value     = Column(String, nullable=True)
    surprise_value  = Column(String, nullable=True)
    importance      = Column(String, default="medium")           # high, medium, low
    source          = Column(String, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MacroChartPack(Base):
    """Curated chart pack definitions."""
    __tablename__ = "macro_chart_packs"

    id            = Column(String, primary_key=True)             # UUID
    pack_key      = Column(String, nullable=False, unique=True, index=True)
    label         = Column(String, nullable=False)
    description   = Column(Text, nullable=True)
    config_json   = Column(JSON, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProviderSyncRun(Base):
    """ETL/sync health and observability."""
    __tablename__ = "provider_sync_runs"

    id                = Column(String, primary_key=True)         # UUID
    provider          = Column(String, nullable=False, index=True)
    run_type          = Column(String, nullable=False)           # scheduled, manual, release_triggered
    status            = Column(String, nullable=False)           # running, complete, failed
    started_at        = Column(DateTime, default=datetime.utcnow)
    completed_at      = Column(DateTime, nullable=True)
    records_processed = Column(Integer, default=0)
    error_message     = Column(Text, nullable=True)
    metadata_json     = Column(JSON, nullable=True)


# ===========================================================================
# Unified Signal Pipeline Tables
# ===========================================================================

class SignalDefinition(Base):
    """Central registry of all signals (ML, rule-based, statistical, etc.)."""
    __tablename__ = "signal_definitions"

    id            = Column(String, primary_key=True)             # UUID
    name          = Column(String, nullable=False)
    description   = Column(Text, nullable=True)
    signal_type   = Column(String, nullable=False)               # ML, Rule, Statistical, Sentiment, Regime, Volatility, Composite
    status        = Column(String, default="Draft")              # Draft, Experimental, Validated, Live, Archived, Disabled
    horizon       = Column(String, default="Medium")             # Short, Medium, Long
    version       = Column(String, default="1.0")
    config_json   = Column(JSON, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SignalBacktest(Base):
    """Backtest results for a signal definition."""
    __tablename__ = "signal_backtests"

    id                  = Column(String, primary_key=True)       # UUID
    signal_id           = Column(String, nullable=False, index=True)
    symbols             = Column(JSON, nullable=True)
    start_date          = Column(Date, nullable=True)
    end_date            = Column(Date, nullable=True)
    metrics_json        = Column(JSON, nullable=True)            # CAGR, Sharpe, max DD, etc.
    equity_curve_json   = Column(JSON, nullable=True)
    benchmark_curve_json = Column(JSON, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)


class SignalValidationReport(Base):
    """Validation results determining promotion eligibility."""
    __tablename__ = "signal_validation_reports"

    id                      = Column(String, primary_key=True)   # UUID
    signal_id               = Column(String, nullable=False, index=True)
    validation_score        = Column(Float, nullable=True)
    robustness_score        = Column(Float, nullable=True)
    implementability_score  = Column(Float, nullable=True)
    overfit_risk            = Column(String, nullable=True)      # Low, Moderate, High
    promotion_eligible      = Column(Boolean, default=False)
    report_json             = Column(JSON, nullable=True)
    created_at              = Column(DateTime, default=datetime.utcnow)


class LiveSignalRegistry(Base):
    """Active signals deployed into the live ensemble."""
    __tablename__ = "live_signal_registry"

    id            = Column(String, primary_key=True)             # UUID
    signal_id     = Column(String, nullable=False, index=True)
    live_weight   = Column(Float, default=0.1)
    is_active     = Column(Boolean, default=True)
    promoted_at   = Column(DateTime, nullable=True)
    disabled_at   = Column(DateTime, nullable=True)
    notes         = Column(Text, nullable=True)


class LiveSignalOutput(Base):
    """Point-in-time signal outputs from live signals."""
    __tablename__ = "live_signal_outputs"

    id            = Column(String, primary_key=True)             # UUID
    signal_id     = Column(String, nullable=False, index=True)
    symbol        = Column(String, nullable=False)
    timestamp     = Column(DateTime, nullable=False, index=True)
    score         = Column(Float, nullable=True)                 # -1 to +1
    confidence    = Column(Float, nullable=True)                 # 0 to 100
    bias          = Column(String, nullable=True)
    posture       = Column(String, nullable=True)
    summary_json  = Column(JSON, nullable=True)
    drivers_json  = Column(JSON, nullable=True)
    risks_json    = Column(JSON, nullable=True)


class EnsembleOutput(Base):
    """Aggregated ensemble decision outputs."""
    __tablename__ = "ensemble_outputs"

    id              = Column(String, primary_key=True)           # UUID
    symbol          = Column(String, nullable=False, index=True)
    horizon         = Column(String, nullable=True)
    timestamp       = Column(DateTime, nullable=False, index=True)
    score           = Column(Float, nullable=True)
    confidence      = Column(Float, nullable=True)
    bias            = Column(String, nullable=True)
    posture         = Column(String, nullable=True)
    agreement_score = Column(Float, nullable=True)
    output_json     = Column(JSON, nullable=True)


class SignalHealth(Base):
    """Live signal monitoring and health status."""
    __tablename__ = "signal_health"

    id                = Column(String, primary_key=True)         # UUID
    signal_id         = Column(String, nullable=False, index=True)
    status            = Column(String, default="Healthy")        # Healthy, Drifting, Degrading, Stale, Disabled
    rolling_hit_rate  = Column(Float, nullable=True)
    rolling_sharpe    = Column(Float, nullable=True)
    drift_warning     = Column(String, nullable=True)
    updated_at        = Column(DateTime, default=datetime.utcnow)


# ===========================================================================
# Alpha Opportunity Engine Tables
# ===========================================================================

class CachedResult(Base):
    """
    Persistent computed-result cache. Stores any JSON-serializable
    computation output keyed by (cache_key). Survives restarts,
    shared across workers. Used for TA results, sentiment, advisor,
    domain scores, etc.
    """
    __tablename__ = "cached_results"

    cache_key    = Column(String, primary_key=True)          # e.g. "ta:AAPL:1y:1d", "sentiment:AAPL", "advisor:AAPL"
    value_json   = Column(Text, nullable=False)
    expires_at   = Column(DateTime, nullable=False, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    source       = Column(String, default="")                # which endpoint/job created this


class UniverseRegistry(Base):
    """Central ticker registry for the Alpha scoring engine."""
    __tablename__ = "universe_registry"

    symbol         = Column(String, primary_key=True)
    display_name   = Column(String, nullable=False)
    asset_type     = Column(String, nullable=False)          # Equity, ETF, Index, SectorETF, Crypto, Futures
    sector         = Column(String, nullable=True)
    industry       = Column(String, nullable=True)
    benchmark      = Column(String, nullable=True)
    active         = Column(Boolean, default=True)
    coverage_json  = Column(JSON, nullable=True)             # {macro, markets, sectors, options, technicals, quant, fundamentals, pairs}
    universe_groups = Column(JSON, nullable=True)            # ["Core Equities", "Mega Cap Tech", ...]
    tags           = Column(JSON, nullable=True)
    readiness      = Column(String, default="Partial")       # Ready, Partial, Missing
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DomainOutput(Base):
    """Normalized domain outputs per symbol for Alpha consumption."""
    __tablename__ = "domain_outputs"

    id            = Column(String, primary_key=True)         # UUID
    symbol        = Column(String, nullable=False, index=True)
    domain        = Column(String, nullable=False)           # macro, markets, sectors, options, technicals, quant, fundamentals, pairs
    score         = Column(Float, nullable=True)
    confidence    = Column(Float, nullable=True)
    bias          = Column(String, nullable=True)
    regime        = Column(String, nullable=True)
    setup         = Column(String, nullable=True)
    posture       = Column(String, nullable=True)
    drivers_json  = Column(JSON, nullable=True)
    risks_json    = Column(JSON, nullable=True)
    timestamp     = Column(DateTime, nullable=False, index=True)

    __table_args__ = (
        Index("ix_domain_outputs_symbol_domain_ts", "symbol", "domain", "timestamp"),
    )


class AlphaRanking(Base):
    """Computed Alpha opportunity rankings."""
    __tablename__ = "alpha_rankings"

    id                = Column(String, primary_key=True)     # UUID
    symbol            = Column(String, nullable=False, index=True)
    timestamp         = Column(DateTime, nullable=False, index=True)
    alpha_score       = Column(Float, nullable=True)
    confidence        = Column(Float, nullable=True)
    bias              = Column(String, nullable=True)
    opportunity_type  = Column(String, nullable=True)
    status            = Column(String, nullable=True)
    posture           = Column(String, nullable=True)
    domain_agreement  = Column(String, nullable=True)
    top_drivers_json  = Column(JSON, nullable=True)
    risks_json        = Column(JSON, nullable=True)
    output_json       = Column(JSON, nullable=True)
