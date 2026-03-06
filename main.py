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
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Add project root to path (flat structure)
_ROOT = str(Path(__file__).parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from models import Base, Project, Strategy, Run

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

# Database — use absolute path so it's stable regardless of cwd
_DB_PATH = Path(__file__).parent / "quant_engine.db"
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{_DB_PATH}")
engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

# Artifacts directory
ARTIFACTS_DIR = Path(os.getenv("ARTIFACTS_DIR", str(Path(__file__).parent / "runs" / "artifacts")))
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).parent / "runs" / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

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


# ---------------------------------------------------------------------------
# Endpoints: Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
