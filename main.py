"""
Quantitative Trading Signal Engine — FastAPI Backend
====================================================

All endpoints documented. No financial advice.
"""

import asyncio
import json
import logging
import os
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

# Add project root to path (flat structure)
_ROOT = str(Path(__file__).parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from models import Base, Project, Strategy, Run, OptionsRefreshJob, SignalReadingJob, PortfolioAnalysisJob, DailySummary, SectorRefreshJob, CacheEntry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Quantitative Trading Signal Engine",
    description="Production-quality quant research platform. Not financial advice.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Database engine — SQLite (local dev) or PostgreSQL/Supabase (production)
# ---------------------------------------------------------------------------
#
# Set DATABASE_URL env var to switch between backends:
#
#   SQLite  (local):  sqlite:///./quant_engine.db   ← default fallback
#   Supabase (prod):  postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
#
# Supabase provides two connection endpoints:
#   • Direct (port 5432) — use with SQLAlchemy's own pool (recommended here)
#   • Session-mode pooler (port 5432 via pgBouncer) — equivalent to direct for SQLAlchemy
#   • Transaction-mode pooler (port 6543) — works but disable pool_pre_ping
#
# The code below auto-detects which mode is in use and configures accordingly.
# ---------------------------------------------------------------------------

_DB_PATH = Path(__file__).parent / "quant_engine.db"
_RAW_DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DB_PATH}")

# Supabase / Heroku export DATABASE_URL with the legacy "postgres://" prefix;
# SQLAlchemy 2.x requires "postgresql://".
DB_URL = _RAW_DB_URL.replace("postgres://", "postgresql://", 1)

_IS_SQLITE = DB_URL.startswith("sqlite")

# Detect Supabase transaction-mode pooler (port 6543) — pgBouncer in this
# mode does not support persistent connections or pre-ping DISCARD ALL, so
# we use pool_size=0 (NullPool) and skip pool_pre_ping.
_IS_SUPABASE_POOLER = (
    not _IS_SQLITE
    and ":6543/" in DB_URL
)

