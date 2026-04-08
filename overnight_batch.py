"""
Overnight Batch Pre-Computation Engine
=======================================
Runs the complete data acquisition + computation pipeline for all tickers
in the universe. Designed to run nightly at 4:00 AM ET before market open.

After a successful run, all endpoints serve from cache — no live yfinance
calls needed during the trading session.

Usage:
    # Run full batch
    python overnight_batch.py

    # Or trigger from API
    POST /admin/overnight-batch
"""

from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "quant_engine.db"


# ---------------------------------------------------------------------------
# Phase 1: OHLCV Acquisition
# ---------------------------------------------------------------------------

def _ingest_all_ohlcv(session_factory, symbols: list[str], lookback_days: int = 5) -> dict:
    """
    Batch-download recent OHLCV for all symbols using IngestionScheduler.
    Uses yf.download() in batches of 50 — much faster than per-ticker calls.
    """
    logger.info("Phase 1: Ingesting OHLCV for %d symbols (lookback=%d days)", len(symbols), lookback_days)
    t0 = time.time()
    try:
        from ingestion_scheduler import IngestionScheduler
        scheduler = IngestionScheduler(session_factory)
        result = scheduler.ingest_eod_prices(symbols, lookback_days=lookback_days)
        elapsed = time.time() - t0
        logger.info("Phase 1 complete: %s (%.1fs)", result, elapsed)
        return {"status": "ok", "elapsed": elapsed, **result}
    except Exception as e:
        logger.error("Phase 1 failed: %s", e)
        return {"status": "error", "error": str(e), "elapsed": time.time() - t0}


# ---------------------------------------------------------------------------
# Phase 2: Fundamentals / Info Dict Acquisition
# ---------------------------------------------------------------------------

def _ingest_all_info(session_factory, symbols: list[str], max_workers: int = 12) -> dict:
    """
    Fetch yfinance .info dict for all symbols and cache in DB.
    Includes: fundamentals, analyst targets, earnings, recommendations.
    """
    logger.info("Phase 2: Fetching info dicts for %d symbols", len(symbols))
    t0 = time.time()
    done = 0
    errors = 0

    def _fetch_info(sym):
        nonlocal done, errors
        try:
            import yfinance as yf
            t = yf.Ticker(sym)
            info = t.info or {}
            if not info:
                errors += 1
                return

            # Enrich with analyst/earnings data
            try:
                recs = t.recommendations_summary
                if recs is not None and not recs.empty:
                    info["_recommendations"] = recs.to_dict()
            except Exception:
                pass
            try:
                targets = t.analyst_price_targets
                if targets is not None:
                    info["_analyst_targets"] = targets if isinstance(targets, dict) else {}
            except Exception:
                pass
            try:
                cal = t.calendar
                if cal is not None:
                    if isinstance(cal, dict):
                        info["_calendar"] = cal
                    elif hasattr(cal, "to_dict"):
                        info["_calendar"] = cal.to_dict()
            except Exception:
                pass

            # Write to cache
            _write_info_cache(sym, info)
            done += 1
            if done % 100 == 0:
                logger.info("Phase 2 progress: %d/%d info dicts fetched", done, len(symbols))
        except Exception as e:
            errors += 1
            logger.debug("Info fetch failed for %s: %s", sym, e)

    # Process in batches to avoid rate limiting
    batch_size = 50
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_fetch_info, sym): sym for sym in batch}
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception:
                    pass
        if i + batch_size < len(symbols):
            time.sleep(3)  # pause between batches

    elapsed = time.time() - t0
    logger.info("Phase 2 complete: %d fetched, %d errors (%.1fs)", done, errors, elapsed)
    return {"status": "ok", "fetched": done, "errors": errors, "elapsed": elapsed}


def _write_info_cache(symbol: str, info: dict) -> None:
    """Write info dict to CacheEntry table."""
    try:
        from sqlalchemy import create_engine, text
        val = json.dumps(info, default=str)
        expires = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        eng = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        with eng.connect() as conn:
            conn.execute(
                text("INSERT OR REPLACE INTO cache_entries (key, value_json, expires_at, created_at, refreshed_at, source, size_bytes) "
                     "VALUES (:k, :v, :e, :now, :now, 'overnight_batch', :sz)"),
                {"k": f"ticker:info:{symbol.upper()}", "v": val, "e": expires,
                 "now": datetime.utcnow().isoformat(), "sz": len(val)},
            )
            conn.commit()
    except Exception as e:
        logger.debug("Info cache write failed for %s: %s", symbol, e)


# ---------------------------------------------------------------------------
# Phase 3: Technical Analysis + Strategy Signals
# ---------------------------------------------------------------------------

def _compute_all_ta(session_factory, symbols: list[str], max_workers: int = 8) -> dict:
    """
    Compute TA indicators + StrategyEngine + god_mode for all symbols.
    Reads OHLCV from ohlcv_daily DB (populated in Phase 1).
    """
    logger.info("Phase 3: Computing TA for %d symbols", len(symbols))
    t0 = time.time()
    done = 0
    errors = 0

    from precompute import db_cache_set

    def _compute_ta(sym):
        nonlocal done, errors
        try:
            from technical_analysis import fetch_and_compute
            from signal_strategies import StrategyEngine, god_mode

            ta = fetch_and_compute(sym, period="1y", interval="1d",
                                   sma_periods=[20, 50, 200], ema_periods=[9, 21])
            if ta:
                try:
                    eng = StrategyEngine(ta)
                    sigs = eng.check_all()
                    gm = god_mode(sigs, ta, sym)
                    ta["signals"] = sigs
                    ta["god_mode"] = gm
                except Exception:
                    ta["signals"] = []
                    ta["god_mode"] = None

                # Sanitize for JSON storage (remove numpy arrays, large data)
                sanitized = _sanitize_ta(ta)
                db_cache_set(session_factory, f"ta:{sym}:1y:1d", sanitized, 43200, source="overnight_batch")
                done += 1
                if done % 100 == 0:
                    logger.info("Phase 3 progress: %d/%d TA computed", done, len(symbols))
        except Exception as e:
            errors += 1
            logger.debug("TA computation failed for %s: %s", sym, e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_compute_ta, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception:
                pass

    elapsed = time.time() - t0
    logger.info("Phase 3 complete: %d computed, %d errors (%.1fs)", done, errors, elapsed)
    return {"status": "ok", "computed": done, "errors": errors, "elapsed": elapsed}


def _sanitize_ta(ta: dict) -> dict:
    """Remove large arrays and numpy types for JSON storage."""
    import numpy as np
    result = {}
    for k, v in ta.items():
        if isinstance(v, np.ndarray):
            result[k] = v.tolist()
        elif isinstance(v, (np.floating, np.integer)):
            result[k] = float(v)
        elif isinstance(v, dict):
            result[k] = _sanitize_ta(v)
        elif isinstance(v, list) and len(v) > 500:
            result[k] = v[-500:]  # keep last 500 entries
        else:
            result[k] = v
    return result


# ---------------------------------------------------------------------------
# Phase 4: Sentiment + ML Signal + Quant Signals
# ---------------------------------------------------------------------------

def _compute_all_signals(session_factory, symbols: list[str], max_workers: int = 6) -> dict:
    """
    Compute sentiment, ML signal, and quant signals for symbols.
    Reuses existing precompute functions.
    """
    logger.info("Phase 4: Computing signals for %d symbols", len(symbols))
    t0 = time.time()

    from precompute import precompute_universe
    result = precompute_universe(session_factory, symbols, max_workers=max_workers)

    elapsed = time.time() - t0
    logger.info("Phase 4 complete: %d computed, %d errors (%.1fs)",
                result.get("computed", 0), result.get("errors", 0), elapsed)
    return {"status": "ok", "elapsed": elapsed, **result}


# ---------------------------------------------------------------------------
# Phase 5: Sector Snapshots + Alpha Rankings
# ---------------------------------------------------------------------------

def _compute_all_scores(session_factory, symbols: list[str]) -> dict:
    """
    Compute sector snapshots and Alpha rankings from cached data.
    """
    logger.info("Phase 5: Computing scores and rankings")
    t0 = time.time()

    # Alpha rankings
    try:
        from alpha_engine import get_full_universe, rank_opportunity
        from precompute import db_cache_get, db_cache_set

        universe = get_full_universe()
        scored = 0
        for ticker in universe:
            sym = ticker["symbol"]
            # Try to build domain outputs from cached data
            domain_outputs = []

            ta_cached = db_cache_get(session_factory, f"ta:{sym}:1y:1d")
            if ta_cached and ta_cached.get("god_mode"):
                gm = ta_cached["god_mode"]
                net = gm.get("net_score", 0)
                domain_outputs.append({
                    "domain": "technicals", "score": max(-1, min(1, net)),
                    "confidence": gm.get("confidence", 50),
                    "bias": "Bullish" if net > 0.15 else ("Bearish" if net < -0.15 else "Neutral"),
                    "drivers": gm.get("primary_signals", [])[:2],
                    "risks": [],
                })

            if domain_outputs:
                ranking = rank_opportunity(sym, domain_outputs)
                ranking["display_name"] = ticker.get("display_name", sym)
                ranking["asset_type"] = ticker.get("asset_type", "Equity")
                ranking["sector"] = ticker.get("sector", "")
                db_cache_set(session_factory, f"alpha:domain:{sym}", ranking, 43200, source="overnight_batch")
                scored += 1

        elapsed = time.time() - t0
        logger.info("Phase 5 complete: %d tickers scored (%.1fs)", scored, elapsed)
        return {"status": "ok", "scored": scored, "elapsed": elapsed}
    except Exception as e:
        logger.error("Phase 5 failed: %s", e)
        return {"status": "error", "error": str(e), "elapsed": time.time() - t0}


# ---------------------------------------------------------------------------
# Phase 6: FRED Macro + Feeds
# ---------------------------------------------------------------------------

def _ingest_macro_and_feeds(session_factory) -> dict:
    """Ingest FRED macro series and RSS feeds."""
    logger.info("Phase 6: Ingesting macro data and feeds")
    t0 = time.time()
    results = {}

    try:
        from ingestion_scheduler import IngestionScheduler
        scheduler = IngestionScheduler(session_factory)
        results["fred"] = scheduler.ingest_fred_series()
    except Exception as e:
        results["fred"] = {"error": str(e)}
        logger.warning("FRED ingestion failed: %s", e)

    elapsed = time.time() - t0
    logger.info("Phase 6 complete (%.1fs)", elapsed)
    return {"status": "ok", "elapsed": elapsed, **results}


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def run_overnight_batch(session_factory=None) -> dict:
    """
    Run the complete overnight batch pipeline.
    Returns a summary dict with timing and success counts per phase.
    """
    logger.info("=" * 60)
    logger.info("OVERNIGHT BATCH STARTING at %s", datetime.utcnow().isoformat())
    logger.info("=" * 60)
    t_start = time.time()

    if session_factory is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        session_factory = sessionmaker(bind=engine)

    # Build universe
    from alpha_engine import get_full_universe, DEFAULT_UNIVERSE
    universe = get_full_universe()
    all_symbols = [t["symbol"] for t in universe]
    core_symbols = [t["symbol"] for t in DEFAULT_UNIVERSE]

    logger.info("Universe: %d total tickers, %d core", len(all_symbols), len(core_symbols))

    results = {}

    # Phase 1: OHLCV for all tickers
    results["ohlcv"] = _ingest_all_ohlcv(session_factory, all_symbols, lookback_days=5)

    # Phase 2: Info dicts for all tickers
    results["info"] = _ingest_all_info(session_factory, all_symbols, max_workers=12)

    # Phase 3: TA for top 500 (core + S&P 500)
    ta_symbols = all_symbols[:500] if len(all_symbols) > 500 else all_symbols
    results["ta"] = _compute_all_ta(session_factory, ta_symbols, max_workers=8)

    # Phase 4: Signals for core symbols
    results["signals"] = _compute_all_signals(session_factory, core_symbols, max_workers=4)

    # Phase 5: Alpha rankings
    results["scores"] = _compute_all_scores(session_factory, all_symbols)

    # Phase 6: Macro + Feeds
    results["macro"] = _ingest_macro_and_feeds(session_factory)

    total_elapsed = time.time() - t_start
    results["total_elapsed"] = round(total_elapsed, 1)
    results["completed_at"] = datetime.utcnow().isoformat()
    results["universe_size"] = len(all_symbols)

    logger.info("=" * 60)
    logger.info("OVERNIGHT BATCH COMPLETE in %.1f seconds", total_elapsed)
    logger.info("=" * 60)

    # Write batch status to cache
    try:
        from sqlalchemy import create_engine, text
        eng = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        with eng.connect() as conn:
            conn.execute(
                text("INSERT OR REPLACE INTO cache_entries (key, value_json, expires_at, created_at, refreshed_at, source, size_bytes) "
                     "VALUES ('batch:last_run', :v, :e, :now, :now, 'overnight_batch', :sz)"),
                {"v": json.dumps(results, default=str),
                 "e": (datetime.utcnow() + timedelta(hours=48)).isoformat(),
                 "now": datetime.utcnow().isoformat(),
                 "sz": len(json.dumps(results, default=str))},
            )
            conn.commit()
    except Exception:
        pass

    return results


# ---------------------------------------------------------------------------
# Intraday Refresh (lightweight — prices + TA only)
# ---------------------------------------------------------------------------

def run_intraday_refresh(session_factory=None) -> dict:
    """
    Lightweight refresh: update recent OHLCV and recompute TA for core symbols.
    Designed to run 3x during trading session (9:45 AM, 12:00 PM, 3:30 PM ET).
    """
    logger.info("INTRADAY REFRESH starting")
    t0 = time.time()

    if session_factory is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        session_factory = sessionmaker(bind=engine)

    from alpha_engine import DEFAULT_UNIVERSE
    core_symbols = [t["symbol"] for t in DEFAULT_UNIVERSE]

    results = {}

    # Refresh OHLCV for core symbols (5-day lookback catches any gaps)
    results["ohlcv"] = _ingest_all_ohlcv(session_factory, core_symbols, lookback_days=5)

    # Recompute TA from updated OHLCV
    results["ta"] = _compute_all_ta(session_factory, core_symbols, max_workers=4)

    # Recompute Alpha rankings
    results["scores"] = _compute_all_scores(session_factory, core_symbols)

    total = time.time() - t0
    results["total_elapsed"] = round(total, 1)
    logger.info("INTRADAY REFRESH complete in %.1fs", total)
    return results


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    result = run_overnight_batch()
    print(json.dumps(result, indent=2, default=str))