if _IS_SQLITE:
    engine = create_engine(
        DB_URL,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
elif _IS_SUPABASE_POOLER:
    # Transaction-mode pgBouncer: no persistent pool, no pre-ping.
    # SQLAlchemy NullPool opens/closes a fresh connection per request —
    # safe because pgBouncer itself handles connection reuse server-side.
    from sqlalchemy.pool import NullPool
    engine = create_engine(
        DB_URL,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    logger.info("PostgreSQL engine: Supabase transaction-mode pooler (NullPool)")
else:
    # Direct connection or session-mode pooler — full SQLAlchemy pool.
    # pool_size=10  → persistent connections kept warm
    # max_overflow=20 → burst to 30 total for traffic spikes
    # pool_recycle=1800 → recycle connections every 30 min (avoids Supabase idle timeout)
    _pg_connect_args: dict = {}
    if "supabase" in DB_URL or "supabase.co" in DB_URL:
        _pg_connect_args["sslmode"] = "require"
    engine = create_engine(
        DB_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args=_pg_connect_args,
    )
    logger.info("PostgreSQL engine: direct / session-mode pool (size=10, overflow=20)")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create all tables that don't exist yet.
# On Supabase this is a no-op after the first deploy; on a fresh DB it
# provisions the full schema without needing a migration framework.
try:
    Base.metadata.create_all(bind=engine)
    logger.info("DB schema synced (%s)", "SQLite" if _IS_SQLITE else "PostgreSQL")
except Exception as _schema_err:
    logger.error("DB schema creation failed: %s", _schema_err)

# SQLite-only: enable WAL mode + performance PRAGMAs
if _IS_SQLITE:
    try:
        with engine.connect() as _conn:
            _conn.execute(text("PRAGMA journal_mode=WAL"))
            _conn.execute(text("PRAGMA synchronous=NORMAL"))
            _conn.execute(text("PRAGMA temp_store=MEMORY"))
            _conn.execute(text("PRAGMA mmap_size=134217728"))  # 128 MB
            _conn.execute(text("PRAGMA cache_size=-32000"))    # 32 MB page cache
            _conn.commit()
        logger.info("SQLite WAL mode + performance PRAGMAs enabled")
    except Exception as _e:
        logger.warning("Could not set SQLite PRAGMAs: %s", _e)

# Artifacts directory
ARTIFACTS_DIR = Path(os.getenv("ARTIFACTS_DIR", str(Path(__file__).parent / "runs" / "artifacts")))
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).parent / "runs" / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

OPTIONS_DIR = Path(os.getenv("OPTIONS_DIR", str(Path(__file__).parent / "runs" / "options")))
OPTIONS_DIR.mkdir(parents=True, exist_ok=True)

SECTORS_DIR = Path(os.getenv("SECTORS_DIR", str(Path(__file__).parent / "runs" / "sectors")))
SECTORS_DIR.mkdir(parents=True, exist_ok=True)

# Default universe
DEFAULT_SYMBOLS = ["SPY", "QQQ", "IWM", "TLT", "GLD"]


# ---------------------------------------------------------------------------
# DB Helper
# ---------------------------------------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Persistent Response Cache
# ---------------------------------------------------------------------------
#
# Tiered TTLs by data volatility:
#   Market prices / overview   →   5 min  (intraday, moves constantly)
#   Technical analysis          →  15 min  (indicator values shift each tick)
#   News feeds / sentiment      →  30-60 min (articles refresh hourly)
#   Sector snapshots            →   2 hours
#   FRED macro series           →   6 hours (monthly releases)
#   Financials (P&L, BS, CF)    →  24 hours (quarterly updates)
#   SEC filings                 →  24 hours
#
# All endpoints check the DB cache first. On miss they compute and store.
# A background warmer thread pre-fills the most common keys so cold-start
# latency never hits users after initial warm-up.
# ---------------------------------------------------------------------------

_TTL_MARKET_PRICE    = 300        #  5 min
_TTL_MARKET_OVERVIEW = 300        #  5 min
_TTL_TECHNICAL       = 900        # 15 min
_TTL_NEWS_FEED       = 1800       # 30 min
_TTL_FEEDS           = 1800       # 30 min
_TTL_SENTIMENT       = 3600       #  1 hour
_TTL_OPTIONS         = 3600       #  1 hour
_TTL_SECTORS         = 7200       #  2 hours
_TTL_MACRO           = 21600      #  6 hours
_TTL_FINANCIALS      = 86400      # 24 hours
_TTL_SEC             = 86400      # 24 hours


def _get_cache(key: str) -> Optional[Any]:
    """
    Return the cached value for *key* if it exists and has not expired.
    Increments hit_count. Returns None on miss or error.
    """
    db = SessionLocal()
    try:
        row = (
            db.query(CacheEntry)
            .filter(CacheEntry.key == key, CacheEntry.expires_at > datetime.utcnow())
            .first()
        )
        if row:
            row.hit_count = (row.hit_count or 0) + 1
            db.commit()
            return json.loads(row.value_json)
        return None
    except Exception as _e:
        logger.debug("Cache get error for %s: %s", key, _e)
        return None
    finally:
        db.close()


def _set_cache(key: str, value: Any, ttl_seconds: int, source: str = "") -> None:
    """
    Upsert *value* into the cache with the given TTL (in seconds).
    Uses JSON serialisation; datetime objects are coerced to strings.
    Silently drops on serialisation error so it never breaks an endpoint.
    """
    try:
        serialized = json.dumps(value, default=str)
    except Exception as _e:
        logger.debug("Cache serialise error for %s: %s", key, _e)
        return
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        expires_at = now + timedelta(seconds=ttl_seconds)
        row = db.query(CacheEntry).filter(CacheEntry.key == key).first()
        if row:
            row.value_json   = serialized
            row.expires_at   = expires_at
            row.refreshed_at = now
            row.size_bytes   = len(serialized)
            row.source       = source or row.source
        else:
            row = CacheEntry(
                key=key, value_json=serialized, expires_at=expires_at,
                created_at=now, refreshed_at=now,
                size_bytes=len(serialized), source=source,
            )
            db.add(row)
        db.commit()
    except Exception as _e:
        logger.debug("Cache set error for %s: %s", key, _e)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _prune_cache() -> int:
    """Delete cache entries that expired more than 24 hours ago. Returns rows deleted."""
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)
        n = (
            db.query(CacheEntry)
            .filter(CacheEntry.expires_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        return n
    except Exception:
        return 0
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    symbols: list[str] = DEFAULT_SYMBOLS
    timeframe: str = "1d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    provider: str = "yfinance"


class IngestRequest(BaseModel):
    symbols: Optional[list[str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    provider: str = "yfinance"


class ComputeFeaturesRequest(BaseModel):
    vol_window: int = 21
    momentum_windows: list[int] = [5, 21, 63]
    ma_windows: list[int] = [10, 21, 50, 200]


class CreateStrategyRequest(BaseModel):
    name: str
    signals: list[str] = ["conditional_probability", "pca_regime"]
    config: dict = {}


class RunBacktestRequest(BaseModel):
    strategy_id: Optional[str] = None
    signals: Optional[list[str]] = None
    fee_bps: float = 1.0
    slippage_bps: float = 2.0
    risk_free_rate: float = 0.03
    initial_capital: float = 1_000_000.0
    correction_method: str = "benjamini-hochberg"
    n_permutations: int = 1000  # reduced for speed


class RunWalkForwardRequest(BaseModel):
    strategy_id: Optional[str] = None
    signals: Optional[list[str]] = None
    fee_bps: float = 1.0
    slippage_bps: float = 2.0
    train_periods: int = 504
    test_periods: int = 126


class ConditionalProbExplorerRequest(BaseModel):
    symbol: str
    condition_col: str = "volume_zscore"
    condition_threshold: float = 1.5


class OptimizeRequest(BaseModel):
    objective: str = "min_variance"
    weight_bounds: list[float] = [0.0, 1.0]
    target_return: Optional[float] = None
    efficient_frontier: bool = False
    n_frontier_points: int = 20


class GBMRequest(BaseModel):
    mu: float = 0.08
    sigma: float = 0.20
    s0: float = 100.0
    T: float = 1.0
    n_steps: int = 252
    n_paths: int = 1000


class SignalReadingRequest(BaseModel):
    symbol: str = "SPY"


class OptionPriceRequest(BaseModel):
    S: float = 100.0
    K: float = 100.0
    T: float = 0.25
    r: float = 0.03
    sigma: float = 0.20
    option_type: str = "call"


class LMSRRequest(BaseModel):
    n_outcomes: int = 2
    b: float = 100.0
    trades: list[dict] = []


class OptionsRefreshRequest(BaseModel):
    symbols: Optional[list[str]] = None   # None → full SP500_UNIVERSE
    risk_free_rate: float = 0.05
    max_workers: int = 15


class PortfolioHolding(BaseModel):
    ticker: str
    weight: Optional[float] = None   # 0–1 normalised; provide this OR shares
    shares: Optional[float] = None   # number of shares held; backend derives weight from price
    price: Optional[float] = None    # optional price hint for shares mode


class PortfolioAnalyzeRequest(BaseModel):
    holdings: list[PortfolioHolding]
    risk_free_rate: float = 0.05
    n_mc_paths: int = 500
    mc_horizon_days: int = 252
    n_frontier_portfolios: int = 800


# ---------------------------------------------------------------------------
# Endpoints: Health + Cache Admin
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/cache/status")
def cache_status():
    """
    Admin endpoint — returns all live cache entries with TTL remaining,
    hit counts, sizes, and source labels.  Useful for confirming the warmer
    is running and data is fresh.
    """
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        rows = (
            db.query(CacheEntry)
            .order_by(CacheEntry.source, CacheEntry.key)
            .all()
        )
        live = [r for r in rows if r.expires_at > now]
        stale = [r for r in rows if r.expires_at <= now]
        total_bytes = sum(r.size_bytes or 0 for r in live)
        return {
            "live_entries":   len(live),
            "stale_entries":  len(stale),
            "total_size_kb":  round(total_bytes / 1024, 1),
            "entries": [
                {
                    "key":              r.key,
                    "source":           r.source,
                    "ttl_remaining_s":  max(0, int((r.expires_at - now).total_seconds())),
                    "expires_at":       r.expires_at.isoformat(),
                    "hit_count":        r.hit_count or 0,
                    "size_kb":          round((r.size_bytes or 0) / 1024, 2),
                    "refreshed_at":     r.refreshed_at.isoformat() if r.refreshed_at else None,
                }
                for r in live
            ],
        }
    finally:
        db.close()


@app.post("/cache/clear")
def cache_clear(prefix: str = ""):
    """Admin: delete cache entries whose key starts with *prefix* (empty = clear all)."""
    db = SessionLocal()
    try:
        q = db.query(CacheEntry)
        if prefix:
            q = q.filter(CacheEntry.key.startswith(prefix))
        n = q.delete(synchronize_session=False)
        db.commit()
        return {"cleared": n, "prefix": prefix or "(all)"}
    finally:
        db.close()


@app.post("/cache/warm")
def cache_warm(background_tasks: BackgroundTasks):
    """Admin: trigger an immediate full cache warm cycle in the background."""
    background_tasks.add_task(_run_warm_cycle)
    return {"status": "warming", "message": "Full warm cycle queued"}


# ---------------------------------------------------------------------------
# Endpoints: Projects
# ---------------------------------------------------------------------------

@app.post("/projects")
def create_project(req: CreateProjectRequest):
    db = SessionLocal()
    try:
        project_id = str(uuid.uuid4())[:8]
        end_date = req.end_date or datetime.utcnow().strftime("%Y-%m-%d")
        start_date = req.start_date or (
            datetime.utcnow() - timedelta(days=365 * 10)
        ).strftime("%Y-%m-%d")

        project = Project(
            id=project_id,
            name=req.name,
            description=req.description,
            symbols=req.symbols,
            timeframe=req.timeframe,
            start_date=start_date,
            end_date=end_date,
            provider=req.provider,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return _project_to_dict(project)
    finally:
        db.close()


@app.get("/projects")
def list_projects():
    db = SessionLocal()
    try:
        projects = db.query(Project).order_by(Project.created_at.desc()).all()
        return [_project_to_dict(p) for p in projects]
    finally:
        db.close()


@app.get("/projects/{project_id}")
def get_project(project_id: str):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        result = _project_to_dict(project)
        result["runs"] = [_run_to_dict(r) for r in project.runs]
        return result
    finally:
        db.close()


@app.delete("/projects/{project_id}")
def delete_project(project_id: str):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        db.delete(project)
        db.commit()
        return {"deleted": project_id}
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Endpoints: Data
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/ingest")
def ingest_data(project_id: str, req: IngestRequest, background_tasks: BackgroundTasks):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        symbols = req.symbols or project.symbols
        start = req.start_date or project.start_date
        end = req.end_date or project.end_date

        # Run synchronously for simplicity (small dataset)
        result = _do_ingest(project_id, symbols, start, end, req.provider)

        project.status = "ingested"
        db.commit()

        return result
    finally:
        db.close()


def _do_ingest(project_id, symbols, start, end, provider_name):
    _load_quant_modules()
    from data_ingestion import DataStore, get_provider

    store = DataStore(DATA_DIR)
    provider = get_provider(provider_name)

    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")

    return store.ingest(project_id, provider, symbols, start_dt, end_dt)


@app.get("/projects/{project_id}/data/status")
def data_status(project_id: str):
    _load_quant_modules()
    from data_ingestion import DataStore
    store = DataStore(DATA_DIR)
    return store.status(project_id)


# ---------------------------------------------------------------------------
# Endpoints: Features
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/features/compute")
def compute_features(project_id: str, req: ComputeFeaturesRequest):
    try:
        _load_quant_modules()
        from data_ingestion import DataStore
        from feature_engine import FeatureEngine

        store = DataStore(DATA_DIR)
        raw = store.load(project_id)
        if raw.is_empty():
            raise HTTPException(status_code=400, detail="No data ingested. Run /ingest first.")

        engine = FeatureEngine(
            vol_window=req.vol_window,
            momentum_windows=req.momentum_windows,
            ma_windows=req.ma_windows,
        )
        features = engine.compute(raw)

        # Save features as parquet
        feat_path = DATA_DIR / f"{project_id}_features.parquet"
        features.write_parquet(feat_path)

        return {
            "status": "ok",
            "n_rows": len(features),
            "n_features": len(features.columns) - 2,
            "columns": features.columns,
            "sample": features.head(5).fill_nan(None).to_dicts(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Feature computation failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/projects/{project_id}/features")
def get_features(project_id: str, symbol: Optional[str] = None, limit: int = 100):
    feat_path = DATA_DIR / f"{project_id}_features.parquet"
    if not feat_path.exists():
        raise HTTPException(status_code=404, detail="Features not computed yet.")

    try:
        import polars as pl
        df = pl.read_parquet(feat_path)
        if symbol:
            df = df.filter(pl.col("symbol") == symbol)
        return {
            "columns": df.columns,
            "n_rows": len(df),
            "data": df.tail(limit).fill_nan(None).to_dicts(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints: Signals / Strategies
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/strategies")
def create_strategy(project_id: str, req: CreateStrategyRequest):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        strategy = Strategy(
            id=str(uuid.uuid4())[:8],
            project_id=project_id,
            name=req.name,
            signals=req.signals,
            config=req.config,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)
        return _strategy_to_dict(strategy)
    finally:
        db.close()


@app.get("/projects/{project_id}/strategies")
def list_strategies(project_id: str):
    db = SessionLocal()
    try:
        strategies = db.query(Strategy).filter(Strategy.project_id == project_id).all()
        return [_strategy_to_dict(s) for s in strategies]
    finally:
        db.close()


@app.post("/projects/{project_id}/signals/explore")
def explore_conditional_prob(project_id: str, req: ConditionalProbExplorerRequest):
    """UI: Conditional Probability Explorer"""
    feat_path = DATA_DIR / f"{project_id}_features.parquet"
    if not feat_path.exists():
        raise HTTPException(status_code=404, detail="Features not computed yet.")

    try:
        _load_quant_modules()
        import polars as pl
        from signal_engine import ConditionalProbabilitySignal

        features = pl.read_parquet(feat_path)
        sig = ConditionalProbabilitySignal()
        result = sig.compute_explorer(
            features, req.symbol, req.condition_col, req.condition_threshold
        )
        result["symbol"] = req.symbol
        result["condition_col"] = req.condition_col
        result["condition_threshold"] = req.condition_threshold
        return result
    except Exception as e:
        logger.exception("Conditional prob explorer failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints: Runs
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/runs/backtest")
def run_backtest(project_id: str, req: RunBacktestRequest, background_tasks: BackgroundTasks):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        run_id = str(uuid.uuid4())[:8]
        run = Run(
            id=run_id,
            project_id=project_id,
            strategy_id=req.strategy_id,
            run_type="backtest",
            status="running",
            config={
                "fee_bps": req.fee_bps,
                "slippage_bps": req.slippage_bps,
                "risk_free_rate": req.risk_free_rate,
                "signals": req.signals or ["conditional_probability", "pca_regime"],
                "correction_method": req.correction_method,
                "n_permutations": req.n_permutations,
            },
        )
        db.add(run)
        db.commit()

        # Run synchronously (could be backgrounded in production)
        try:
            result = _execute_backtest(project, run, req)
            run.status = "complete"
            run.metrics = result.get("metrics", {})
            run.validation = result.get("validation", {})
            run.artifacts_dir = str(ARTIFACTS_DIR / run_id)
            run.completed_at = datetime.utcnow()
        except Exception as e:
            logger.exception("Backtest failed")
            run.status = "failed"
            run.error = str(e)

        db.commit()
        return _run_to_dict(run)
    finally:
        db.close()


@app.post("/projects/{project_id}/runs/walkforward")
def run_walkforward(project_id: str, req: RunWalkForwardRequest):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        run_id = str(uuid.uuid4())[:8]
        run = Run(
            id=run_id,
            project_id=project_id,
            run_type="walkforward",
            status="running",
            config={
                "fee_bps": req.fee_bps,
                "slippage_bps": req.slippage_bps,
                "train_periods": req.train_periods,
                "test_periods": req.test_periods,
                "signals": req.signals or ["conditional_probability", "pca_regime"],
            },
        )
        db.add(run)
        db.commit()

        try:
            result = _execute_walkforward(project, run, req)
            run.status = "complete"
            run.metrics = result.get("combined_metrics", {})
            run.validation = result
            run.completed_at = datetime.utcnow()
        except Exception as e:
            logger.exception("Walk-forward failed")
            run.status = "failed"
            run.error = str(e)

        db.commit()
        return _run_to_dict(run)
    finally:
        db.close()


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    db = SessionLocal()
    try:
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return _run_to_dict(run)
    finally:
        db.close()


@app.get("/runs")
def list_runs():
    """Return all runs (newest first), with project context attached."""
    db = SessionLocal()
    try:
        runs = db.query(Run).order_by(Run.created_at.desc()).limit(100).all()
        result = []
        for r in runs:
            d = _run_to_dict(r)
            project = db.query(Project).filter(Project.id == r.project_id).first()
            if project:
                d["project_name"] = project.name
                d["symbols"] = project.symbols
                d["start_date"] = project.start_date
                d["end_date"] = project.end_date
            result.append(d)
        return result
    finally:
        db.close()


@app.get("/runs/{run_id}/report")
def get_report(run_id: str):
    report_path = ARTIFACTS_DIR / run_id / "report.md"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    return PlainTextResponse(report_path.read_text())


@app.get("/runs/{run_id}/metrics")
def get_run_metrics(run_id: str):
    db = SessionLocal()
    try:
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return _sanitize({
            "run_id": run_id,
            "metrics": run.metrics,
            "validation": run.validation,
            "status": run.status,
        })
    finally:
        db.close()


@app.get("/runs/{run_id}/equity_curve")
def get_equity_curve(run_id: str):
    ec_path = ARTIFACTS_DIR / run_id / "equity_curve.json"
    if not ec_path.exists():
        raise HTTPException(status_code=404, detail="Equity curve not found")
    return json.loads(ec_path.read_text())


# ---------------------------------------------------------------------------
# Portfolio Optimization
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/optimize")
def optimize_portfolio(project_id: str, req: OptimizeRequest):
    feat_path = DATA_DIR / f"{project_id}_features.parquet"
    if not feat_path.exists():
        raise HTTPException(status_code=404, detail="Features not computed yet.")

    try:
        _load_quant_modules()
        import polars as pl
        from portfolio_optimizer import MarkowitzOptimizer

        features = pl.read_parquet(feat_path)
        returns_df = features.select(["timestamp", "symbol", "returns"]).drop_nulls()

        optimizer = MarkowitzOptimizer()

        if req.efficient_frontier:
            frontier = optimizer.efficient_frontier(
                returns_df,
                n_points=req.n_frontier_points,
                weight_bounds=tuple(req.weight_bounds),
            )
            return {"frontier": frontier}

        result = optimizer.optimize(
            returns_df,
            objective=req.objective,
            weight_bounds=tuple(req.weight_bounds),
            target_return=req.target_return,
        )
        return result.to_dict()
    except Exception as e:
        logger.exception("Optimization failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Stochastic Finance
# ---------------------------------------------------------------------------

@app.post("/finance/gbm")
def simulate_gbm(req: GBMRequest):
    try:
        _load_quant_modules()
        from stochastic_finance import simulate_gbm_paths
        return simulate_gbm_paths(
            mu=req.mu, sigma=req.sigma, s0=req.s0,
            T=req.T, n_steps=req.n_steps, n_paths=req.n_paths,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/finance/options")
def price_option(req: OptionPriceRequest):
    try:
        _load_quant_modules()
        from stochastic_finance import price_option_full
        return price_option_full(req.S, req.K, req.T, req.r, req.sigma, req.option_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints: Options Chain
# ---------------------------------------------------------------------------

@app.post("/options/refresh")
def options_refresh(req: OptionsRefreshRequest, background_tasks: BackgroundTasks):
    """Trigger a background fetch of options chains + Greeks for a symbol list."""
    from options_feed import SP500_UNIVERSE
    symbols = req.symbols or SP500_UNIVERSE

    db = SessionLocal()
    try:
        job_id = str(uuid.uuid4())[:8]
        job = OptionsRefreshJob(
            id=job_id,
            status="running",
            symbols_total=len(symbols),
            symbols_done=0,
            symbols_failed={},
            risk_free_rate=req.risk_free_rate,
        )
        db.add(job)
        db.commit()
    finally:
        db.close()

    background_tasks.add_task(
        _run_options_refresh, job_id, symbols, req.risk_free_rate, req.max_workers
    )
    return {"job_id": job_id, "symbols_total": len(symbols), "status": "running"}


def _run_options_refresh(job_id: str, symbols: list[str], rfr: float, max_workers: int):
    from options_feed import OptionsProvider, OptionsStore
    provider = OptionsProvider()
    store = OptionsStore(OPTIONS_DIR)
    db = SessionLocal()

    done = 0
    failed: dict[str, str] = {}

    try:
        def _progress(sym: str, ok: bool):
            nonlocal done
            done += 1
            if not ok:
                failed[sym] = "no data"
            try:
                job = db.query(OptionsRefreshJob).filter(OptionsRefreshJob.id == job_id).first()
                if job:
                    job.symbols_done = done
                    job.symbols_failed = dict(failed)
                    db.commit()
            except Exception:
                pass

        result = provider.fetch_universe(symbols, rfr=rfr, max_workers=max_workers, progress_cb=_progress)

        for sym, df in result["data"].items():
            try:
                store.save(sym, df)
            except Exception as e:
                failed[sym] = str(e)

        for sym, err in result["errors"].items():
            failed[sym] = err

        job = db.query(OptionsRefreshJob).filter(OptionsRefreshJob.id == job_id).first()
        if job:
            job.status = "complete"
            job.symbols_done = result["completed"]
            job.symbols_failed = failed
            job.completed_at = datetime.utcnow()
            db.commit()

    except Exception as exc:
        logger.exception("Options refresh job %s failed", job_id)
        job = db.query(OptionsRefreshJob).filter(OptionsRefreshJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


@app.get("/options/refresh/{job_id}")
def options_refresh_status(job_id: str):
    """Poll progress of a running options refresh job."""
    db = SessionLocal()
    try:
        job = db.query(OptionsRefreshJob).filter(OptionsRefreshJob.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return {
            "job_id":          job.id,
            "status":          job.status,
            "symbols_total":   job.symbols_total,
            "symbols_done":    job.symbols_done,
            "symbols_failed":  job.symbols_failed,
            "started_at":      str(job.started_at),
            "completed_at":    str(job.completed_at) if job.completed_at else None,
        }
    finally:
        db.close()


@app.get("/options/universe")
def options_universe():
    """List all symbols that have options data, with snapshot timestamps."""
    from options_feed import OptionsStore
    store = OptionsStore(OPTIONS_DIR)
    symbols = store.list_symbols()
    return {
        "symbols": [
            {"symbol": s, "snapshot_at": store.snapshot_time(s)}
            for s in symbols
        ],
        "total": len(symbols),
    }


@app.get("/options/{symbol}/expirations")
def options_expirations(symbol: str):
    """List available expiration dates for a symbol."""
    from options_feed import OptionsStore
    store = OptionsStore(OPTIONS_DIR)
    exps = store.list_expirations(symbol.upper())
    if not exps:
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}. Run /options/refresh first.")
    return {"symbol": symbol.upper(), "expirations": exps, "count": len(exps)}


@app.get("/options/{symbol}/greeks/summary")
def options_greeks_summary(symbol: str, expiration: Optional[str] = None):
    """Aggregated Greeks summary (put/call ratio, max gamma strike, avg IV, etc.)."""
    from options_feed import OptionsStore
    store = OptionsStore(OPTIONS_DIR)
    summary = store.greeks_summary(symbol.upper(), expiration)
    if not summary:
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}.")
    return _sanitize(summary)


@app.get("/options/{symbol}/analytics")
def options_analytics(symbol: str, expiration: Optional[str] = None):
    """Advanced analytics for a symbol: IVR, HV20/30, GEX per strike, Max Pain, ΔOI.
    NOTE: Must be defined before /options/{symbol}/{expiration} to avoid route shadowing."""
    import yfinance as yf
    import polars as pl
    from options_feed import OptionsStore, compute_analytics

    store = OptionsStore(OPTIONS_DIR)
    df_full = store.load(symbol.upper())
    if df_full.is_empty():
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}. Fetch first.")

    exps = sorted(df_full["expiration"].unique().to_list())
    active_exp = expiration if expiration and expiration in exps else (exps[0] if exps else None)
    df = df_full.filter(pl.col("expiration") == active_exp) if active_exp else df_full

    df_prev_full = store.load_prev(symbol.upper())
    df_prev = (
        df_prev_full.filter(pl.col("expiration") == active_exp)
        if active_exp and not df_prev_full.is_empty()
        else df_prev_full
    )

    spot_col = df_full["spot"].drop_nulls().to_list()
    spot = float(spot_col[0]) if spot_col else 0.0

    price_history: list[dict] = []
    try:
        hist = yf.Ticker(symbol.upper()).history(period="1y")
        if not hist.empty:
            price_history = [{"close": float(row["Close"])} for _, row in hist.iterrows()]
    except Exception:
        pass

    analytics = compute_analytics(symbol.upper(), df, df_prev, spot, price_history)
    return _sanitize(analytics)


@app.get("/options/{symbol}/advanced")
def options_advanced(symbol: str):
    """Term structure, 25Δ skew, rolling HV trend, liquidity stats, and earnings catalyst."""
    import yfinance as yf
    import polars as pl
    from options_feed import OptionsStore, compute_term_structure, compute_hv_trend

    store   = OptionsStore(OPTIONS_DIR)
    df_full = store.load(symbol.upper())
    if df_full.is_empty():
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}. Fetch first.")

    spot_col = df_full["spot"].drop_nulls().to_list()
    spot     = float(spot_col[0]) if spot_col else 0.0

    price_history: list[dict] = []
    earnings_date: str | None = None
    try:
        ticker = yf.Ticker(symbol.upper())
        hist   = ticker.history(period="1y")
        if not hist.empty:
            price_history = [
                {"close": float(row["Close"]), "date": str(idx.date())}
                for idx, row in hist.iterrows()
            ]
        try:
            cal = ticker.calendar
            if cal is not None:
                if hasattr(cal, "columns") and "Earnings Date" in cal.columns:
                    dates = cal["Earnings Date"].dropna().tolist()
                    if dates:
                        d = dates[0]
                        earnings_date = str(d.date()) if hasattr(d, "date") else str(d)
                elif isinstance(cal, dict) and "Earnings Date" in cal:
                    ed = cal["Earnings Date"]
                    if hasattr(ed, "__iter__") and not isinstance(ed, str):
                        ed = list(ed)
                        if ed:
                            d = ed[0]
                            earnings_date = str(d.date()) if hasattr(d, "date") else str(d)
                    else:
                        earnings_date = str(ed)
        except Exception:
            pass
    except Exception:
        pass

    term_structure = compute_term_structure(df_full, spot)
    hv_trend       = compute_hv_trend(price_history)

    # Liquidity breakdown per expiration
    liq_stats: dict = {}
    if not df_full.is_empty():
        for exp in df_full["expiration"].unique().to_list():
            exp_df = df_full.filter(pl.col("expiration") == exp)
            liq_stats[exp] = {
                "total":        len(exp_df),
                "liquid_100":   int(exp_df.filter(pl.col("open_interest") >= 100).shape[0]),
                "liquid_1000":  int(exp_df.filter(pl.col("open_interest") >= 1000).shape[0]),
            }

    return _sanitize({
        "symbol":          symbol.upper(),
        "spot":            spot,
        "term_structure":  term_structure,
        "hv_trend":        hv_trend,
        "liquidity_stats": liq_stats,
        "earnings_date":   earnings_date,
    })


@app.get("/options/{symbol}/{expiration}")
def options_chain_by_expiry(symbol: str, expiration: str, option_type: Optional[str] = None):
    """Options chain for a specific expiration. option_type: 'call' | 'put' | None (both)."""
    from options_feed import OptionsStore
    import polars as pl
    store = OptionsStore(OPTIONS_DIR)
    df = store.load_expiration(symbol.upper(), expiration)
    if df.is_empty():
        raise HTTPException(status_code=404, detail=f"No data for {symbol} expiry {expiration}.")
    if option_type:
        df = df.filter(pl.col("option_type") == option_type.lower())
    df = df.sort(["option_type", "strike"])
    return _sanitize(df.fill_nan(None).to_dicts())


@app.get("/options/{symbol}")
def options_chain(symbol: str, expiration: Optional[str] = None, limit: int = 500):
    """Full latest options chain for a symbol. Optionally filter by expiration."""
    from options_feed import OptionsStore
    import polars as pl
    store = OptionsStore(OPTIONS_DIR)
    if expiration:
        df = store.load_expiration(symbol.upper(), expiration)
    else:
        df = store.load(symbol.upper())
    if df.is_empty():
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}. Run /options/refresh first.")
    df = df.sort(["expiration", "option_type", "strike"])
    snapshot_at = store.snapshot_time(symbol.upper())
    expirations = store.list_expirations(symbol.upper())
    return _sanitize({
        "symbol":      symbol.upper(),
        "snapshot_at": snapshot_at,
        "expirations": expirations,
        "total":       len(df),
        "data":        df.head(limit).fill_nan(None).to_dicts(),
    })


@app.post("/finance/lmsr")
def lmsr_market(req: LMSRRequest):
    try:
        _load_quant_modules()
        from stochastic_finance import LMSRMarket
        market = LMSRMarket(n_outcomes=req.n_outcomes, b=req.b)
        results = []
        for trade in req.trades:
            result = market.buy(trade.get("outcome", 0), trade.get("shares", 1.0))
            results.append(result)
        return {
            "state": market.state(),
            "trades": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Signal Reading Jobs  (persistent, background-queued)
# ---------------------------------------------------------------------------

@app.post("/projects/{project_id}/signals/reading")
def create_signal_reading(
    project_id: str,
    req: SignalReadingRequest,
    background_tasks: BackgroundTasks,
):
    """Start a background job that computes all 5 live signal readings for a symbol."""
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        feat_path = DATA_DIR / f"{project_id}_features.parquet"
        if not feat_path.exists():
            raise HTTPException(
                status_code=404,
                detail="Feature data not found. Run 'Compute Features' for this project first.",
            )

        job_id = str(uuid.uuid4())[:8]
        job = SignalReadingJob(
            id=job_id,
            project_id=project_id,
            symbol=req.symbol.upper(),
            status="pending",
        )
        db.add(job)
        db.commit()

        background_tasks.add_task(
            _run_signal_reading, job_id, project_id, req.symbol.upper(), feat_path
        )

        return {"job_id": job_id, "status": "pending", "symbol": req.symbol.upper()}
    finally:
        db.close()


@app.get("/signals/reading/{job_id}")
def get_signal_reading(job_id: str):
    """Poll a signal reading job for status and results."""
    db = SessionLocal()
    try:
        job = db.query(SignalReadingJob).filter(SignalReadingJob.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return {
            "job_id":      job.id,
            "project_id":  job.project_id,
            "symbol":      job.symbol,
            "status":      job.status,
            "results":     job.results,
            "error":       job.error,
            "created_at":  str(job.created_at),
            "completed_at": str(job.completed_at) if job.completed_at else None,
        }
    finally:
        db.close()


def _run_signal_reading(job_id: str, project_id: str, symbol: str, feat_path: Path):
    """Background: compute all 5 signals for symbol and store readings in DB."""
    db = SessionLocal()
    try:
        job = db.query(SignalReadingJob).filter(SignalReadingJob.id == job_id).first()
        job.status = "running"
        db.commit()

        _load_quant_modules()
        import polars as pl
        import numpy as np
        from signal_engine import (
            ConditionalProbabilitySignal,
            BayesianUpdateSignal,
            RegressionAlphaSignal,
            PCARegimeFilter,
            FatTailRiskSignal,
        )

        features = pl.read_parquet(feat_path)

        # Fall back to first available symbol if requested one is absent
        available = features["symbol"].unique().to_list()
        if symbol not in available:
            symbol = available[0] if available else symbol

        readings: dict = {}

        # ── helpers ──────────────────────────────────────────────────────────
        def _last(arr):
            """Last non-NaN value from a numpy array, or 0."""
            arr = np.asarray(arr, dtype=float)
            valid = arr[~np.isnan(arr)]
            return float(valid[-1]) if len(valid) else 0.0

        def _verdict_strength(val, bull_thr, bear_thr, scale):
            if val > bull_thr:
                verdict = "bullish"
            elif val < bear_thr:
                verdict = "bearish"
            else:
                verdict = "neutral"
            strength = int(min(abs(val) / scale * 100, 100))
            return verdict, strength

        # ── 1) Conditional Probability ────────────────────────────────────
        try:
            cp = ConditionalProbabilitySignal()

            # Full threshold scan for the chart (51 points, -2.5 → 2.5)
            cp_curve = []
            base_p_up = None
            for tau in [round(-2.5 + i * 0.1, 1) for i in range(51)]:
                r = cp.compute_explorer(features, symbol, "volume_zscore", tau)
                if base_p_up is None:
                    base_p_up = r.get("p_up") or 0.53
                cp_curve.append({
                    "x": tau,
                    "c": r.get("p_up_given_cond") if r.get("p_up_given_cond") is not None else base_p_up,
                })

            # Stats at default threshold 1.5
            explorer = cp.compute_explorer(features, symbol, "volume_zscore", 1.5)
            edge     = explorer.get("edge") or 0.0
            p_val    = explorer.get("p_value") if explorer.get("p_value") is not None else 1.0
            p_up     = explorer.get("p_up") or 0.53
            p_up_c   = explorer.get("p_up_given_cond") or p_up
            sig_flag = p_val < 0.1 if p_val is not None else False

            if sig_flag and edge > 0.02:
                verdict = "bullish"
            elif sig_flag and edge < -0.02:
                verdict = "bearish"
            else:
                verdict = "neutral"

            strength = int(min(abs(edge) / 0.10 * 100, 100))
            sig_word = "significant" if p_val < 0.05 else "not yet significant"

            readings["conditional_probability"] = {
                "signal":   edge,
                "verdict":  verdict,
                "strength": strength,
                "blurb":    (
                    f"When volume spikes (z > 1.5), {symbol} closes up "
                    f"{p_up_c*100:.0f}% of days vs the usual {p_up*100:.0f}% — "
                    f"a {abs(edge)*100:.1f} pp edge ({sig_word}, p={p_val:.3f})."
                ) if p_val is not None else f"Base rate: {p_up*100:.0f}% up days.",
                "raw": {
                    "p_up":            round(p_up, 4),
                    "p_up_given_cond": round(p_up_c, 4),
                    "edge":            round(edge, 4),
                    "z_stat":          round(explorer.get("z_stat") or 0, 3),
                    "p_value":         round(p_val, 4),
                    "n_condition":     explorer.get("n_condition"),
                    "n_total":         explorer.get("n_total"),
                    "ci_lower":        round(explorer.get("ci_lower") or 0, 4),
                    "ci_upper":        round(explorer.get("ci_upper") or 0, 4),
                },
                "cp_curve": cp_curve,
            }
        except Exception as e:
            logger.error(f"CP signal failed: {e}", exc_info=True)
            readings["conditional_probability"] = {
                "signal": 0, "verdict": "neutral", "strength": 0,
                "blurb": f"Could not compute: {e}", "raw": {}, "cp_curve": [],
            }

        # ── 2) Bayesian Update ────────────────────────────────────────────
        try:
            bay = BayesianUpdateSignal()
            res = bay.compute(features, symbol)
            last = _last(res.signal)
            verdict, strength = _verdict_strength(last, 0.001, -0.001, 0.005)
            direction = "positive" if last > 0 else "negative"
            readings["bayesian_update"] = {
                "signal":   last,
                "verdict":  verdict,
                "strength": strength,
                "blurb": (
                    f"Kalman belief for {symbol}: expected return is {direction} "
                    f"at {last*100:+.3f}%/day  ({last*252*100:+.1f}% annualised)."
                ),
                "raw": {"posterior_mean": round(last, 6)},
            }
        except Exception as e:
            logger.error(f"Bayesian signal failed: {e}", exc_info=True)
            readings["bayesian_update"] = {
                "signal": 0, "verdict": "neutral", "strength": 0,
                "blurb": f"Could not compute: {e}", "raw": {},
            }

        # ── 3) Regression Alpha ───────────────────────────────────────────
        try:
            reg = RegressionAlphaSignal()
            res = reg.compute(features, symbol)
            last_t = _last(res.signal)
            alpha_series = np.asarray(res.metadata.get("alpha_series", []), dtype=float)
            last_alpha = _last(alpha_series) if len(alpha_series) > 0 else 0.0
            verdict, strength = _verdict_strength(last_t, 1.0, -1.0, 3.0)
            sig_word = (
                "statistically meaningful (≥95%)" if abs(last_t) >= 1.96
                else "not yet significant at 95%"
            )
            readings["regression_alpha"] = {
                "signal":   last_t,
                "verdict":  verdict,
                "strength": strength,
                "blurb": (
                    f"Rolling alpha t-stat for {symbol}: {last_t:+.2f}  ({sig_word}). "
                    f"Daily alpha: {last_alpha*100:+.3f}%."
                ),
                "raw": {
                    "t_stat":      round(last_t, 3),
                    "daily_alpha": round(last_alpha, 6),
                },
            }
        except Exception as e:
            logger.error(f"Regression signal failed: {e}", exc_info=True)
            readings["regression_alpha"] = {
                "signal": 0, "verdict": "neutral", "strength": 0,
                "blurb": f"Could not compute: {e}", "raw": {},
            }

        # ── 4) PCA Regime ─────────────────────────────────────────────────
        try:
            pca = PCARegimeFilter()
            res = pca.compute(features, symbol)
            last = _last(res.signal)
            var_arr = np.asarray(res.metadata.get("top_variance_explained", []), dtype=float)
            last_var = _last(var_arr) if len(var_arr) > 0 else None

            if last >= 1.0:
                verdict, regime_name = "bullish", "RISK-ON"
            elif last <= -1.0:
                verdict, regime_name = "bearish", "RISK-OFF"
            else:
                verdict, regime_name = "neutral", "TRANSITION"

            strength = int(abs(last) * 100)
            var_str  = f"{last_var*100:.0f}%" if last_var is not None and not np.isnan(last_var) else "N/A"

            if last >= 1.0:
                blurb = (
                    f"Regime: {regime_name}. Top PC explains {var_str} of variance — "
                    "stocks trading independently. Healthy environment for risk-taking."
                )
            elif last <= -1.0:
                blurb = (
                    f"Regime: {regime_name}. Top PC explains {var_str} of variance — "
                    "everything correlated. Systemic risk detected; stay cautious."
                )
            else:
                blurb = (
                    f"Regime: {regime_name}. Top PC explains {var_str} of variance — "
                    "transitioning between risk states. Watch for direction."
                )

            readings["pca_regime"] = {
                "signal":   last,
                "verdict":  verdict,
                "strength": strength,
                "blurb":    blurb,
                "raw": {
                    "regime":                regime_name.lower(),
                    "top_variance_explained": round(last_var, 4) if last_var is not None and not np.isnan(last_var) else None,
                    "signal_value":          last,
                },
            }
        except Exception as e:
            logger.error(f"PCA signal failed: {e}", exc_info=True)
            readings["pca_regime"] = {
                "signal": 0, "verdict": "neutral", "strength": 0,
                "blurb": f"Could not compute: {e}", "raw": {},
            }

        # ── 5) Fat-Tail Risk ──────────────────────────────────────────────
        try:
            fat = FatTailRiskSignal()
            res = fat.compute(features, symbol)
            last = _last(res.signal)
            if last > 0.7:
                verdict = "bullish"
                blurb_tail = "Low tail risk — model comfortable with full exposure."
            elif last < 0.4:
                verdict = "bearish"
                blurb_tail = "Elevated tail risk — model scaling back exposure."
            else:
                verdict = "neutral"
                blurb_tail = "Moderate tail risk — partial position sizing."

            strength = int(last * 100)
            readings["fat_tail_risk"] = {
                "signal":   last,
                "verdict":  verdict,
                "strength": strength,
                "blurb": (
                    f"Tail-risk model recommends {last*100:.0f}% position size for {symbol}. "
                    f"{blurb_tail}"
                ),
                "raw": {"position_size": round(last, 4)},
            }
        except Exception as e:
            logger.error(f"Fat-tail signal failed: {e}", exc_info=True)
            readings["fat_tail_risk"] = {
                "signal": 0.5, "verdict": "neutral", "strength": 50,
                "blurb": f"Could not compute: {e}", "raw": {},
            }

        # ── Simple vote consensus (kept for Signal Pulse cards) ───────────
        verdicts   = [r["verdict"] for r in readings.values()]
        n_bull     = verdicts.count("bullish")
        n_bear     = verdicts.count("bearish")
        n_neut     = verdicts.count("neutral")
        vote_score = (n_bull - n_bear) / max(len(verdicts), 1)
        conviction = "high" if abs(vote_score) >= 0.6 else "moderate" if abs(vote_score) >= 0.2 else "low"
        overall    = "bullish" if vote_score > 0.1 else "bearish" if vote_score < -0.1 else "neutral"

        # ── Weighted composite score (two-stage quant architecture) ───────
        #
        # Stage 1 — Directional composite (4 signals, weights from academic lit)
        #   Regression Alpha  0.35  — HAC t-stat is purest factor-neutral alpha
        #                             (Asness 1994; Frazzini et al. 2013)
        #   Bayesian Update   0.25  — MMSE-optimal belief update / trend signal
        #                             (Zellner 1971; Jegadeesh & Titman 1993)
        #   Conditional Prob  0.20  — Statistical edge; sparse but credible
        #                             (Lo & MacKinlay 1988)
        #   PCA Regime        0.20  — Orthogonal macro/turbulence dimension
        #                             (Kritzman et al. 2011)
        #
        # Stage 2 — Fat-Tail acts as a multiplicative gate, not a directional vote.
        #   C_final = C_dir * fat_tail_scalar   (fat_tail in [0,1])
        #   This scales conviction without changing direction.

        from scipy.stats import norm as _norm

        def _norm_alpha(t):
            """CDF transform — anchors 1σ significance at ±0.5 output."""
            return float(2 * _norm.cdf(float(t) / 1.96) - 1)

        def _norm_bayes(mu):
            """Clip at ±50 bps/day (≈ 2.5σ for 2 % ann. vol asset)."""
            return float(np.clip(float(mu) / 0.005, -1.0, 1.0))

        def _norm_cp(edge):
            """Linear scale; 15 pp edge saturates at ±1."""
            return float(np.clip(float(edge) / 0.15, -1.0, 1.0))

        def _norm_pca(sig):
            """Already in {-1, 0, +1} — identity."""
            return float(np.clip(float(sig), -1.0, 1.0))

        _raw = {k: readings.get(k, {}).get("signal", 0) or 0 for k in readings}

        norm_values = {
            "regression_alpha":        _norm_alpha(_raw.get("regression_alpha", 0)),
            "bayesian_update":          _norm_bayes(_raw.get("bayesian_update", 0)),
            "conditional_probability":  _norm_cp(_raw.get("conditional_probability", 0)),
            "pca_regime":               _norm_pca(_raw.get("pca_regime", 0)),
        }
        dir_weights = {
            "regression_alpha":        0.35,
            "bayesian_update":          0.25,
            "conditional_probability":  0.20,
            "pca_regime":               0.20,
        }
        weight_rationale = {
            "regression_alpha":       "HAC-corrected alpha t-stat is the purest factor-neutral signal (Asness 1994; Frazzini 2013). Highest weight because it explicitly controls for known risk premia.",
            "bayesian_update":        "MMSE-optimal Kalman belief update captures trend/momentum — one of the most replicated factors in finance (Jegadeesh & Titman 1993). Second weight.",
            "conditional_probability":"Sparse but credible statistical edge when p < 0.10 (Lo & MacKinlay 1988). Lower weight due to zero readings on most days.",
            "pca_regime":             "Cross-sectional turbulence detector provides orthogonal macro information not captured by single-asset signals (Kritzman et al. 2011).",
        }
        fat_tail_rationale = "Applied as a multiplicative gate (C_final = C_dir × size), not a directional vote. When tail risk is high, this scales down conviction without flipping direction — consistent with dynamic risk-budgeting practice."

        C_dir = sum(dir_weights[k] * norm_values[k] for k in dir_weights)
        fat_tail_scalar = float(_raw.get("fat_tail_risk", 0.5))
        C_final = C_dir * fat_tail_scalar

        def _regime(score):
            if   score >=  0.50: return "Strong Buy"
            elif score >=  0.20: return "Buy"
            elif score > -0.20:  return "Hold"
            elif score > -0.50:  return "Sell"
            else:                return "Strong Sell"

        contributions = {
            k: {
                "normalized":   round(norm_values[k], 4),
                "weight":       dir_weights[k],
                "contribution": round(dir_weights[k] * norm_values[k], 4),
                "rationale":    weight_rationale[k],
            }
            for k in dir_weights
        }

        composite = {
            "score_directional": round(C_dir, 4),
            "score_final":       round(C_final, 4),
            "fat_tail_gate":     round(fat_tail_scalar, 4),
            "regime_directional": _regime(C_dir),
            "regime_final":       _regime(C_final),
            "contributions":      contributions,
            "fat_tail_rationale": fat_tail_rationale,
        }

        results = {
            "symbol":      symbol,
            "project_id":  project_id,
            "computed_at": datetime.utcnow().isoformat(),
            "readings":    readings,
            "consensus": {
                "bullish_count": n_bull,
                "bearish_count": n_bear,
                "neutral_count": n_neut,
                "score":         round(vote_score, 3),
                "conviction":    conviction,
                "overall":       overall,
            },
            "composite": composite,
        }

        job.results      = results
        job.status       = "complete"
        job.completed_at = datetime.utcnow()
        db.commit()

    except Exception as e:
        logger.error(f"Signal reading job {job_id} failed: {e}", exc_info=True)
        try:
            job.status = "failed"
            job.error  = str(e)
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Quick Signal Reading — no project required, fetches data on-the-fly
# ---------------------------------------------------------------------------

@app.post("/signals/quick")
def create_quick_signal_reading(req: SignalReadingRequest, background_tasks: BackgroundTasks):
    """
    Start a quick signal-reading job for any symbol without needing a pre-built project.
    Downloads 3y of price data via yfinance, computes features on-the-fly, then runs
    all 5 quantitative signals. Poll /signals/reading/{job_id} for results.
    """
    db = SessionLocal()
    try:
        job_id = str(uuid.uuid4())[:8]
        job = SignalReadingJob(
            id=job_id,
            project_id="__quick__",
            symbol=req.symbol.upper(),
            status="pending",
        )
        db.add(job)
        db.commit()
        background_tasks.add_task(_run_quick_signal_reading, job_id, req.symbol.upper())
        return {"job_id": job_id, "status": "pending", "symbol": req.symbol.upper()}
    finally:
        db.close()


def _run_quick_signal_reading(job_id: str, symbol: str):
    """
    Background worker: build features from yfinance data then reuse
    _run_signal_reading with a temp parquet file.
    """
    tmp_path: Optional[Path] = None
    # Mark job as running then close the session before the long yfinance fetch
    db = SessionLocal()
    try:
        job = db.query(SignalReadingJob).filter(SignalReadingJob.id == job_id).first()
        if job:
            job.status = "running"
            db.commit()
    finally:
        db.close()

    try:

        _load_quant_modules()
        import yfinance as yf
        import polars as pl
        from feature_engine import FeatureEngine

        hist = yf.Ticker(symbol).history(period="3y")
        if hist.empty:
            raise ValueError(f"No price data for {symbol}")

        # Build Polars DataFrame without pyarrow (same pattern used elsewhere)
        idx = hist.index
        if hasattr(idx.dtype, "tz") and idx.dtype.tz:
            ts_us = [int(t.timestamp() * 1_000_000) for t in idx]
        else:
            ts_us = [int(t.value // 1_000) for t in idx]
        prices_df = pl.DataFrame({
            "timestamp": ts_us,
            "open":      hist["Open"].astype(float).tolist(),
            "high":      hist["High"].astype(float).tolist(),
            "low":       hist["Low"].astype(float).tolist(),
            "close":     hist["Close"].astype(float).tolist(),
            "volume":    hist["Volume"].astype(float).tolist(),
            "symbol":    [symbol] * len(hist),
        }).with_columns([pl.col("timestamp").cast(pl.Datetime("us"))])

        features = FeatureEngine().compute(prices_df)

        # Write to a temp parquet so _run_signal_reading can consume it
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
            tmp_path = Path(f.name)
        features.write_parquet(tmp_path)

        _run_signal_reading(job_id, "__quick__", symbol, tmp_path)

    except Exception as e:
        logger.error(f"Quick signal reading {job_id} failed: {e}", exc_info=True)
        db2 = SessionLocal()
        try:
            job2 = db2.query(SignalReadingJob).filter(SignalReadingJob.id == job_id).first()
            if job2:
                job2.status = "failed"
                job2.error  = str(e)
                db2.commit()
        finally:
            db2.close()
    finally:
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Signals Reference
# ---------------------------------------------------------------------------

@app.get("/signals/list")
def list_signals():
    return {
        "signals": [
            {
                "id": "conditional_probability",
                "name": "Conditional Probability",
                "description": "P(up | condition) vs P(up). Edge when conditional probability exceeds base rate.",
                "parameters": ["condition_col", "condition_threshold", "lookback"],
            },
            {
                "id": "bayesian_update",
                "name": "Bayesian Update",
                "description": "Kalman-style Gaussian belief update on expected return.",
                "parameters": ["prior_mean", "prior_variance", "decay"],
            },
            {
                "id": "regression_alpha",
                "name": "Regression Alpha",
                "description": "Rolling OLS alpha with Newey-West HAC errors.",
                "parameters": ["feature_cols", "lookback", "newey_west_lags"],
            },
            {
                "id": "pca_regime",
                "name": "PCA Regime Filter",
                "description": "Cross-sectional PCA for systemic risk regime detection.",
                "parameters": ["n_components", "lookback", "risk_off_threshold"],
            },
            {
                "id": "fat_tail_risk",
                "name": "Fat-Tail Risk",
                "description": "Student-t MLE position sizing based on tail risk.",
                "parameters": ["lookback", "target_var", "confidence"],
            },
        ]
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load_quant_modules():
    quant_path = str(Path(__file__).parent)
    if quant_path not in sys.path:
        sys.path.insert(0, quant_path)


def _execute_backtest(project, run, req) -> dict:
    _load_quant_modules()
    import polars as pl
    from data_ingestion import DataStore
    from feature_engine import FeatureEngine
    from signal_engine import SignalEngine, get_signal
    from backtest_engine import BacktestEngine, BacktestConfig
    from statistical_validation import StatisticalValidator
    from report_generator import generate_report

    store = DataStore(DATA_DIR)
    raw = store.load(project.id)
    if raw.is_empty():
        raise ValueError("No data available. Run ingest first.")

    # Features
    feat_path = DATA_DIR / f"{project.id}_features.parquet"
    if feat_path.exists():
        features = pl.read_parquet(feat_path)
    else:
        engine = FeatureEngine()
        features = engine.compute(raw)

    # Signals
    signal_names = req.signals or ["conditional_probability", "pca_regime"]
    signals_list = [get_signal(name) for name in signal_names]
    sig_engine = SignalEngine(signals_list)
    signal_df = sig_engine.run(features)

    # Backtest
    config = BacktestConfig(
        fee_bps=req.fee_bps,
        slippage_bps=req.slippage_bps,
        risk_free_rate=req.risk_free_rate,
    )
    bt_engine = BacktestEngine(config)

    prices = raw.select(["timestamp", "symbol", "open", "close"])

    # Merge signals onto prices timestamps
    if not signal_df.is_empty():
        bt_result = bt_engine.run(prices, signal_df)
    else:
        # Fallback: buy-and-hold
        bt_result = bt_engine.run(prices, pl.DataFrame())

    # Statistical validation
    validator = StatisticalValidator(
        correction_method=req.correction_method,
        n_permutations=req.n_permutations,
    )
    val_result = validator.validate_single(
        bt_result.daily_returns,
        strategy_name=f"run_{run.id}",
    )

    # Save equity curve
    run_artifacts = ARTIFACTS_DIR / run.id
    run_artifacts.mkdir(parents=True, exist_ok=True)

    ec_data = {
        "timestamps": [str(t) for t in bt_result.timestamps],
        "equity_curve": bt_result.equity_curve.tolist(),
        "daily_returns": bt_result.daily_returns.tolist(),
    }
    (run_artifacts / "equity_curve.json").write_text(json.dumps(ec_data))

    # Save trades
    if bt_result.trades:
        trades_data = [
            {
                "timestamp": str(t.timestamp),
                "symbol": t.symbol,
                "direction": t.direction,
                "quantity": t.quantity,
                "price": t.price,
                "fee": t.fee,
                "slippage": t.slippage,
                "net_value": t.net_value,
            }
            for t in bt_result.trades
        ]
        (run_artifacts / "trades.json").write_text(json.dumps(trades_data))

    # Report
    generate_report(
        run_id=run.id,
        project_name=project.name,
        strategy_config={
            "fee_bps": req.fee_bps,
            "slippage_bps": req.slippage_bps,
            "execution": "next_open",
        },
        backtest_metrics=bt_result.metrics,
        validation_result={
            "label": val_result.label,
            "t_stat": val_result.t_stat,
            "p_value_raw": val_result.p_value_raw,
            "p_value_corrected": val_result.p_value_corrected,
            "correction_method": val_result.correction_method,
            "sharpe_ratio": val_result.sharpe_ratio,
            "permutation_p_value": val_result.permutation_p_value,
            "n_observations": val_result.n_observations,
            "conclusion": val_result.conclusion,
            "warnings": val_result.warnings,
        },
        signals_used=signal_names,
        symbols=project.symbols,
        timeframe=project.timeframe,
        artifacts_dir=ARTIFACTS_DIR,
    )

    return {
        "metrics": bt_result.metrics,
        "validation": {
            "label": val_result.label,
            "t_stat": val_result.t_stat,
            "p_value_raw": val_result.p_value_raw,
            "p_value_corrected": val_result.p_value_corrected,
            "sharpe_ratio": val_result.sharpe_ratio,
            "permutation_p_value": val_result.permutation_p_value,
            "n_observations": val_result.n_observations,
            "conclusion": val_result.conclusion,
            "warnings": val_result.warnings,
        },
    }


def _execute_walkforward(project, run, req) -> dict:
    _load_quant_modules()
    import polars as pl
    from data_ingestion import DataStore
    from feature_engine import FeatureEngine
    from signal_engine import SignalEngine, get_signal
    from backtest_engine import WalkForwardEngine, BacktestConfig

    store = DataStore(DATA_DIR)
    raw = store.load(project.id)
    if raw.is_empty():
        raise ValueError("No data available.")

    feat_path = DATA_DIR / f"{project.id}_features.parquet"
    if feat_path.exists():
        import polars as pl
        features = pl.read_parquet(feat_path)
    else:
        engine = FeatureEngine()
        features = engine.compute(raw)

    signal_names = req.signals or ["conditional_probability", "pca_regime"]
    signals_list = [get_signal(name) for name in signal_names]
    sig_engine = SignalEngine(signals_list)
    signal_df = sig_engine.run(features)

    config = BacktestConfig(fee_bps=req.fee_bps, slippage_bps=req.slippage_bps)
    wf_engine = WalkForwardEngine(
        config=config,
        train_periods=req.train_periods,
        test_periods=req.test_periods,
    )

    prices = raw.select(["timestamp", "symbol", "open", "close"])
    return wf_engine.run(prices, signal_df)


def _sanitize(obj):
    """Recursively replace float nan/inf with None for JSON safety."""
    import math
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def _project_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "symbols": p.symbols,
        "timeframe": p.timeframe,
        "start_date": p.start_date,
        "end_date": p.end_date,
        "provider": p.provider,
        "status": p.status,
        "created_at": str(p.created_at),
    }


def _run_to_dict(r: Run) -> dict:
    return _sanitize({
        "id": r.id,
        "project_id": r.project_id,
        "strategy_id": r.strategy_id,
        "run_type": r.run_type,
        "status": r.status,
        "config": r.config,
        "metrics": r.metrics,
        "validation": r.validation,
        "error": r.error,
        "created_at": str(r.created_at),
        "completed_at": str(r.completed_at) if r.completed_at else None,
    })


def _strategy_to_dict(s: Strategy) -> dict:
    return {
        "id": s.id,
        "project_id": s.project_id,
        "name": s.name,
        "signals": s.signals,
        "config": s.config,
        "created_at": str(s.created_at),
    }


# ---------------------------------------------------------------------------
# Endpoints: Market Price History
# ---------------------------------------------------------------------------

@app.get("/market/price/{symbol}")
def market_price_history(symbol: str, period: str = "3mo"):
    """
    Daily OHLCV for any yfinance-compatible symbol.
    Cached: 5 min for intraday periods, 1 hour for historical periods.
    """
    sym = symbol.upper()
    # Use longer TTL for historical data (it doesn't change intraday)
    ttl = _TTL_MARKET_PRICE if period in ("1d", "5d", "1mo", "3mo") else _TTL_SENTIMENT
    cache_key = f"market:price:{sym}:{period}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    try:
        import yfinance as yf
        import math
        hist = yf.Ticker(sym).history(period=period)
        if hist.empty:
            raise HTTPException(status_code=404, detail=f"No price data for {sym}")
        data = []
        for ts, row in hist.iterrows():
            try:
                close = float(row["Close"])
                if math.isnan(close): continue
                vol = row.get("Volume", 0)
                data.append({
                    "date":   ts.strftime("%Y-%m-%d"),
                    "open":   round(float(row.get("Open",  close)), 2),
                    "high":   round(float(row.get("High",  close)), 2),
                    "low":    round(float(row.get("Low",   close)), 2),
                    "close":  round(close, 2),
                    "volume": int(vol) if vol and not math.isnan(float(vol)) else 0,
                })
            except (TypeError, ValueError):
                continue
        if not data:
            raise HTTPException(status_code=404, detail=f"No usable price data for {sym}")
        result = {"symbol": sym, "period": period, "data": data}
        _set_cache(cache_key, result, ttl, "market:price")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints: Market Overview Dashboard
# ---------------------------------------------------------------------------

def _compute_market_overview() -> dict:
    """
    Fetch and assemble the full market dashboard payload.
    Extracted as a standalone helper so both the endpoint and the background
    warmer can call it without going through the HTTP layer.
    """
    import yfinance as yf

    INDEX_SYMS   = ["SPY", "QQQ", "IWM", "DIA", "^VIX"]
    SECTOR_SYMS  = ["XLF", "XLK", "XLE", "XLV", "XLI", "XLB", "XLRE", "XLP", "XLU", "XLY", "XLC"]
    MACRO_SYMS   = ["^TNX", "^IRX", "HYG", "LQD", "GLD", "USO", "COPX", "UUP"]
    SECTOR_NAMES = {
        "XLF":"Financials",      "XLK":"Technology",    "XLE":"Energy",
        "XLV":"Health Care",     "XLI":"Industrials",   "XLB":"Materials",
        "XLRE":"Real Estate",    "XLP":"Cons. Staples",  "XLU":"Utilities",
        "XLY":"Cons. Discret.",  "XLC":"Comm. Services",
    }

    all_syms = INDEX_SYMS + SECTOR_SYMS + MACRO_SYMS
    raw = yf.download(all_syms, period="5d", auto_adjust=True, progress=False)

    if isinstance(raw.columns, type(raw.columns)) and hasattr(raw.columns, "levels"):
        try:
            close = raw["Close"]
        except KeyError:
            close = raw.xs("Close", axis=1, level=0)
    else:
        close = raw[["Close"]] if "Close" in raw.columns else raw

    def _last(sym):
        if sym not in close.columns: return None
        col = close[sym].dropna()
        return float(col.iloc[-1]) if len(col) else None

    def _chg(sym):
        if sym not in close.columns: return None
        col = close[sym].dropna()
        return float((col.iloc[-1] / col.iloc[-2] - 1) * 100) if len(col) >= 2 else None

    def _abs_chg(sym):
        if sym not in close.columns: return None
        col = close[sym].dropna()
        return float(col.iloc[-1] - col.iloc[-2]) if len(col) >= 2 else None

    indices = [
        {"symbol": sym, "price": round(p, 2), "change_pct": round(c, 2) if c is not None else None}
        for sym in ["SPY", "QQQ", "IWM", "DIA"]
        for p, c in [(_last(sym), _chg(sym))] if p
    ]

    vix, vix_chg = _last("^VIX"), _chg("^VIX")
    vix_regime = (
        "extreme_fear" if vix and vix > 30 else "fear" if vix and vix > 20
        else "calm" if vix and vix > 15 else "complacent"
    )

    sectors = [
        {"symbol": sym, "name": SECTOR_NAMES.get(sym, sym), "change_pct": round(c, 2)}
        for sym in SECTOR_SYMS
        for c in [_chg(sym)] if c is not None
    ]

    spy_mom    = _chg("SPY") or 0.0
    vix_signal = 80 if vix and vix < 15 else 60 if vix and vix < 20 else 40 if vix and vix < 25 else 25 if vix and vix < 30 else 10
    mom_signal = 50 + min(max(spy_mom * 10, -40), 40)
    breadth    = (sum(1 for s in sectors if s["change_pct"] > 0) / len(sectors) * 100) if sectors else 50
    score = max(0, min(100, int(round(0.40 * vix_signal + 0.35 * mom_signal + 0.25 * breadth))))
    sentiment_label = (
        "Extreme Greed" if score >= 75 else "Greed" if score >= 60
        else "Neutral" if score >= 40 else "Fear" if score >= 25 else "Extreme Fear"
    )

    ten_y, three_m   = _last("^TNX"), _last("^IRX")
    ten_y_d, three_m_d = _abs_chg("^TNX"), _abs_chg("^IRX")
    if ten_y is not None and three_m is not None:
        yc_slope     = round(ten_y - three_m, 2)
        curve_regime = "inverted" if yc_slope < -0.25 else "flat" if yc_slope < 0.25 else "steepening"
    else:
        yc_slope, curve_regime = None, None

    fixed_income = {
        "ten_year":    {"value": round(ten_y, 2) if ten_y else None, "daily_chg_bp": round(ten_y_d * 100, 1) if ten_y_d else None},
        "three_month": {"value": round(three_m, 2) if three_m else None, "daily_chg_bp": round(three_m_d * 100, 1) if three_m_d else None},
        "yield_curve": yc_slope, "curve_regime": curve_regime,
    }

    hyg_p, hyg_c = _last("HYG"), _chg("HYG")
    lqd_p, lqd_c = _last("LQD"), _chg("LQD")
    spread_chg   = round(hyg_c - lqd_c, 2) if hyg_c is not None and lqd_c is not None else None
    credit_stress = "high" if (spread_chg or 0) < -0.3 else "elevated" if (spread_chg or 0) < 0 else "low"
    credit = {
        "hyg": {"price": round(hyg_p, 2) if hyg_p else None, "change_pct": round(hyg_c, 2) if hyg_c is not None else None},
        "lqd": {"price": round(lqd_p, 2) if lqd_p else None, "change_pct": round(lqd_c, 2) if lqd_c is not None else None},
        "spread_change": spread_chg, "stress": credit_stress,
    }

    cross_asset = [
        {"symbol": sym, "name": name, "price": round(p, 2), "change_pct": round(c, 2) if c is not None else None}
        for sym, name in [("GLD","Gold"), ("USO","Crude Oil"), ("COPX","Copper"), ("UUP","Dollar")]
        for p, c in [(_last(sym), _chg(sym))] if p is not None
    ]

    return _sanitize({
        "indices": indices,
        "vix":     {"value": round(vix, 2) if vix else None, "change_pct": round(vix_chg, 2) if vix_chg is not None else None, "regime": vix_regime},
        "sectors": sorted(sectors, key=lambda x: x["change_pct"], reverse=True),
        "sentiment":    {"score": score, "label": sentiment_label},
        "fixed_income": fixed_income,
        "credit":       credit,
        "cross_asset":  cross_asset,
        "as_of":        datetime.utcnow().isoformat(),
    })


@app.get("/market/overview")
def market_overview():
    """
    Market dashboard: indices, VIX, Fear & Greed, fixed income (yields,
    yield curve), credit (HYG/LQD), cross-asset (Gold/Oil/Copper/Dollar),
    and 11 SPDR sectors. Served from persistent DB cache (5-min TTL).
    """
    cached = _get_cache("market:overview")
    if cached is not None:
        return cached
    try:
        result = _compute_market_overview()
        _set_cache("market:overview", result, _TTL_MARKET_OVERVIEW, "market:overview")
        return result
    except Exception as e:
        logger.exception("market_overview failed")
        raise HTTPException(status_code=500, detail=f"Market overview error: {e}")


# ---------------------------------------------------------------------------
# Endpoints: Portfolio Analysis
# ---------------------------------------------------------------------------

@app.post("/portfolio/analyze")
def portfolio_analyze(req: PortfolioAnalyzeRequest, background_tasks: BackgroundTasks):
    """Kick off an async portfolio analysis job. Poll GET /portfolio/job/{job_id}."""
    job_id = str(uuid.uuid4())[:12]
    holdings_data = [h.model_dump() for h in req.holdings]

    db = SessionLocal()
    try:
        job = PortfolioAnalysisJob(
            id=job_id,
            status="pending",
            holdings=holdings_data,
        )
        db.add(job)
        db.commit()
    finally:
        db.close()

    background_tasks.add_task(
        _run_portfolio_analysis,
        job_id,
        holdings_data,
        req.risk_free_rate,
        req.n_mc_paths,
        req.mc_horizon_days,
        req.n_frontier_portfolios,
    )
    return {"job_id": job_id, "status": "pending"}


@app.get("/portfolio/job/{job_id}")
def portfolio_job_status(job_id: str):
    """Poll portfolio analysis job status and results."""
    db = SessionLocal()
    try:
        job = db.query(PortfolioAnalysisJob).filter(PortfolioAnalysisJob.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return {
            "job_id":      job.id,
            "status":      job.status,
            "holdings":    job.holdings,
            "results":     job.results,
            "error":       job.error,
            "created_at":  job.created_at.isoformat() if job.created_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
    finally:
        db.close()


def _run_portfolio_analysis(
    job_id: str,
    holdings_data: list[dict],
    rfr: float,
    n_mc: int,
    mc_days: int,
    n_frontier: int,
):
    """Background: fetch prices, compute full portfolio analytics, run MC + frontier."""
    import numpy as np

    db = SessionLocal()
    try:
        job = db.query(PortfolioAnalysisJob).filter(PortfolioAnalysisJob.id == job_id).first()
        if not job:
            return
        job.status = "running"
        db.commit()
    finally:
        db.close()

    try:
        import yfinance as yf
        import pandas as pd
        import numpy as np

        # ── 1. Parse holdings ─────────────────────────────────────────────────
        tickers       = [h["ticker"].upper() for h in holdings_data]
        uses_shares   = any(
            (h.get("shares") or 0) > 0 and not (h.get("weight") or 0) > 0
            for h in holdings_data
        )

        # ── 2. Fetch 3-year price history ─────────────────────────────────────
        all_syms = list(dict.fromkeys(tickers + ["SPY"]))  # deduplicate, SPY last
        end_dt   = pd.Timestamp.now()
        start_dt = end_dt - pd.DateOffset(years=3)

        raw = yf.download(
            all_syms, start=start_dt.strftime("%Y-%m-%d"),
            end=end_dt.strftime("%Y-%m-%d"), progress=False, auto_adjust=True,
        )

        # Handle single-ticker yfinance response (no MultiIndex)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"]
        else:
            prices = raw[["Close"]] if "Close" in raw.columns else raw
            prices.columns = all_syms[:1]

        prices = prices.dropna(how="all")

        # Daily returns
        rets = prices.pct_change().dropna()

        # Filter to tickers we actually got
        available = [t for t in tickers if t in rets.columns]
        missing   = [t for t in tickers if t not in rets.columns]

        if not available:
            raise ValueError("No price data returned for any ticker")

        # ── Derive weights ────────────────────────────────────────────────────
        idx_map = {t: i for i, t in enumerate(tickers)}

        if uses_shares:
            # Use latest available close price to compute portfolio $ values
            latest_prices = {
                t: float(prices[t].dropna().iloc[-1])
                for t in available if t in prices.columns and len(prices[t].dropna()) > 0
            }
            values = []
            for t in available:
                h    = holdings_data[idx_map[t]]
                shrs = float(h.get("shares") or 0)
                px   = float(h.get("price") or 0) or latest_prices.get(t, 0.0)
                values.append(shrs * px)
            total_val = sum(values) or 1.0
            avail_w   = np.array([v / total_val for v in values], dtype=float)
        else:
            raw_w  = np.array([float(holdings_data[idx_map[t]].get("weight") or 0) for t in available], dtype=float)
            avail_w = raw_w / max(raw_w.sum(), 1e-9)

        avail_w /= avail_w.sum()  # final normalisation guard

        port_rets  = rets[available] @ avail_w  # daily portfolio return series
        spy_rets   = rets["SPY"] if "SPY" in rets.columns else None

        n_days = len(port_rets)

        # ── 3. Portfolio-level metrics ─────────────────────────────────────────
        ann_ret  = float((1 + port_rets.mean()) ** 252 - 1)
        ann_vol  = float(port_rets.std() * np.sqrt(252))
        sharpe   = float((ann_ret - rfr) / ann_vol) if ann_vol > 0 else 0.0

        # Sortino (downside vol only)
        neg_rets   = port_rets[port_rets < 0]
        down_vol   = float(neg_rets.std() * np.sqrt(252)) if len(neg_rets) > 1 else ann_vol
        sortino    = float((ann_ret - rfr) / down_vol) if down_vol > 0 else 0.0

        # Max drawdown
        cum    = (1 + port_rets).cumprod()
        peak   = cum.cummax()
        dd     = (cum - peak) / peak
        max_dd = float(dd.min())

        # VaR & CVaR (95%)
        var_95  = float(np.percentile(port_rets, 5))
        cvar_95 = float(port_rets[port_rets <= var_95].mean()) if (port_rets <= var_95).any() else var_95

        # Beta / Corr to SPY
        if spy_rets is not None and len(spy_rets) == len(port_rets):
            aligned = pd.concat([port_rets, spy_rets], axis=1).dropna()
            aligned.columns = ["port", "spy"]
            cov_mat  = np.cov(aligned["port"].values, aligned["spy"].values)
            beta     = float(cov_mat[0, 1] / cov_mat[1, 1]) if cov_mat[1, 1] > 0 else None
            corr_spy = float(aligned.corr().iloc[0, 1])
        else:
            beta, corr_spy = None, None

        # ── 4. Per-ticker metrics ──────────────────────────────────────────────
        per_ticker = []
        for t, w in zip(available, avail_w):
            r  = rets[t]
            ar = float((1 + r.mean()) ** 252 - 1)
            av = float(r.std() * np.sqrt(252))
            sh = float((ar - rfr) / av) if av > 0 else 0.0

            # Beta of this ticker to SPY
            if spy_rets is not None:
                a2 = pd.concat([r, spy_rets], axis=1).dropna()
                a2.columns = ["t", "spy"]
                cv = np.cov(a2["t"].values, a2["spy"].values)
                t_beta = float(cv[0, 1] / cv[1, 1]) if cv[1, 1] > 0 else None
                t_corr = float(a2.corr().iloc[0, 1])
            else:
                t_beta, t_corr = None, None

            per_ticker.append({
                "ticker":      t,
                "weight":      float(round(w, 6)),
                "ann_return":  float(round(ar, 6)),
                "ann_vol":     float(round(av, 6)),
                "sharpe":      float(round(sh, 4)),
                "beta_spy":    float(round(t_beta, 4)) if t_beta is not None else None,
                "corr_spy":    float(round(t_corr, 4)) if t_corr is not None else None,
            })

        # ── 5. Correlation matrix ─────────────────────────────────────────────
        corr_df  = rets[available].corr()
        corr_mat = {
            "tickers": available,
            "matrix":  [[round(float(corr_df.iloc[i, j]), 4) for j in range(len(available))]
                        for i in range(len(available))],
        }

        # ── 6. Historical equity curve ────────────────────────────────────────
        hist_cum  = (1 + port_rets).cumprod()
        hist_dates = [str(d.date()) for d in hist_cum.index]
        hist_vals  = [round(float(v), 6) for v in hist_cum.values]
        historical = [{"date": d, "value": v} for d, v in zip(hist_dates, hist_vals)]

        # ── 7. Monte Carlo (correlated GBM via Cholesky) ───────────────────────
        cov_daily  = rets[available].cov().values
        try:
            L = np.linalg.cholesky(cov_daily + np.eye(len(available)) * 1e-10)
        except np.linalg.LinAlgError:
            L = np.diag(np.sqrt(np.diag(cov_daily)))

        mu_daily  = rets[available].mean().values
        S0        = 1.0
        paths     = np.zeros((n_mc, mc_days + 1))
        paths[:, 0] = S0

        rng = np.random.default_rng(42)
        for step in range(mc_days):
            z   = rng.standard_normal((n_mc, len(available)))
            eps = z @ L.T                          # correlated shocks
            r_t = eps + mu_daily                   # drift + noise
            port_step = r_t @ avail_w              # portfolio daily return
            paths[:, step + 1] = paths[:, step] * (1 + port_step)

        # Fan chart percentiles
        pcts = [5, 25, 50, 75, 95]
        fan  = np.percentile(paths, pcts, axis=0)  # (5, mc_days+1)
        mc_fan = [
            {
                "day": int(d),
                "p5":  float(round(fan[0, d], 6)),
                "p25": float(round(fan[1, d], 6)),
                "p50": float(round(fan[2, d], 6)),
                "p75": float(round(fan[3, d], 6)),
                "p95": float(round(fan[4, d], 6)),
            }
            for d in range(0, mc_days + 1, max(1, mc_days // 100))
        ]

        final_vals   = paths[:, -1]
        mc_summary   = {
            "median_final":    float(round(float(np.median(final_vals)), 4)),
            "p5_final":        float(round(float(np.percentile(final_vals, 5)), 4)),
            "p95_final":       float(round(float(np.percentile(final_vals, 95)), 4)),
            "prob_profit":     float(round(float((final_vals > 1.0).mean()), 4)),
            "prob_loss_20pct": float(round(float((final_vals < 0.80).mean()), 4)),
        }

        # ── 8. Efficient Frontier (random portfolio cloud) ─────────────────────
        n_assets  = len(available)
        mu_ann    = np.array([(1 + rets[t].mean()) ** 252 - 1 for t in available])
        cov_ann   = rets[available].cov().values * 252

        frontier_pts = []
        rng2 = np.random.default_rng(7)
        for _ in range(n_frontier):
            w = rng2.dirichlet(np.ones(n_assets))
            pret = float(w @ mu_ann)
            pvol = float(np.sqrt(w @ cov_ann @ w))
            psh  = float((pret - rfr) / pvol) if pvol > 0 else 0.0
            frontier_pts.append({"vol": round(pvol, 6), "ret": round(pret, 6), "sharpe": round(psh, 4),
                                  "weights": [round(float(x), 4) for x in w]})

        # Current portfolio point
        cur_vol  = float(np.sqrt(avail_w @ cov_ann @ avail_w))
        cur_ret  = float(avail_w @ mu_ann)
        cur_sh   = float((cur_ret - rfr) / cur_vol) if cur_vol > 0 else 0.0

        # Max-Sharpe point
        max_sh_pt = max(frontier_pts, key=lambda p: p["sharpe"])
        # Min-Vol point
        min_vol_pt = min(frontier_pts, key=lambda p: p["vol"])

        efficient_frontier = {
            "cloud":        frontier_pts,
            "current":      {"vol": round(cur_vol, 6), "ret": round(cur_ret, 6), "sharpe": round(cur_sh, 4), "weights": [round(float(x), 4) for x in avail_w]},
            "max_sharpe":   max_sh_pt,
            "min_vol":      min_vol_pt,
        }

        # ── 9. Per-ticker stacked series (weight_i × cum_return_i per day) ──────
        cum_by_ticker = (1 + rets[available]).cumprod()
        step_st = max(1, len(cum_by_ticker) // 150)
        per_ticker_series = []
        for i in range(0, len(cum_by_ticker), step_st):
            row = {"date": str(cum_by_ticker.index[i].date())}
            for t, w in zip(available, avail_w):
                row[t] = round(float(w * float(cum_by_ticker[t].iloc[i])), 6)
            per_ticker_series.append(row)

        # ── 10. Assemble result ────────────────────────────────────────────────
        results = _sanitize({
            "tickers":     available,
            "missing":     missing,
            "weights":     [float(round(w, 6)) for w in avail_w],
            "metrics": {
                "ann_return":  round(ann_ret, 6),
                "ann_vol":     round(ann_vol, 6),
                "sharpe":      round(sharpe, 4),
                "sortino":     round(sortino, 4),
                "max_drawdown":round(max_dd, 6),
                "var_95":      round(var_95, 6),
                "cvar_95":     round(cvar_95, 6),
                "beta_spy":    round(beta, 4) if beta is not None else None,
                "corr_spy":    round(corr_spy, 4) if corr_spy is not None else None,
            },
            "per_ticker":         per_ticker,
            "per_ticker_series":  per_ticker_series,
            "correlation_matrix": corr_mat,
            "historical":         historical,
            "mc_fan":             mc_fan,
            "mc_summary":         mc_summary,
            "efficient_frontier": efficient_frontier,
            "n_days":             int(n_days),
            "as_of":              datetime.utcnow().isoformat(),
        })

        db2 = SessionLocal()
        try:
            job = db2.query(PortfolioAnalysisJob).filter(PortfolioAnalysisJob.id == job_id).first()
            if job:
                job.status       = "complete"
                job.results      = results
                job.completed_at = datetime.utcnow()
                db2.commit()
        finally:
            db2.close()

    except Exception as exc:
        logger.exception("portfolio analysis failed for job %s", job_id)
        db3 = SessionLocal()
        try:
            job = db3.query(PortfolioAnalysisJob).filter(PortfolioAnalysisJob.id == job_id).first()
            if job:
                job.status = "failed"
                job.error  = str(exc)
                db3.commit()
        finally:
            db3.close()


# ---------------------------------------------------------------------------
# Technical Analysis
# ---------------------------------------------------------------------------

@app.get("/ta/{symbol}")
def technical_analysis(
    symbol: str,
    period:          str   = "1y",
    interval:        str   = "1d",
    sma_periods:     str   = "20,50,200",
    ema_periods:     str   = "9,21",
    bb_period:       int   = 20,
    bb_std:          float = 2.0,
    rsi_period:      int   = 14,
    macd_fast:       int   = 12,
    macd_slow:       int   = 26,
    macd_signal:     int   = 9,
    stoch_k:         int   = 14,
    stoch_d:         int   = 3,
    atr_period:      int   = 14,
    cci_period:      int   = 20,
    williams_period: int   = 14,
):
    """Fetch OHLCV from yfinance and return all technical indicators. Cached 15 min."""
    cache_key = f"ta:{symbol.upper()}:{period}:{interval}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    try:
        from technical_analysis import fetch_and_compute
        sma_list = [int(x) for x in sma_periods.split(",") if x.strip().isdigit()]
        ema_list = [int(x) for x in ema_periods.split(",") if x.strip().isdigit()]
        result = fetch_and_compute(
            symbol, period=period, interval=interval,
            sma_periods=sma_list, ema_periods=ema_list,
            bb_period=bb_period, bb_std=bb_std, rsi_period=rsi_period,
            macd_fast=macd_fast, macd_slow=macd_slow, macd_signal=macd_signal,
            stoch_k=stoch_k, stoch_d=stoch_d, atr_period=atr_period,
            cci_period=cci_period, williams_period=williams_period,
        )
        try:
            from signal_strategies import StrategyEngine, god_mode as _god_mode
            engine  = StrategyEngine(result)
            signals = engine.check_all()
            gm      = _god_mode(signals, result, symbol)
            result["signals"]  = signals
            result["god_mode"] = gm
        except Exception as sig_err:
            logger.warning("Signal engine failed for %s: %s", symbol, sig_err)
            result["signals"]  = []
            result["god_mode"] = None
        out = _sanitize(result)
        _set_cache(cache_key, out, _TTL_TECHNICAL, "ta")
        return out
    except Exception as e:
        logger.exception("TA compute failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Endpoints: FRED Macro Intelligence
# ---------------------------------------------------------------------------

@app.get("/macro/catalog")
def macro_catalog():
    """Return the curated FRED series catalog organized by economic category."""
    from fred_data import FRED_CATALOG
    return {"catalog": FRED_CATALOG}


@app.get("/macro/series/{series_id}/info")
def macro_series_info(series_id: str):
    """Return FRED series metadata (title, units, frequency, last_updated, notes)."""
    from fred_data import _fred
    try:
        info = _fred.get_series_info(series_id.upper())
        return info
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FRED API error: {e}")


@app.get("/macro/series/{series_id}")
def macro_series_data(
    series_id: str,
    period:    str = "5y",
    frequency: str = "default",
    units:     str = "lin",
):
    """
    Return FRED observations for a series. Cached 6 hours (monthly releases).
    period:    1y | 2y | 5y | 10y | 20y | max
    frequency: default | d | w | m | q | a
    units:     lin (level) | pc1 (YoY %) | pch (MoM %) | chg (absolute chg)
    """
    cache_key = f"macro:series:{series_id.upper()}:{period}:{frequency}:{units}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    from fred_data import _fred, period_to_start_date
    try:
        start = period_to_start_date(period)
        obs   = _fred.get_observations(
            series_id.upper(),
            observation_start=start,
            frequency=None if frequency == "default" else frequency,
            units=units,
        )
        info   = _fred.get_series_info(series_id.upper())
        result = _sanitize({
            "series_id": series_id.upper(), "period": period, "units": units,
            "frequency": frequency, "info": info, "observations": obs, "count": len(obs),
        })
        _set_cache(cache_key, result, _TTL_MACRO, "macro:series")
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FRED API error: {e}")


@app.get("/macro/summary/{series_id}")
def macro_summary(series_id: str, period: str = "5y"):
    """
    AI-style economic interpretation of a FRED series. Cached 6 hours.
    """
    cache_key = f"macro:summary:{series_id.upper()}:{period}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    from fred_data import _fred, period_to_start_date, generate_macro_summary
    try:
        start  = period_to_start_date(period)
        obs    = _fred.get_observations(series_id.upper(), observation_start=start)
        info   = _fred.get_series_info(series_id.upper())
        obs_5y = _fred.get_observations(series_id.upper(), observation_start=period_to_start_date("5y"))
        summary = generate_macro_summary(series_id.upper(), obs_5y, info)
        summary["series_id"] = series_id.upper()
        summary["info"]      = info
        result = _sanitize(summary)
        _set_cache(cache_key, result, _TTL_MACRO, "macro:summary")
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FRED API error: {e}")


@app.get("/macro/search")
def macro_search(q: str, limit: int = 20):
    """Search FRED for series matching the query string."""
    from fred_data import _fred
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters.")
    try:
        results = _fred.search_series(q.strip(), limit=min(limit, 40))
        return {"query": q, "results": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FRED API error: {e}")


# ---------------------------------------------------------------------------
# New Pydantic Schemas (predictive analytics expansion)
# ---------------------------------------------------------------------------

class MLSignalRequest(BaseModel):
    symbol: str = "SPY"
    forward_days: int = 5
    train_window: int = 252
    retrain_every: int = 63

class SentimentRequest(BaseModel):
    symbol: str
    window_hours: int = 24

class PairsScreenRequest(BaseModel):
    symbols: list[str]
    min_correlation: float = 0.70
    z_entry: float = 2.0
    z_exit: float = 0.5

class TradeAdvisorRequest(BaseModel):
    symbol: str
    risk_tolerance: str = "moderate"   # conservative / moderate / aggressive
    project_id: Optional[str] = None   # if provided, loads signal data

class BlackLittermanRequest(BaseModel):
    holdings: list[PortfolioHolding]
    signal_scores: dict = {}            # {symbol: score ∈ [-1,+1]}
    risk_aversion: float = 2.5
    tau: float = 0.05
    risk_free_rate: float = 0.05

class StressTestRequest(BaseModel):
    holdings: list[PortfolioHolding]

class DrawdownRequest(BaseModel):
    holdings: list[PortfolioHolding]


# ---------------------------------------------------------------------------
# ML Signal Endpoints
# ---------------------------------------------------------------------------

@app.post("/ml/signal")
def ml_signal(req: MLSignalRequest, project_id: Optional[str] = None):
    """
    Run walk-forward GradientBoosting ML signal for a symbol.
    Requires feature data — optionally pass project_id to load from Parquet.
    Falls back to fetching fresh features if no project given.
    """
    try:
        import polars as pl
        from ml_signal_engine import MLSignalEngine

        features: Optional[pl.DataFrame] = None

        # Try to load from project feature store
        if project_id:
            feat_path = DATA_DIR / f"{project_id}_features.parquet"
            if feat_path.exists():
                features = pl.read_parquet(feat_path)

        # If no project features, compute fresh from yfinance
        if features is None:
            try:
                import yfinance as yf
                import pandas as pd
                from feature_engine import FeatureEngine

                sym = req.symbol.upper()
                hist = yf.Ticker(sym).history(period="3y")
                if hist.empty:
                    raise ValueError(f"No price data for {sym}")

                # Build Polars DataFrame from plain Python lists — avoids the
                # pyarrow dependency that pl.from_pandas triggers when yfinance
                # returns nullable Int64/Float64 or tz-aware DatetimeTZDtype.
                idx = hist.index
                if hasattr(idx.dtype, "tz") and idx.dtype.tz:
                    ts_us = [int(t.timestamp() * 1_000_000) for t in idx]
                else:
                    ts_us = [int(t.value // 1_000) for t in idx]  # ns → µs
                prices_df = pl.DataFrame({
                    "timestamp": ts_us,
                    "open":      hist["Open"].astype(float).tolist(),
                    "high":      hist["High"].astype(float).tolist(),
                    "low":       hist["Low"].astype(float).tolist(),
                    "close":     hist["Close"].astype(float).tolist(),
                    "volume":    hist["Volume"].astype(float).tolist(),
                    "symbol":    [sym] * len(hist),
                }).with_columns([
                    pl.col("timestamp").cast(pl.Datetime("us")),
                ])
                fe = FeatureEngine()
                features = fe.compute(prices_df)
            except Exception as fe_err:
                raise HTTPException(status_code=422,
                    detail=f"Could not build features for {req.symbol}: {fe_err}")

        engine = MLSignalEngine(
            forward_days=req.forward_days,
            train_window=req.train_window,
            retrain_every=req.retrain_every,
        )
        result = engine.run(features, req.symbol.upper())

        return _sanitize({
            "symbol":             result.symbol,
            "timestamp":          str(result.timestamp),
            "p_up":               result.p_up,
            "direction":          result.direction,
            "confidence":         result.confidence,
            "signal_strength":    result.signal_strength,
            "forward_days":       result.forward_days,
            "model_accuracy":     result.model_accuracy,
            "top_feature":        result.top_feature,
            "feature_importance": result.feature_importance,
            "blurb":              result.blurb,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ML signal failed for %s", req.symbol)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Sentiment Endpoints
# ---------------------------------------------------------------------------

@app.get("/sentiment/{symbol}")
def get_sentiment(symbol: str, window_hours: int = 24):
    """
    Compute rolling news sentiment for a symbol. Cached 1 hour.
    """
    sym = symbol.upper()
    cache_key = f"sentiment:{sym}:{window_hours}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    try:
        from sentiment_engine import SentimentEngine
        engine = SentimentEngine()
        result = engine.compute_signal(sym, window_hours=window_hours)
        out = _sanitize({
            "symbol":           result.symbol,
            "timestamp":        str(result.timestamp),
            "score":            result.score,
            "direction":        result.direction,
            "confidence":       result.confidence,
            "signal_strength":  result.signal_strength,
            "article_count":    result.article_count,
            "bull_count":       result.bull_count,
            "bear_count":       result.bear_count,
            "neutral_count":    result.neutral_count,
            "momentum":         result.momentum,
            "headline_snippets":result.headline_snippets,
            "blurb":            result.blurb,
        })
        _set_cache(cache_key, out, _TTL_SENTIMENT, "sentiment")
        return out
    except Exception as e:
        logger.exception("Sentiment failed for %s", sym)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sentiment/market/overview")
def get_market_sentiment():
    """
    Market-wide sentiment for SPY, QQQ, IWM, GLD. Cached 1 hour.
    """
    cache_key = "sentiment:market:overview"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    try:
        from sentiment_engine import get_market_sentiment as _gms
        results = _gms()
        out = _sanitize({
            sym: {
                "score":     r.score,
                "direction": r.direction,
                "strength":  r.signal_strength,
                "articles":  r.article_count,
                "blurb":     r.blurb,
            }
            for sym, r in results.items()
        })
        _set_cache(cache_key, out, _TTL_SENTIMENT, "sentiment:market")
        return out
    except Exception as e:
        logger.exception("Market sentiment failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# News Feed Endpoint
# ---------------------------------------------------------------------------

def _tag_article(title: str, summary: str) -> list:
    """Auto-tag a news article from keyword matching across 10 categories."""
    text = (title + " " + summary).lower()
    tags = []
    if any(w in text for w in ["fed ", "federal reserve", "fomc", "rate hike", "rate cut", "powell",
                                 "interest rate", "monetary policy", "basis point", "quantitative easing",
                                 "tightening", "balance sheet"]):
        tags.append("Fed/Rates")
    if any(w in text for w in ["earnings", " eps ", "revenue", "quarterly results", " q1 ", " q2 ",
                                 " q3 ", " q4 ", "beats estimate", "misses estimate", "profit warning",
                                 "guidance", "loss per share", "net income"]):
        tags.append("Earnings")
    if any(w in text for w in ["gdp", " cpi ", " pce ", "inflation", "unemployment", "payroll",
                                 "nonfarm", "recession", "economic growth", "consumer price",
                                 "producer price", "retail sales", "housing starts"]):
        tags.append("Macro")
    if any(w in text for w in ["merger", "acquisition", "buyout", "takeover", " deal ", "m&a",
                                 " ipo ", "spin-off", "spinoff", "hostile bid", "strategic review"]):
        tags.append("M&A")
    if any(w in text for w in ["upgrade", "downgrade", "analyst", "target price", "overweight",
                                 "underweight", "outperform", "underperform", "price target",
                                 "initiates coverage", "raises target", "cuts target"]):
        tags.append("Analyst")
    if any(w in text for w in ["oil ", "energy", "opec", "natural gas", "crude", "commodities",
                                 "gold ", "silver ", "copper ", "wheat", "corn ", "lithium"]):
        tags.append("Commodities")
    if any(w in text for w in ["artificial intelligence", " ai ", " chip", "semiconductor",
                                 "software", "cloud computing", "nvidia", "apple inc", "microsoft",
                                 "meta ", "alphabet", "amazon", "tech ", "data center"]):
        tags.append("Technology")
    if any(w in text for w in ["bank", "lending", "credit", "treasury yield", "bond yield",
                                 "hedge fund", "private equity", "financial crisis", "debt ceiling",
                                 "default risk", "investment grade", "high yield"]):
        tags.append("Finance")
    if any(w in text for w in ["crypto", "bitcoin", "ethereum", "blockchain", "defi",
                                 "nft", "stablecoin", "coinbase", "binance"]):
        tags.append("Crypto")
    if any(w in text for w in ["tariff", "trade war", "sanction", "geopolit", "conflict",
                                 "war ", "china ", "taiwan", "russia", "ukraine", "middle east"]):
        tags.append("Geopolitical")
    if not tags:
        tags.append("Markets")
    return tags[:3]


@app.get("/news/feed")
def get_news_feed(symbol: str = "market", limit: int = 50, window_hours: int = 48):
    """
    Return tagged, enriched news articles for a symbol or general market news.
    Cached 30 min — articles change slowly relative to request rate.
    """
    sym_norm  = symbol.upper() if symbol.lower() != "market" else "market"
    cache_key = f"news:feed:{sym_norm}:{limit}"
    cached    = _get_cache(cache_key)
    if cached is not None:
        return cached

    import re as _re
    from datetime import timezone as _tz
    try:
        from sentiment_engine import SentimentEngine
        engine = SentimentEngine()
        fetch_sym = "SPY" if symbol.lower() == "market" else symbol.upper()
        articles = engine.get_news(fetch_sym, limit=int(limit))

        now_utc = datetime.utcnow().replace(tzinfo=_tz.utc)
        result = []
        for a in articles:
            # Relative time
            try:
                pub = a.published if a.published.tzinfo else a.published.replace(tzinfo=_tz.utc)
                age_s = max(0, (now_utc - pub).total_seconds())
                if age_s < 3600:
                    rel_time = f"{int(age_s / 60)}m ago"
                elif age_s < 86400:
                    rel_time = f"{int(age_s / 3600)}h ago"
                else:
                    rel_time = f"{int(age_s / 86400)}d ago"
            except Exception:
                rel_time = "recently"

            # Clean summary — strip HTML, then extract a 1-2 sentence synopsis
            raw_summary = a.summary or ""
            clean_summary = _re.sub(r"<[^>]+>", "", raw_summary).strip()
            # Cap at 280 chars; break at a natural sentence boundary to avoid
            # splitting abbreviations like "U.S." on the naive "." split.
            MAX = 280
            if len(clean_summary) <= MAX:
                synopsis = clean_summary
            else:
                chunk = clean_summary[:MAX]
                # Find last sentence-ending punctuation followed by whitespace
                cut = max(chunk.rfind(". "), chunk.rfind("! "), chunk.rfind("? "))
                synopsis = chunk[:cut + 1] if cut > 60 else chunk.rstrip() + "…"

            # Normalise source hostname to readable label
            src = a.source
            for old, new in [
                ("feeds.finance.yahoo.com", "Yahoo Finance"),
                ("finance.yahoo.com", "Yahoo Finance"),
                ("feeds.marketwatch.com", "MarketWatch"),
                ("www.marketwatch.com", "MarketWatch"),
                ("www.cnbc.com", "CNBC"),
                ("feeds.a.dj.com", "WSJ"),
                ("www.reuters.com", "Reuters"),
                ("feeds.bloomberg.com", "Bloomberg"),
            ]:
                src = src.replace(old, new)

            result.append({
                "title":             a.title,
                "summary":           synopsis,
                "url":               a.url,
                "source":            src,
                "published":         str(a.published),
                "rel_time":          rel_time,
                "score":             round(a.normalized_score, 3),
                "symbol_mentioned":  a.symbol_mentioned,
                "tags":              _tag_article(a.title, raw_summary),
            })

        out = _sanitize({"symbol": symbol.upper(), "articles": result, "count": len(result)})
        _set_cache(cache_key, out, _TTL_NEWS_FEED, "news:feed")
        return out
    except Exception as e:
        logger.exception("News feed failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Enriched Feeds + Daily Summary Endpoints
# ---------------------------------------------------------------------------

def _generate_daily_summary(db: Session) -> dict:
    """
    Compile today's news + sentiment into a 4-paragraph contextual summary.
    Returns a dict suitable for storing in DailySummary and returning via API.
    """
    import re as _re
    from datetime import timezone as _tz

    today = datetime.utcnow().strftime("%Y-%m-%d")

    try:
        from sentiment_engine import SentimentEngine, EXTENDED_FEEDS
        engine = SentimentEngine()

        # ── Gather articles from all extended feeds ──────────────────────
        all_articles = []
        sources_seen: set[str] = set()
        for category, urls in EXTENDED_FEEDS.items():
            for url in urls:
                items = engine._fetch_feed(url)
                for item in items:
                    all_articles.append({
                        "title":    item.title,
                        "summary":  item.summary,
                        "source":   item.source,
                        "score":    item.normalized_score,
                        "tags":     _tag_article(item.title, item.summary),
                        "category": category,
                        "published": str(item.published),
                    })
                    sources_seen.add(item.source)

        # Deduplicate by title similarity (drop near-duplicates)
        seen_titles: set[str] = set()
        unique = []
        for a in all_articles:
            key = _re.sub(r"[^a-z ]", "", a["title"].lower())[:60]
            if key not in seen_titles:
                seen_titles.add(key)
                unique.append(a)

        articles = unique
        article_count = len(articles)

        if article_count == 0:
            return {"date": today, "theme": "No data available", "paragraphs": [],
                    "sentiment": "neutral", "sentiment_score": 0.0,
                    "top_tags": [], "article_count": 0, "sources_used": []}

        # ── Aggregate statistics ─────────────────────────────────────────
        scores = [a["score"] for a in articles]
        avg_score = sum(scores) / len(scores)
        bull_ct  = sum(1 for s in scores if s > 0.1)
        bear_ct  = sum(1 for s in scores if s < -0.1)
        neut_ct  = article_count - bull_ct - bear_ct

        overall_dir = ("bullish"  if avg_score >  0.08 else
                       "bearish"  if avg_score < -0.08 else "neutral")

        # Tag frequency
        tag_counts: dict[str, int] = {}
        for a in articles:
            for t in a["tags"]:
                tag_counts[t] = tag_counts.get(t, 0) + 1
        top_tags = [t for t, _ in sorted(tag_counts.items(), key=lambda x: -x[1])[:6]]

        # Top positive / negative articles
        top_bull = sorted(articles, key=lambda a: a["score"], reverse=True)[:3]
        top_bear = sorted(articles, key=lambda a: a["score"])[:3]

        # Category coverage
        cat_counts: dict[str, int] = {}
        for a in articles:
            cat_counts[a["category"]] = cat_counts.get(a["category"], 0) + 1
        dominant_cat = max(cat_counts, key=cat_counts.get) if cat_counts else "Markets"

        # ── Build one-line theme ─────────────────────────────────────────
        tone_word  = "risk-on"  if overall_dir == "bullish" else \
                     "risk-off" if overall_dir == "bearish" else "mixed"
        dom_tag    = top_tags[0] if top_tags else dominant_cat
        second_tag = top_tags[1] if len(top_tags) > 1 else ""
        theme = (f"{tone_word.capitalize()} tape driven by {dom_tag}"
                 + (f" and {second_tag}" if second_tag and second_tag != dom_tag else "")
                 + f" — {article_count} stories from {len(sources_seen)} sources")

        # ── Generate 4 paragraphs ────────────────────────────────────────
        def fmt_score(s: float) -> str:
            return f"+{s:.2f}" if s >= 0 else f"{s:.2f}"

        # ── P1: Market Theme ────────────────────────────────────────────
        bull_pct  = round(100 * bull_ct  / article_count)
        bear_pct  = round(100 * bear_ct  / article_count)
        neut_pct  = 100 - bull_pct - bear_pct
        tag_list  = ", ".join(top_tags[:4]) if top_tags else "general markets"

        if overall_dir == "bullish":
            tone_phrase = f"Today's financial media is broadly constructive ({bull_pct}% bullish, {bear_pct}% bearish) with an average sentiment score of {fmt_score(avg_score)}."
        elif overall_dir == "bearish":
            tone_phrase = f"Today's financial media carries a notably cautious tone ({bear_pct}% bearish, {bull_pct}% bullish) with an average sentiment score of {fmt_score(avg_score)}."
        else:
            tone_phrase = f"Financial media is balanced today ({bull_pct}% bullish, {bear_pct}% bearish, {neut_pct}% neutral) with a near-flat average score of {fmt_score(avg_score)}."

        p1 = (f"{tone_phrase} Coverage across {len(sources_seen)} sources spans "
              f"{article_count} stories, with dominant themes in {tag_list}. "
              f"The narrative is led by {dominant_cat.lower()} developments, with "
              f"{top_tags[2] if len(top_tags) > 2 else 'macro'} stories adding context.")

        # ── P2: What Matters ───────────────────────────────────────────
        bull_headlines = "; ".join(a["title"][:90] for a in top_bull[:2])
        bear_headlines = "; ".join(a["title"][:90] for a in top_bear[:2])

        p2_parts = []
        if top_bull and top_bull[0]["score"] > 0.2:
            p2_parts.append(f"On the positive side: {bull_headlines}.")
        if top_bear and top_bear[0]["score"] < -0.2:
            p2_parts.append(f"Weighing on sentiment: {bear_headlines}.")
        if not p2_parts:
            p2_parts.append(f"Top stories today include: {bull_headlines}.")

        tag_detail = []
        for tag in top_tags[:4]:
            cnt = tag_counts.get(tag, 0)
            tag_detail.append(f"{cnt} {tag} article{'s' if cnt != 1 else ''}")
        p2 = " ".join(p2_parts) + (f" Story breakdown: {', '.join(tag_detail)}." if tag_detail else "")

        # ── P3: Why It Matters ─────────────────────────────────────────
        implications = []
        if "Fed/Rates" in top_tags[:3]:
            implications.append("Fed/rates coverage is elevated — duration and rate-sensitive positions warrant attention as policy signals may shift market pricing")
        if "Earnings" in top_tags[:3]:
            implications.append("Active earnings cycle underway — single-stock risk is elevated and implied volatility could reprice significantly post-announcement")
        if "Macro" in top_tags[:3]:
            implications.append("Macro data in focus — GDP, CPI, or payroll prints may reset consensus expectations for growth and the path of real rates")
        if "Technology" in top_tags[:3]:
            implications.append("Technology sector driving sentiment — AI/semiconductor narratives continue to disproportionately influence broad market momentum")
        if "M&A" in top_tags[:3]:
            implications.append("M&A activity signals corporate confidence in valuations — watch for sector rotation as deal premiums reset comparable multiples")
        if "Geopolitical" in top_tags[:3]:
            implications.append("Geopolitical risk surfacing in coverage — commodity exposure (energy, metals) and safe-haven flows (gold, Treasuries) merit review")
        if "Commodities" in top_tags[:3]:
            implications.append("Commodities in the narrative — supply-side disruptions or demand signals could feed directly into inflation expectations")
        if not implications:
            implications.append("Cross-asset signals remain broadly intact — no single catalyst appears dominant enough to force a regime shift today")

        p3 = " ".join(f"{s}." for s in implications[:3])

        # ── P4: Go-Forward / Context ────────────────────────────────────
        momentum_word = ("building" if avg_score > 0.12 else
                         "fading"   if avg_score < -0.12 else "stable")
        source_list = ", ".join(sorted(sources_seen)[:5])

        p4 = (f"Sentiment momentum is {momentum_word} today based on the aggregate of "
              f"{article_count} articles from {source_list}{' and others' if len(sources_seen) > 5 else ''}. "
              f"This summary is cached daily and will carry forward as a contextual baseline for comparing "
              f"tomorrow's tone shift. A move from today's {overall_dir} reading to the opposite "
              f"direction — particularly if led by a new {top_tags[0] if top_tags else 'macro'} catalyst — "
              f"would represent a meaningful regime change worth acting on.")

        paragraphs = [p for p in [p1, p2, p3, p4] if p.strip()]

        return {
            "date":            today,
            "theme":           theme,
            "paragraphs":      paragraphs,
            "sentiment":       overall_dir,
            "sentiment_score": round(avg_score, 4),
            "top_tags":        top_tags,
            "article_count":   article_count,
            "sources_used":    sorted(sources_seen),
            "generated_at":    datetime.utcnow().isoformat(),
        }

    except Exception as exc:
        logger.exception("Daily summary generation failed: %s", exc)
        return {"date": today, "theme": "Summary generation failed", "paragraphs": [str(exc)],
                "sentiment": "neutral", "sentiment_score": 0.0,
                "top_tags": [], "article_count": 0, "sources_used": []}


@app.get("/feeds/daily-summary")
def get_daily_summary():
    """
    Return today's cached daily narrative summary (4 paragraphs).
    Generates and caches if not yet available for today.
    """
    db: Session = SessionLocal()
    try:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        row = db.query(DailySummary).filter(DailySummary.date == today).first()
        if row:
            return _sanitize({
                "date":            row.date,
                "theme":           row.theme,
                "paragraphs":      row.paragraphs,
                "sentiment":       row.sentiment,
                "sentiment_score": row.sentiment_score,
                "top_tags":        row.top_tags,
                "article_count":   row.article_count,
                "sources_used":    row.sources_used,
                "generated_at":    row.generated_at.isoformat() if row.generated_at else None,
                "cached":          True,
            })
        # Not cached yet — generate now
        data = _generate_daily_summary(db)
        row = DailySummary(
            date=data["date"], theme=data["theme"], paragraphs=data["paragraphs"],
            sentiment=data["sentiment"], sentiment_score=data["sentiment_score"],
            top_tags=data["top_tags"], article_count=data["article_count"],
            sources_used=data["sources_used"],
        )
        db.merge(row)
        db.commit()
        data["cached"] = False
        return _sanitize(data)
    finally:
        db.close()


@app.post("/feeds/daily-summary/refresh")
def refresh_daily_summary(body: dict = None):
    """Force-regenerate today's daily summary and update the cache."""
    db: Session = SessionLocal()
    try:
        data = _generate_daily_summary(db)
        row = DailySummary(
            date=data["date"], theme=data["theme"], paragraphs=data["paragraphs"],
            sentiment=data["sentiment"], sentiment_score=data["sentiment_score"],
            top_tags=data["top_tags"], article_count=data["article_count"],
            sources_used=data["sources_used"], generated_at=datetime.utcnow(),
        )
        db.merge(row)
        db.commit()
        data["cached"] = False
        data["refreshed"] = True
        return _sanitize(data)
    finally:
        db.close()


@app.get("/feeds/daily-summary/history")
def get_summary_history(days: int = 30):
    """Return the last N days of cached daily summaries for contextual trend view."""
    db: Session = SessionLocal()
    try:
        rows = (db.query(DailySummary)
                .order_by(DailySummary.date.desc())
                .limit(max(1, min(days, 90)))
                .all())
        return _sanitize([{
            "date":            r.date,
            "theme":           r.theme,
            "sentiment":       r.sentiment,
            "sentiment_score": r.sentiment_score,
            "top_tags":        r.top_tags,
            "article_count":   r.article_count,
        } for r in rows])
    finally:
        db.close()


@app.get("/feeds")
def get_feeds(category: str = "all", limit: int = 80, window_hours: int = 48):
    """
    Enriched multi-source financial news feed. Cached 30 min.
    Feeds are fetched in PARALLEL (ThreadPoolExecutor) — cold-miss latency
    drops from ~30 s (serial) to ~3-5 s (8 concurrent connections).
    category: 'all' | 'Markets' | 'Technology' | 'Economy' | 'Earnings' | 'Commodities'
    """
    cache_key = f"feeds:{category.lower()}:{window_hours}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached

    import re as _re
    from datetime import timezone as _tz
    try:
        from sentiment_engine import SentimentEngine, EXTENDED_FEEDS
        engine  = SentimentEngine()
        now_utc = datetime.utcnow().replace(tzinfo=_tz.utc)
        cutoff  = now_utc - timedelta(hours=window_hours)

        SOURCE_LABELS = {
            "feeds.finance.yahoo.com": "Yahoo Finance",
            "finance.yahoo.com":       "Yahoo Finance",
            "feeds.marketwatch.com":   "MarketWatch",
            "www.marketwatch.com":     "MarketWatch",
            "www.cnbc.com":            "CNBC",
            "feeds.a.dj.com":          "WSJ",
            "www.reuters.com":         "Reuters",
            "feeds.reuters.com":       "Reuters",
            "feeds.bloomberg.com":     "Bloomberg",
        }

        cats_to_fetch = (
            list(EXTENDED_FEEDS.keys()) if category == "all"
            else [c for c in EXTENDED_FEEDS if c.lower() == category.lower()]
        )

        # Build (cat, url) work list, then fetch ALL feeds in parallel
        work = [(cat, url) for cat in cats_to_fetch for url in EXTENDED_FEEDS.get(cat, [])]

        def _fetch_one(cat_url):
            cat, url = cat_url
            return cat, engine._fetch_feed(url)

        fetched: list[tuple[str, list]] = []
        with ThreadPoolExecutor(max_workers=min(8, len(work) or 1)) as pool:
            futures = {pool.submit(_fetch_one, cw): cw for cw in work}
            for fut in as_completed(futures):
                try:
                    fetched.append(fut.result())
                except Exception:
                    pass

        all_articles = []
        for cat, items in fetched:
            for item in items:
                try:
                    pub = item.published if item.published.tzinfo else \
                          item.published.replace(tzinfo=_tz.utc)
                    if pub < cutoff:
                        continue
                    age_s    = max(0, (now_utc - pub).total_seconds())
                    rel_time = (f"{int(age_s/60)}m ago"   if age_s < 3600
                                else f"{int(age_s/3600)}h ago" if age_s < 86400
                                else f"{int(age_s/86400)}d ago")
                except Exception:
                    rel_time = "recently"
                    pub = now_utc

                src = item.source
                for old, new in SOURCE_LABELS.items():
                    src = src.replace(old, new)

                all_articles.append({
                    "title":            item.title,
                    "summary":          item.summary[:280],
                    "url":              item.url,
                    "source":           src,
                    "published":        str(item.published),
                    "rel_time":         rel_time,
                    "score":            round(item.normalized_score, 3),
                    "symbol_mentioned": item.symbol_mentioned,
                    "tags":             _tag_article(item.title, item.summary),
                    "category":         cat,
                })

        seen: set[str] = set()
        unique = []
        for a in all_articles:
            key = _re.sub(r"[^a-z ]", "", a["title"].lower())[:60]
            if key not in seen:
                seen.add(key)
                unique.append(a)

        unique.sort(key=lambda a: a["published"], reverse=True)
        page = unique[:limit]

        source_counts: dict[str, int] = {}
        for a in page:
            source_counts[a["source"]] = source_counts.get(a["source"], 0) + 1

        out = _sanitize({"articles": page, "count": len(page),
                         "category": category, "source_counts": source_counts})
        _set_cache(cache_key, out, _TTL_FEEDS, "feeds")
        return out
    except Exception as exc:
        logger.exception("Feeds endpoint failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Sectors Endpoints
# ---------------------------------------------------------------------------

def _run_sector_refresh(job_id: str, sectors: list[str]) -> None:
    from sectors_engine import SectorProvider, SectorStore
    provider = SectorProvider()
    store    = SectorStore(SECTORS_DIR.parent)
    db = SessionLocal()
    errors: dict[str, str] = {}
    done = 0
    try:
        for sector in sectors:
            try:
                snap = provider.fetch_sector(sector)
                store.save(sector, snap)
                logger.info("Sector refresh complete: %s (%d tickers)", sector, len(snap.tickers))
            except Exception as exc:
                errors[sector] = str(exc)[:200]
                logger.warning("Sector refresh failed for %s: %s", sector, exc)
            done += 1
            try:
                job = db.query(SectorRefreshJob).filter(SectorRefreshJob.id == job_id).first()
                if job:
                    job.sectors_done   = done
                    job.sectors_failed = errors
                    db.commit()
            except Exception:
                pass
        try:
            job = db.query(SectorRefreshJob).filter(SectorRefreshJob.id == job_id).first()
            if job:
                job.status       = "complete"
                job.completed_at = datetime.utcnow()
                job.sectors_failed = errors
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@app.get("/sectors")
def get_sectors_overview():
    """Lightweight summary of all 11 GICS sectors (from cache)."""
    from sectors_engine import SectorStore
    store = SectorStore(SECTORS_DIR.parent)
    return _sanitize(store.all_summaries())


@app.get("/sectors/universe")
def get_sectors_universe():
    """Return the active ticker universe per sector (S&P 500 dynamic or hardcoded fallback)."""
    from sectors_engine import _get_active_universe, SECTOR_ETF, SECTOR_COLOR
    universe = _get_active_universe()
    return {
        s: {
            "etf":     SECTOR_ETF.get(s, ""),
            "color":   SECTOR_COLOR.get(s, "#607D8B"),
            "tickers": tickers,
            "count":   len(tickers),
        }
        for s, tickers in universe.items()
    }


@app.post("/sectors/universe/refresh")
def refresh_sp500_universe():
    """Force-refresh the S&P 500 universe list from Wikipedia."""
    try:
        from sp500_universe import get_sp500_universe
        data = get_sp500_universe(force_refresh=True)
        if not data:
            raise HTTPException(status_code=503,
                detail="Could not fetch S&P 500 list from Wikipedia. Using cached/fallback.")
        return {
            "status":     "ok",
            "total":      data.get("total", 0),
            "sectors":    {s: len(t) for s, t in data["universe"].items()},
            "fetched_at": data.get("fetched_at"),
            "source":     data.get("source", "wikipedia"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/sectors/ticker/{symbol}/sec")
def get_ticker_sec_facts(symbol: str):
    """SEC EDGAR XBRL annual financials for a ticker (up to 15 years)."""
    from sp500_universe import get_cik
    from sec_feed import SecFeed
    cik = get_cik(symbol.upper())
    if not cik:
        raise HTTPException(status_code=404,
            detail=f"{symbol} not found in S&P 500 universe / CIK map. Fetch universe first.")
    feed = SecFeed()
    facts = feed.company_facts(cik)
    if not facts:
        raise HTTPException(status_code=503,
            detail=f"SEC EDGAR returned no data for {symbol} (CIK {cik}).")
    return _sanitize(facts)


@app.get("/sectors/ticker/{symbol}/filings")
def get_ticker_filings(symbol: str, limit: int = 20):
    """Recent SEC filings (8-K, 10-K, 10-Q) for a ticker."""
    from sp500_universe import get_cik
    from sec_feed import SecFeed
    cik = get_cik(symbol.upper())
    if not cik:
        raise HTTPException(status_code=404,
            detail=f"{symbol} not found in S&P 500 CIK map.")
    feed = SecFeed()
    return feed.recent_filings(cik, limit=limit)


@app.post("/sectors/refresh")
def refresh_sectors(background_tasks: BackgroundTasks, body: Optional[dict] = None):
    """Trigger background refresh of one or all sectors. Body: {sectors?: [str]}"""
    from sectors_engine import SECTOR_UNIVERSE
    target = (body or {}).get("sectors") or list(SECTOR_UNIVERSE.keys())
    job_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        db.add(SectorRefreshJob(id=job_id, status="running",
                                sectors_total=len(target), sectors_done=0))
        db.commit()
    finally:
        db.close()
    background_tasks.add_task(_run_sector_refresh, job_id, target)
    return {"job_id": job_id, "sectors_total": len(target), "status": "running"}


@app.get("/sectors/refresh/{job_id}")
def get_sector_refresh_status(job_id: str):
    db = SessionLocal()
    try:
        job = db.query(SectorRefreshJob).filter(SectorRefreshJob.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return _sanitize({
            "job_id": job_id, "status": job.status,
            "sectors_done": job.sectors_done, "sectors_total": job.sectors_total,
            "sectors_failed": job.sectors_failed,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        })
    finally:
        db.close()


@app.get("/sectors/{sector_name}")
def get_sector(sector_name: str):
    """Full cached snapshot for a sector (all tickers with all metrics)."""
    from sectors_engine import SectorStore
    import dataclasses
    store = SectorStore(SECTORS_DIR.parent)
    # Allow URL-encoded spaces and underscores
    sector = sector_name.replace("_", " ")
    snap = store.load(sector)
    if not snap:
        raise HTTPException(status_code=404,
            detail=f"No data for '{sector}'. POST /sectors/refresh to fetch.")
    return _sanitize(dataclasses.asdict(snap))


@app.get("/sectors/ticker/{symbol}/financials")
def get_ticker_financials(symbol: str):
    """
    Quarterly financials, earnings history, analyst upgrades, and news.
    Cached 24 hours — financials only change at earnings (quarterly).
    """
    sym = symbol.upper()
    cache_key = f"financials:{sym}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached
    from sectors_engine import get_ticker_deep_dive
    result = _sanitize(get_ticker_deep_dive(sym))
    _set_cache(cache_key, result, _TTL_FINANCIALS, "financials")
    return result


# ---------------------------------------------------------------------------
# Pairs Trading Endpoints
# ---------------------------------------------------------------------------

@app.post("/pairs/screen")
def pairs_screen(req: PairsScreenRequest):
    """
    Screen a symbol list for cointegrated pairs.
    Runs Engle-Granger cointegration tests + Kalman hedge ratio.
    Returns top 10 pairs sorted by p-value.
    """
    if len(req.symbols) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 symbols.")
    if len(req.symbols) > 30:
        raise HTTPException(status_code=400, detail="Max 30 symbols per screen.")
    try:
        import yfinance as yf
        import pandas as pd

        # Fetch price history
        syms = [s.upper() for s in req.symbols]
        raw = yf.download(syms, period="2y", progress=False, auto_adjust=True)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"]
        else:
            prices = raw[["Close"]]
            prices.columns = syms[:1]
        prices = prices.dropna(how="all").ffill()

        # Build price dict (only available symbols)
        price_dict = {}
        timestamps = [str(d.date()) for d in prices.index]
        for sym in syms:
            if sym in prices.columns:
                vals = prices[sym].dropna()
                if len(vals) >= 60:
                    price_dict[sym] = vals.values.tolist()

        if len(price_dict) < 2:
            return {"pairs": [], "message": "Not enough price data to screen pairs."}

        from pairs_engine import PairsScreener
        screener = PairsScreener()
        screener.engine.z_entry = req.z_entry
        screener.engine.z_exit  = req.z_exit
        pairs = screener.find_best_pairs(price_dict, timestamps,
                                         min_correlation=req.min_correlation)

        # Build comparison series — raw closing prices so frontend can re-index
        # to 100 at any chosen period start (3M / 6M / 1Y / 2Y range).
        _min_len  = min(len(v) for v in price_dict.values()) if price_dict else 0
        _MAX_COMP = 504                            # up to 2 years of trading days
        _start_i  = max(0, _min_len - _MAX_COMP)
        comparison_series: list[dict] = []
        for _i in range(_start_i, _min_len):
            _row: dict = {"date": timestamps[_i]}
            for _sym in price_dict:
                _raw = price_dict[_sym][_i]
                _row[_sym] = round(float(_raw), 4) if _raw is not None else None
            comparison_series.append(_row)

        return _sanitize({
            "pairs":              pairs,
            "symbols_screened":   len(price_dict),
            "comparison_series":  comparison_series,
            "comparison_symbols": list(price_dict.keys()),
        })
    except Exception as e:
        logger.exception("Pairs screen failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/pairs/{sym_a}/{sym_b}")
def pairs_signal(sym_a: str, sym_b: str, z_entry: float = 2.0, z_exit: float = 0.5):
    """
    Get the current pairs trading signal for a specific pair.
    Returns current z-score, hedge ratio, spread, and trade recommendation.
    """
    try:
        import yfinance as yf
        import pandas as pd
        import numpy as np
        from pairs_engine import PairsEngine

        syms = [sym_a.upper(), sym_b.upper()]
        raw = yf.download(syms, period="1y", progress=False, auto_adjust=True)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"]
        else:
            raise HTTPException(status_code=422, detail="Need two separate symbols.")

        prices = prices.dropna().ffill()
        if sym_a.upper() not in prices.columns or sym_b.upper() not in prices.columns:
            raise HTTPException(status_code=404, detail="Price data not found for one or both symbols.")

        arr_a = prices[sym_a.upper()].values.astype(float)
        arr_b = prices[sym_b.upper()].values.astype(float)
        timestamps = [str(d.date()) for d in prices.index]

        engine = PairsEngine(z_entry=z_entry, z_exit=z_exit)
        result = engine.test_cointegration(arr_a, arr_b, sym_a.upper(), sym_b.upper())
        signals_df = engine.generate_signals(arr_a, arr_b, sym_a.upper(), sym_b.upper(), timestamps)

        latest = signals_df.tail(1).to_dicts()[0] if not signals_df.is_empty() else {}
        spread_series = signals_df.select(["timestamp","spread","z_score","hedge_ratio"]).to_dicts()

        return _sanitize({
            "symbol_a":        sym_a.upper(),
            "symbol_b":        sym_b.upper(),
            "is_cointegrated": result.is_cointegrated,
            "p_value":         result.p_value,
            "hedge_ratio":     result.hedge_ratio,
            "half_life":       result.half_life,
            "correlation":     result.correlation,
            "current_zscore":  latest.get("z_score"),
            "current_spread":  latest.get("spread"),
            "signal_a":        latest.get(f"{sym_a.upper()}_signal"),
            "signal_b":        latest.get(f"{sym_b.upper()}_signal"),
            "position":        latest.get("position", "flat"),
            "spread_series":   spread_series[-60:],   # last 60 days for chart
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Pairs signal failed for %s/%s", sym_a, sym_b)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Trade Advisor (synthesis endpoint)
# ---------------------------------------------------------------------------

@app.post("/advisor")
def trade_advisor(req: TradeAdvisorRequest):
    """
    Trade Advisor: synthesizes technical signals, ML prediction, sentiment,
    options analytics, and macro context into structured trade recommendations.
    """
    sym = req.symbol.upper()
    result: dict = {"symbol": sym, "timestamp": datetime.utcnow().isoformat()}
    errors: list[str] = []

    # ── 1. Technical Analysis ────────────────────────────────────────────────
    try:
        import numpy as _np
        from technical_analysis import fetch_and_compute
        from signal_strategies import StrategyEngine
        ta = fetch_and_compute(sym, period="6mo", interval="1d")
        engine = StrategyEngine(ta)
        signals = engine.check_all()
        triggered = [s for s in signals if s.get("triggered")]
        bull_count = sum(1 for s in triggered if s.get("direction") == "bullish")
        bear_count = sum(1 for s in triggered if s.get("direction") == "bearish")
        # Compute HV20 from OHLCV data (always available, no options data needed)
        ohlcv = ta.get("ohlcv", [])
        closes = [row["close"] for row in ohlcv if row.get("close")]
        hv20_live = None
        if len(closes) >= 22:
            log_rets = _np.diff(_np.log(closes[-22:]))
            hv20_live = float(_np.std(log_rets) * _np.sqrt(252))
        # RSI: ta["rsi"] is a list; current_price is the spot
        rsi_series = ta.get("rsi") or []
        rsi_now = next((v for v in reversed(rsi_series) if v is not None), None)
        latest_close = ta.get("current_price") or (closes[-1] if closes else None)
        # SMA context
        sma = ta.get("sma", {})
        sma20 = (sma.get("20") or [None])[-1] if isinstance(sma.get("20"), list) else sma.get("20")
        sma50 = (sma.get("50") or [None])[-1] if isinstance(sma.get("50"), list) else sma.get("50")
        sma200 = (sma.get("200") or [None])[-1] if isinstance(sma.get("200"), list) else sma.get("200")
        result["technical"] = {
            "triggered_count": len(triggered),
            "bull_signals":    bull_count,
            "bear_signals":    bear_count,
            "ta_bias":         "bullish" if bull_count > bear_count else
                               ("bearish" if bear_count > bull_count else "neutral"),
            "top_signals":     triggered[:5],
            "latest_close":    latest_close,
            "rsi":             round(rsi_now, 2) if rsi_now is not None else None,
            "hv20":            hv20_live,
            "sma20":           round(float(sma20), 2) if sma20 is not None else None,
            "sma50":           round(float(sma50), 2) if sma50 is not None else None,
            "change_pct":      ta.get("change_pct"),
            "above_ma50":      (latest_close > float(sma50)) if (latest_close and sma50) else None,
            "above_ma200":     (latest_close > float(sma200)) if (latest_close and sma200) else None,
        }
    except Exception as e:
        errors.append(f"technical: {e}")
        result["technical"] = None

    # ── 2. Sentiment ─────────────────────────────────────────────────────────
    try:
        from sentiment_engine import SentimentEngine
        sent = SentimentEngine().compute_signal(sym)
        result["sentiment"] = {
            "score":      sent.score,
            "direction":  sent.direction,
            "strength":   sent.signal_strength,
            "articles":   sent.article_count,
            "momentum":   sent.momentum,
            "blurb":      sent.blurb,
            "headlines":  sent.headline_snippets[:3],
        }
    except Exception as e:
        errors.append(f"sentiment: {e}")
        result["sentiment"] = None

    # ── 3. ML Signal ─────────────────────────────────────────────────────────
    try:
        import yfinance as yf
        import polars as pl
        from feature_engine import FeatureEngine
        from ml_signal_engine import MLSignalEngine

        hist = yf.Ticker(sym).history(period="3y")
        if not hist.empty:
            # Build Polars DataFrame without PyArrow — construct from plain Python lists
            # to avoid pandas datetime64/nullable-int incompatibilities.
            idx = hist.index
            if hasattr(idx.dtype, "tz") and idx.dtype.tz:
                ts_us = [int(t.timestamp() * 1_000_000) for t in idx]
            else:
                ts_us = [int(t.value // 1_000) for t in idx]   # ns → µs
            prices_df = pl.DataFrame({
                "timestamp": ts_us,
                "open":      hist["Open"].astype(float).tolist(),
                "high":      hist["High"].astype(float).tolist(),
                "low":       hist["Low"].astype(float).tolist(),
                "close":     hist["Close"].astype(float).tolist(),
                "volume":    hist["Volume"].astype(int).tolist(),
                "symbol":    [sym] * len(hist),
            }).with_columns([
                pl.col("timestamp").cast(pl.Datetime("us")),
            ])
            features = FeatureEngine().compute(prices_df)
            ml_result = MLSignalEngine().run(features, sym)
            result["ml_signal"] = {
                "p_up":        ml_result.p_up,
                "direction":   ml_result.direction,
                "confidence":  ml_result.confidence,
                "strength":    ml_result.signal_strength,
                "top_feature": ml_result.top_feature,
                "accuracy":    ml_result.model_accuracy,
                "blurb":       ml_result.blurb,
            }
        else:
            result["ml_signal"] = None
    except Exception as e:
        errors.append(f"ml_signal: {e}")
        result["ml_signal"] = None

    # ── 4. Options Analytics ──────────────────────────────────────────────────
    try:
        from options_feed import OptionsStore, compute_analytics
        store = OptionsStore(OPTIONS_DIR)
        df = store.load(sym)
        # HV20 from technical block (always available even without options data)
        hv20_from_ta = (result.get("technical") or {}).get("hv20")
        if not df.is_empty():
            df_prev = store.load_prev(sym)
            spot_val = float(df["spot"].median()) if "spot" in df.columns else 0.0
            analytics = compute_analytics(sym, df, df_prev, spot_val, [])
            summary   = store.greeks_summary(sym)
            iv_rank   = analytics.get("iv_rank")
            hv20      = analytics.get("hv20") or hv20_from_ta
            avg_iv    = analytics.get("avg_iv") or analytics.get("current_iv")
            iv_hv_spread = (avg_iv - hv20) if (avg_iv and hv20) else analytics.get("iv_hv_spread")
            result["options"] = {
                "max_pain":         analytics.get("max_pain"),
                "iv_rank":          iv_rank,
                "hv20":             hv20,
                "avg_iv":           avg_iv,
                "iv_hv_spread":     iv_hv_spread,
                "put_call_ratio":   summary.get("put_call_ratio"),
                "max_gamma_strike": summary.get("max_gamma_strike"),
                "total_call_oi":    summary.get("total_call_oi"),
                "total_put_oi":     summary.get("total_put_oi"),
                "snapshot_at":      store.snapshot_time(sym),
            }
        else:
            # No options data fetched yet — still surface HV20 from price history
            result["options"] = {
                "max_pain": None, "iv_rank": None, "hv20": hv20_from_ta,
                "avg_iv": None, "iv_hv_spread": None,
                "put_call_ratio": None, "max_gamma_strike": None,
                "total_call_oi": None, "total_put_oi": None,
                "snapshot_at": None,
            }
    except Exception as e:
        errors.append(f"options: {e}")
        result["options"] = None

    # ── 5. Options Strategy Recommendations ──────────────────────────────────
    try:
        from options_feed import recommend_strategies
        # Resolve spot price from multiple sources
        spot_price = None
        if result.get("technical"):
            spot_price = result["technical"].get("latest_close")
        if not spot_price:
            try:
                import yfinance as _yf
                spot_price = _yf.Ticker(sym).fast_info.get("lastPrice")
            except Exception:
                pass
        if spot_price:
            spot_price = float(spot_price)

        if spot_price:
            _opt_ctx   = result.get("options") or {}
            iv_rank    = _opt_ctx.get("iv_rank")
            max_pain   = _opt_ctx.get("max_pain")
            avg_iv     = _opt_ctx.get("avg_iv")
            hv20_for_rec = _opt_ctx.get("hv20") or (result.get("technical") or {}).get("hv20")

            # Composite directional signal
            signals_scores = []
            if result.get("ml_signal") and result["ml_signal"]:
                ml_dir = result["ml_signal"]["p_up"]
                signals_scores.append((ml_dir - 0.5) * 2)    # → [-1, +1]
            if result.get("sentiment") and result["sentiment"]:
                signals_scores.append(result["sentiment"]["score"])
            if result.get("technical") and result["technical"]:
                ta_b = result["technical"]["bull_signals"]
                ta_br = result["technical"]["bear_signals"]
                ta_total = max(ta_b + ta_br, 1)
                signals_scores.append((ta_b - ta_br) / ta_total)
            composite = float(sum(signals_scores) / len(signals_scores)) if signals_scores else 0.0

            recs = recommend_strategies(
                symbol=sym,
                spot=spot_price,
                iv_rank=iv_rank if isinstance(iv_rank, float) else None,
                composite_signal=composite,
                max_pain=max_pain if isinstance(max_pain, float) else None,
                current_iv=avg_iv if isinstance(avg_iv, float) else None,
                hv20=hv20_for_rec if isinstance(hv20_for_rec, float) else None,
                risk_tolerance=req.risk_tolerance,
            )
            result["strategy_recommendations"] = [
                {
                    "rank":             r.rank,
                    "name":             r.name,
                    "category":         r.category,
                    "fit_score":        r.fit_score,
                    "risk_level":       r.risk_level,
                    "max_profit":       r.max_profit,
                    "max_loss":         r.max_loss,
                    "breakeven":        r.breakeven_description,
                    "rationale":        r.rationale,
                    "ideal":            r.ideal_conditions,
                    "greeks":           r.greeks_profile,
                    "legs":             r.legs,
                    "contract_details": r.contract_details,
                    "net_premium":      r.net_premium,
                    "breakeven_price":  r.breakeven_price,
                }
                for r in recs[:5]
            ]
        else:
            result["strategy_recommendations"] = []
    except Exception as e:
        errors.append(f"strategy_recs: {e}")
        result["strategy_recommendations"] = []

    # ── 6. Composite Directional Score ────────────────────────────────────────
    try:
        score_components = {}
        composite_scores = []

        if result.get("ml_signal") and result["ml_signal"]:
            ml_score = (result["ml_signal"]["p_up"] - 0.5) * 2
            score_components["ml_signal"] = round(ml_score, 3)
            composite_scores.append(ml_score * 0.40)   # 40% weight

        if result.get("sentiment") and result["sentiment"]:
            sent_score = result["sentiment"]["score"]
            score_components["sentiment"] = round(sent_score, 3)
            composite_scores.append(sent_score * 0.15)  # 15% weight

        if result.get("technical") and result["technical"]:
            ta_b = result["technical"]["bull_signals"]
            ta_br = result["technical"]["bear_signals"]
            ta_total = max(ta_b + ta_br, 1)
            ta_score = (ta_b - ta_br) / ta_total
            score_components["technical"] = round(ta_score, 3)
            composite_scores.append(ta_score * 0.30)  # 30% weight

        if result.get("sentiment") and result["sentiment"]:
            # Sentiment momentum adds 15% weight
            mom = result["sentiment"]["momentum"]
            composite_scores.append(mom * 0.15)

        composite = float(sum(composite_scores)) if composite_scores else 0.0
        composite = max(-1.0, min(1.0, composite))

        if composite >= 0.50:
            overall = "Strong Buy"
        elif composite >= 0.20:
            overall = "Buy"
        elif composite <= -0.50:
            overall = "Strong Sell"
        elif composite <= -0.20:
            overall = "Sell"
        else:
            overall = "Hold"

        result["composite"] = {
            "score":       round(composite, 4),
            "overall":     overall,
            "components":  score_components,
            "conviction":  "high" if abs(composite) > 0.5 else
                           ("moderate" if abs(composite) > 0.2 else "low"),
        }
    except Exception as e:
        errors.append(f"composite: {e}")
        result["composite"] = {"score": 0, "overall": "Hold", "components": {}}

    # ── 7. Fundamentals (for Synthesis tile) ─────────────────────────────────
    try:
        import yfinance as _yf2
        _t = _yf2.Ticker(sym)
        _info = _t.info or {}
        _price = (result.get("technical") or {}).get("latest_close")
        # Analyst price target upside
        _target_upside = None
        try:
            _apt = _t.analyst_price_targets
            if _apt is not None:
                _apt_d = _apt.to_dict() if hasattr(_apt, "to_dict") else _apt
                _mean_target = _apt_d.get("mean") or _apt_d.get("current")
                if _price and _mean_target and float(_price) > 0:
                    _target_upside = round((float(_mean_target) - float(_price)) / float(_price) * 100, 1)
        except Exception:
            pass
        # Earnings streak & last surprise
        _earnings_streak = 0
        _last_eps_surprise = None
        try:
            _eh = _t.earnings_history
            if _eh is not None and not _eh.empty and "surprisePercent" in _eh.columns:
                _recent = _eh["surprisePercent"].dropna().tolist()
                _streak = 0
                for _x in reversed(_recent):
                    if _x > 0:
                        _streak += 1
                    else:
                        break
                _earnings_streak = _streak
                if _recent:
                    _last_eps_surprise = round(float(_recent[-1]) * 100, 1)
        except Exception:
            pass
        _ta_data = result.get("technical") or {}
        def _pct(v):
            return round(float(v) * 100, 1) if v is not None else None
        def _sf(v):
            try: return round(float(v), 2) if v is not None else None
            except Exception: return None
        result["fundamentals"] = {
            "symbol":          sym,
            "pe_ratio":        _sf(_info.get("trailingPE")),
            "forward_pe":      _sf(_info.get("forwardPE")),
            "peg_ratio":       _sf(_info.get("pegRatio")),
            "target_upside":   _target_upside,
            "analyst_count":   _info.get("numberOfAnalystOpinions"),
            "roe":             _pct(_info.get("returnOnEquity")),
            "net_margin":      _pct(_info.get("profitMargins")),
            "debt_to_equity":  _sf(_info.get("debtToEquity")),
            "revenue_growth":  _pct(_info.get("revenueGrowth")),
            "eps_growth":      _pct(_info.get("earningsGrowth")),
            "earnings_streak": _earnings_streak,
            "last_eps_surprise": _last_eps_surprise,
            "above_ma50":      _ta_data.get("above_ma50"),
            "above_ma200":     _ta_data.get("above_ma200"),
            "rsi_14":          _ta_data.get("rsi"),
        }
    except Exception as e:
        errors.append(f"fundamentals: {e}")
        result["fundamentals"] = None

    result["warnings"] = errors
    return _sanitize(result)


# ---------------------------------------------------------------------------
# Black-Litterman Portfolio Optimization
# ---------------------------------------------------------------------------

@app.post("/portfolio/optimize/bl")
def optimize_black_litterman(req: BlackLittermanRequest):
    """
    Black-Litterman portfolio optimization.
    Supply signal_scores {symbol: score ∈ [-1,+1]} to express views.
    If signal_scores is empty, falls back to market-equilibrium weights.
    """
    try:
        import yfinance as yf
        import pandas as pd
        from portfolio_optimizer import BlackLittermanOptimizer

        tickers = [h.ticker.upper() for h in req.holdings]
        if not tickers:
            raise HTTPException(status_code=400, detail="No holdings provided.")

        end_dt   = pd.Timestamp.now()
        start_dt = end_dt - pd.DateOffset(years=3)
        raw = yf.download(tickers, start=start_dt.strftime("%Y-%m-%d"),
                          end=end_dt.strftime("%Y-%m-%d"), progress=False, auto_adjust=True)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"]
        else:
            prices = raw
        returns_df = prices.pct_change().dropna()

        # Current weights for equilibrium
        market_weights = {}
        total_w = sum(h.weight or 0 for h in req.holdings)
        if total_w > 0:
            for h in req.holdings:
                market_weights[h.ticker.upper()] = (h.weight or 0) / total_w
        else:
            n = len(tickers)
            market_weights = {t: 1/n for t in tickers}

        bl = BlackLittermanOptimizer(
            risk_aversion=req.risk_aversion,
            tau=req.tau,
        )

        if req.signal_scores:
            filtered = {k.upper(): v for k, v in req.signal_scores.items()
                        if k.upper() in tickers}
            bl_result = bl.from_signal_scores(returns_df, filtered)
        else:
            views: list[dict] = []
            bl_result = bl.incorporate_views(returns_df, views,
                                              equilibrium_returns=None)

        return _sanitize({
            "weights":              bl_result.weights,
            "equilibrium_returns":  bl_result.equilibrium_returns,
            "posterior_returns":    bl_result.posterior_returns,
            "portfolio_return":     bl_result.portfolio_return,
            "portfolio_vol":        bl_result.portfolio_vol,
            "portfolio_sharpe":     bl_result.portfolio_sharpe,
            "n_views":              bl_result.n_views,
            "method":               "black_litterman",
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Black-Litterman optimization failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Stress Tests
# ---------------------------------------------------------------------------

@app.post("/portfolio/stress")
def portfolio_stress_test(req: StressTestRequest):
    """
    Run historical stress scenarios against a portfolio.
    Scenarios: 2008 GFC, 2020 COVID, 2022 Rate Shock, Dot-Com, +100bps, Flash Crash.
    """
    try:
        import yfinance as yf
        import pandas as pd
        from portfolio_optimizer import RiskAnalyzer

        tickers = [h.ticker.upper() for h in req.holdings]
        if not tickers:
            raise HTTPException(status_code=400, detail="No holdings provided.")

        raw = yf.download(tickers, period="3y", progress=False, auto_adjust=True)
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw["Close"]
        else:
            prices = raw
        returns_df = prices.pct_change().dropna()

        # Derive weights
        total_w = sum(h.weight or 0 for h in req.holdings)
        if total_w > 0:
            weights = {h.ticker.upper(): (h.weight or 0) / total_w for h in req.holdings}
        else:
            n = len(tickers)
            weights = {t: 1/n for t in tickers}

        analyzer = RiskAnalyzer()
        scenarios = analyzer.run_stress_tests(weights, returns_df)
        risk = analyzer.compute_portfolio_risk(weights, returns_df)

        return _sanitize({
            "stress_scenarios": [
                {
                    "name":             s.name,
                    "description":      s.description,
                    "portfolio_impact": s.portfolio_impact,
                    "worst_symbol":     s.worst_symbol,
                    "worst_impact":     s.worst_impact,
                    "scenario_returns": s.scenario_returns,
                }
                for s in scenarios
            ],
            "current_risk": {
                "var_95":  risk.var_95,
                "cvar_95": risk.cvar_95,
                "var_99":  risk.var_99,
                "cvar_99": risk.cvar_99,
                "max_drawdown": risk.max_drawdown,
                "sharpe": risk.sharpe_ratio,
            },
            "correlation_matrix": risk.correlation_matrix,
            "drawdown_series":    risk.drawdown_series,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Stress test failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Options Strategy Recommender (standalone endpoint)
# ---------------------------------------------------------------------------

@app.get("/options/{symbol}/recommend")
def options_strategy_recommend(
    symbol: str,
    composite_signal: float = 0.0,
    risk_tolerance: str = "moderate",
):
    """
    Recommend options strategies based on current IV environment + signal bias.
    composite_signal: directional score ∈ [-1, +1] (from signals tab or trade advisor)
    """
    try:
        import yfinance as yf
        from options_feed import OptionsStore, compute_analytics, recommend_strategies

        store = OptionsStore(OPTIONS_DIR)
        df = store.load(symbol.upper())

        # Get spot price
        spot = None
        try:
            info = yf.Ticker(symbol.upper()).fast_info
            spot = float(info["lastPrice"])
        except Exception:
            pass
        if spot is None and not df.is_empty() and "spot" in df.columns:
            spot = float(df["spot"].median())
        if spot is None:
            raise HTTPException(status_code=404,
                detail=f"Could not get spot price for {symbol}.")

        iv_rank = None
        max_pain = None
        current_iv = None

        if not df.is_empty():
            df_prev = store.load_prev(symbol.upper())
            analytics = compute_analytics(symbol.upper(), df, df_prev, spot, [])
            iv_rank   = analytics.get("iv_rank")
            max_pain  = analytics.get("max_pain")
            current_iv = analytics.get("current_iv")

        recs = recommend_strategies(
            symbol=symbol.upper(),
            spot=spot,
            iv_rank=iv_rank,
            composite_signal=composite_signal,
            max_pain=max_pain,
            current_iv=current_iv,
            risk_tolerance=risk_tolerance,
        )

        return _sanitize({
            "symbol":         symbol.upper(),
            "spot":           spot,
            "iv_rank":        iv_rank,
            "max_pain":       max_pain,
            "current_iv":     current_iv,
            "composite_signal": composite_signal,
            "risk_tolerance": risk_tolerance,
            "recommendations": [
                {
                    "rank":       r.rank,
                    "name":       r.name,
                    "category":   r.category,
                    "fit_score":  r.fit_score,
                    "risk_level": r.risk_level,
                    "max_profit": r.max_profit,
                    "max_loss":   r.max_loss,
                    "breakeven":  r.breakeven_description,
                    "rationale":  r.rationale,
                    "ideal":      r.ideal_conditions,
                    "greeks":     r.greeks_profile,
                    "legs":       r.legs,
                }
                for r in recs
            ],
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Options recommendation failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# WebSocket — Live Signal Streaming
# ---------------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/signals/{symbol}")
async def ws_signals(websocket: WebSocket, symbol: str, interval_seconds: int = 60):
    """
    WebSocket endpoint: streams live composite signal updates for a symbol.
    Pushes a JSON update every `interval_seconds` seconds (default: 60).
    Client receives: {symbol, timestamp, composite_score, direction, components}
    """
    await websocket.accept()
    sym = symbol.upper()
    logger.info("WS connected: %s (interval=%ds)", sym, interval_seconds)

    try:
        while True:
            try:
                # Compute lightweight signal update
                update: dict = {
                    "symbol":    sym,
                    "timestamp": datetime.utcnow().isoformat(),
                    "type":      "signal_update",
                }

                # Sentiment (fast — RSS only)
                try:
                    from sentiment_engine import SentimentEngine
                    sent = SentimentEngine(cache_ttl_minutes=5).compute_signal(sym)
                    update["sentiment"] = {
                        "score":     sent.score,
                        "direction": sent.direction,
                        "articles":  sent.article_count,
                    }
                except Exception:
                    update["sentiment"] = None

                # Technical (fast — uses yfinance cache)
                try:
                    from technical_analysis import fetch_and_compute
                    from signal_strategies import StrategyEngine
                    ta = fetch_and_compute(sym, period="1mo", interval="1d")
                    eng = StrategyEngine(ta)
                    sigs = eng.check_all()
                    triggered = [s for s in sigs if s.get("triggered")]
                    bull = sum(1 for s in triggered if s.get("direction") == "bullish")
                    bear = sum(1 for s in triggered if s.get("direction") == "bearish")
                    update["technical"] = {
                        "bull_signals": bull,
                        "bear_signals": bear,
                        "rsi": ta.get("rsi_14", [None])[-1] if ta.get("rsi_14") else None,
                    }
                except Exception:
                    update["technical"] = None

                # Composite
                scores = []
                if update.get("sentiment"):
                    scores.append(update["sentiment"]["score"] * 0.35)
                if update.get("technical"):
                    t = update["technical"]
                    total = max(t["bull_signals"] + t["bear_signals"], 1)
                    scores.append((t["bull_signals"] - t["bear_signals"]) / total * 0.65)
                composite = float(sum(scores)) if scores else 0.0
                composite = max(-1.0, min(1.0, composite))

                update["composite"] = {
                    "score":     round(composite, 4),
                    "direction": "bullish" if composite > 0.15 else
                                 ("bearish" if composite < -0.15 else "neutral"),
                }

                await websocket.send_json(_sanitize(update))

            except Exception as inner_err:
                logger.warning("WS signal update error for %s: %s", sym, inner_err)
                await websocket.send_json({
                    "symbol": sym,
                    "timestamp": datetime.utcnow().isoformat(),
                    "type": "error",
                    "message": str(inner_err),
                })

            await asyncio.sleep(max(10, min(interval_seconds, 300)))

    except WebSocketDisconnect:
        logger.info("WS disconnected: %s", sym)


# ---------------------------------------------------------------------------
# Background Cache Warmer
# ---------------------------------------------------------------------------
#
# A single daemon thread that pre-fills the most-requested cache keys on a
# schedule matched to each data type's TTL.  This ensures users always hit
# a warm cache — cold-miss latency is never exposed after the first cycle.
#
# Schedule (all times are approximate; jitter avoids thundering-herd):
#   market:overview          every  4.5 min  (TTL = 5 min)
#   feeds:all                every 28   min  (TTL = 30 min)
#   sentiment:market:overview every 55   min  (TTL = 60 min)
#   ta:SPY|QQQ               every 14   min  (TTL = 15 min)
# ---------------------------------------------------------------------------

_warmer_thread: Optional[threading.Thread] = None


def _run_warm_cycle() -> None:
    """Execute one full warm cycle: market overview, feeds, and market sentiment."""
    # 1. Market overview — single yfinance batch call
    try:
        result = _compute_market_overview()
        _set_cache("market:overview", result, _TTL_MARKET_OVERVIEW, "warmer")
        logger.info("Warmer ✓ market:overview (%.1f KB)", len(json.dumps(result)) / 1024)
    except Exception as e:
        logger.warning("Warmer ✗ market:overview: %s", e)

    # 2. Multi-source news feeds in parallel (same ThreadPoolExecutor inside get_feeds)
    for cat in ["all", "Markets", "Technology", "Economy", "Earnings", "Commodities"]:
        try:
            import re as _re
            from datetime import timezone as _tz
            from sentiment_engine import SentimentEngine, EXTENDED_FEEDS
            engine  = SentimentEngine()
            now_utc = datetime.utcnow().replace(tzinfo=_tz.utc)
            cutoff  = now_utc - timedelta(hours=48)

            cats_to_fetch = (
                list(EXTENDED_FEEDS.keys()) if cat == "all"
                else [c for c in EXTENDED_FEEDS if c.lower() == cat.lower()]
            )
            work = [(c, u) for c in cats_to_fetch for u in EXTENDED_FEEDS.get(c, [])]

            def _fetch_one(cat_url):
                c, u = cat_url
                return c, engine._fetch_feed(u)

            fetched = []
            with ThreadPoolExecutor(max_workers=min(8, len(work) or 1)) as pool:
                futs = {pool.submit(_fetch_one, cw): cw for cw in work}
                for fut in as_completed(futs):
                    try:
                        fetched.append(fut.result())
                    except Exception:
                        pass

            all_articles = []
            for c, items in fetched:
                for item in items:
                    try:
                        pub = item.published if item.published.tzinfo else item.published.replace(tzinfo=_tz.utc)
                        if pub < cutoff:
                            continue
                        age_s    = max(0, (now_utc - pub).total_seconds())
                        rel_time = (f"{int(age_s/60)}m ago" if age_s < 3600
                                    else f"{int(age_s/3600)}h ago" if age_s < 86400
                                    else f"{int(age_s/86400)}d ago")
                    except Exception:
                        rel_time = "recently"
                    all_articles.append({
                        "title":   item.title, "summary":  item.summary[:280],
                        "url":     item.url,   "source":   item.source,
                        "published": str(item.published), "rel_time": rel_time,
                        "score":   round(item.normalized_score, 3),
                        "symbol_mentioned": item.symbol_mentioned,
                        "tags":    _tag_article(item.title, item.summary), "category": c,
                    })

            seen: set = set()
            unique = []
            for a in all_articles:
                k = _re.sub(r"[^a-z ]", "", a["title"].lower())[:60]
                if k not in seen:
                    seen.add(k)
                    unique.append(a)
            unique.sort(key=lambda a: a["published"], reverse=True)
            page = unique[:80]
            sc: dict = {}
            for a in page:
                sc[a["source"]] = sc.get(a["source"], 0) + 1
            out = _sanitize({"articles": page, "count": len(page), "category": cat, "source_counts": sc})
            _set_cache(f"feeds:{cat.lower()}:48", out, _TTL_FEEDS, "warmer:feeds")
            logger.info("Warmer ✓ feeds:%s (%d articles)", cat, len(page))
        except Exception as e:
            logger.warning("Warmer ✗ feeds:%s: %s", cat, e)

    # 3. Market-wide sentiment (SPY, QQQ, IWM, GLD)
    try:
        from sentiment_engine import get_market_sentiment as _gms
        results = _gms()
        out = _sanitize({
            sym: {"score": r.score, "direction": r.direction,
                  "strength": r.signal_strength, "articles": r.article_count, "blurb": r.blurb}
            for sym, r in results.items()
        })
        _set_cache("sentiment:market:overview", out, _TTL_SENTIMENT, "warmer:sentiment")
        logger.info("Warmer ✓ sentiment:market:overview")
    except Exception as e:
        logger.warning("Warmer ✗ sentiment:market: %s", e)

    # 4. TA for the two most-requested symbols
    for sym in ["SPY", "QQQ"]:
        try:
            from technical_analysis import fetch_and_compute
            result = fetch_and_compute(sym, period="1y", interval="1d",
                                       sma_periods=[20, 50, 200], ema_periods=[9, 21])
            try:
                from signal_strategies import StrategyEngine, god_mode as _gm
                eng = StrategyEngine(result)
                result["signals"]  = eng.check_all()
                result["god_mode"] = _gm(result["signals"], result, sym)
            except Exception:
                result["signals"]  = []
                result["god_mode"] = None
            out = _sanitize(result)
            _set_cache(f"ta:{sym}:1y:1d", out, _TTL_TECHNICAL, "warmer:ta")
            logger.info("Warmer ✓ ta:%s", sym)
        except Exception as e:
            logger.warning("Warmer ✗ ta:%s: %s", sym, e)


def _warmer_loop() -> None:
    """
    Daemon thread main loop.  Runs a warm cycle on startup (after a short
    delay to let the DB settle) and then on a rolling schedule.
    """
    import time

    # Schedules: {name: (interval_seconds, last_run_timestamp)}
    schedules = {
        "market_overview": 270,    # every 4.5 min  (TTL 5 min)
        "feeds":           1680,   # every 28 min   (TTL 30 min)
        "sentiment":       3300,   # every 55 min   (TTL 60 min)
        "ta":              840,    # every 14 min   (TTL 15 min)
    }
    last: dict[str, float] = {k: 0.0 for k in schedules}

    # Short initial sleep so the process finishes startup before the first hit
    time.sleep(15)
    logger.info("Cache warmer started — running initial warm cycle")

    while True:
        now = time.time()

        if now - last["market_overview"] >= schedules["market_overview"]:
            last["market_overview"] = now
            try:
                result = _compute_market_overview()
                _set_cache("market:overview", result, _TTL_MARKET_OVERVIEW, "warmer")
                logger.info("Warmer ✓ market:overview")
            except Exception as e:
                logger.warning("Warmer ✗ market:overview: %s", e)

        if now - last["ta"] >= schedules["ta"]:
            last["ta"] = now
            for sym in ["SPY", "QQQ"]:
                try:
                    from technical_analysis import fetch_and_compute
                    res = fetch_and_compute(sym, period="1y", interval="1d",
                                            sma_periods=[20, 50, 200], ema_periods=[9, 21])
                    try:
                        from signal_strategies import StrategyEngine, god_mode as _gm
                        eng = StrategyEngine(res)
                        res["signals"]  = eng.check_all()
                        res["god_mode"] = _gm(res["signals"], res, sym)
                    except Exception:
                        res["signals"] = []; res["god_mode"] = None
                    _set_cache(f"ta:{sym}:1y:1d", _sanitize(res), _TTL_TECHNICAL, "warmer:ta")
                    logger.info("Warmer ✓ ta:%s", sym)
                except Exception as e:
                    logger.warning("Warmer ✗ ta:%s: %s", sym, e)

        if now - last["feeds"] >= schedules["feeds"]:
            last["feeds"] = now
            # Re-use the existing get_feeds logic by clearing its cache key first
            # and calling it normally (it will recompute and re-cache)
            for cat in ["all", "Markets", "Technology", "Economy"]:
                try:
                    _run_warm_cycle.__func__ if hasattr(_run_warm_cycle, "__func__") else None
                    # Directly invalidate stale key so next request recomputes
                    db = SessionLocal()
                    try:
                        db.query(CacheEntry).filter(
                            CacheEntry.key == f"feeds:{cat.lower()}:48"
                        ).delete(synchronize_session=False)
                        db.commit()
                    finally:
                        db.close()
                except Exception:
                    pass
            # Run the full warm cycle in the feeds thread
            try:
                _run_warm_cycle()
            except Exception as e:
                logger.warning("Warmer ✗ warm_cycle: %s", e)

        if now - last["sentiment"] >= schedules["sentiment"]:
            last["sentiment"] = now
            try:
                from sentiment_engine import get_market_sentiment as _gms
                results = _gms()
                out = _sanitize({
                    sym: {"score": r.score, "direction": r.direction,
                          "strength": r.signal_strength, "articles": r.article_count, "blurb": r.blurb}
                    for sym, r in results.items()
                })
                _set_cache("sentiment:market:overview", out, _TTL_SENTIMENT, "warmer:sentiment")
                logger.info("Warmer ✓ sentiment:market")
            except Exception as e:
                logger.warning("Warmer ✗ sentiment: %s", e)

        # Prune stale cache rows once an hour
        if now % 3600 < 30:
            try:
                n = _prune_cache()
                if n:
                    logger.info("Cache pruner removed %d stale rows", n)
            except Exception:
                pass

        time.sleep(30)  # poll every 30 s


def _start_cache_warmer() -> None:
    global _warmer_thread
    if _warmer_thread is None or not _warmer_thread.is_alive():
        _warmer_thread = threading.Thread(
            target=_warmer_loop, daemon=True, name="cache-warmer"
        )
        _warmer_thread.start()
        logger.info("Cache warmer thread launched")


@app.on_event("startup")
def on_startup() -> None:
    """Run once when the ASGI server starts: prune old cache rows and launch warmer."""
    try:
        n = _prune_cache()
        logger.info("Startup: pruned %d expired cache rows", n)
    except Exception as e:
        logger.warning("Startup cache prune failed: %s", e)
    _start_cache_warmer()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
