"""
Universe Pre-computation Engine
================================
Batch-computes and persists TA results, sentiment scores, domain outputs,
and Alpha rankings for all tickers in the universe.

Endpoints read from the cached_results DB table instead of calling
yfinance/RSS on every request — enabling instant page loads.

Usage:
    from precompute import precompute_universe
    precompute_universe(session_factory)  # runs in background
"""

from __future__ import annotations

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DB Cache Read/Write Helpers
# ---------------------------------------------------------------------------

def db_cache_get(session_factory, cache_key: str) -> Optional[dict]:
    """Read a cached result from the DB. Returns None if expired or missing."""
    from models import CachedResult
    session = session_factory()
    try:
        row = session.query(CachedResult).filter_by(cache_key=cache_key).first()
        if row is None:
            return None
        if row.expires_at < datetime.utcnow():
            return None  # expired
        return json.loads(row.value_json)
    except Exception as e:
        logger.debug("DB cache read failed for %s: %s", cache_key, e)
        return None
    finally:
        session.close()


def db_cache_set(session_factory, cache_key: str, value: dict, ttl_seconds: int, source: str = ""):
    """Write a computed result to the DB cache."""
    from models import CachedResult
    session = session_factory()
    try:
        value_str = json.dumps(value, default=str)
        expires = datetime.utcnow() + timedelta(seconds=ttl_seconds)
        existing = session.query(CachedResult).filter_by(cache_key=cache_key).first()
        if existing:
            existing.value_json = value_str
            existing.expires_at = expires
            existing.updated_at = datetime.utcnow()
            existing.source = source
        else:
            session.add(CachedResult(
                cache_key=cache_key,
                value_json=value_str,
                expires_at=expires,
                source=source,
            ))
        session.commit()
    except Exception as e:
        logger.warning("DB cache write failed for %s: %s", cache_key, e)
        session.rollback()
    finally:
        session.close()


# ---------------------------------------------------------------------------
# TTL Constants (seconds)
# ---------------------------------------------------------------------------

TTL_TA = 43200             # 12 hours — overnight batch + 3x intraday refresh
TTL_SENTIMENT = 14400      # 4 hours — overnight batch
TTL_MARKET_OVERVIEW = 300  # 5 minutes — real-time
TTL_FUNDAMENTALS = 86400   # 24 hours — overnight batch
TTL_ADVISOR = 43200        # 12 hours
TTL_DOMAIN_SCORES = 43200  # 12 hours — overnight batch
TTL_ALPHA = 43200          # 12 hours — overnight batch
TTL_MARKET_PRICE = 300     # 5 minutes — real-time


# ---------------------------------------------------------------------------
# Per-ticker Computation Functions
# ---------------------------------------------------------------------------

def compute_ta_for_ticker(symbol: str) -> Optional[dict]:
    """Compute full technical analysis for a ticker."""
    try:
        from technical_analysis import fetch_and_compute
        from signal_strategies import StrategyEngine
        ta = fetch_and_compute(symbol, period="1y", interval="1d")
        if not ta:
            return None
        se = StrategyEngine()
        signals = se.check_all(ta)
        god_mode = se.god_mode(signals, ta)

        # Serialize — strip large arrays for storage, keep key metrics
        result = {
            "symbol": symbol,
            "current_price": ta.get("current_price"),
            "change": ta.get("change"),
            "change_pct": ta.get("change_pct"),
            "n_bars": ta.get("n_bars"),
            "period": ta.get("period"),
            "interval": ta.get("interval"),
            "signals": signals,
            "god_mode": god_mode,
            "computed_at": datetime.utcnow().isoformat(),
        }

        # Keep last 5 bars of OHLCV for quick display
        if ta.get("ohlcv"):
            result["last_bars"] = ta["ohlcv"][-5:]

        # Key indicator values
        if ta.get("rsi"):
            result["rsi"] = ta["rsi"][-1] if ta["rsi"] else None
        if ta.get("macd") and ta["macd"].get("histogram"):
            result["macd_hist"] = ta["macd"]["histogram"][-1]
        if ta.get("atr"):
            result["atr"] = ta["atr"][-1] if ta["atr"] else None

        return result
    except Exception as e:
        logger.warning("TA computation failed for %s: %s", symbol, e)
        return None


def compute_sentiment_for_ticker(symbol: str) -> Optional[dict]:
    """Compute sentiment score for a ticker."""
    try:
        from sentiment_engine import SentimentEngine
        se = SentimentEngine()
        result = se.compute_signal(symbol)
        if result:
            result["computed_at"] = datetime.utcnow().isoformat()
        return result
    except Exception as e:
        logger.warning("Sentiment computation failed for %s: %s", symbol, e)
        return None


def compute_domain_score(symbol: str, ta_result: dict, sent_result: dict) -> dict:
    """Compute normalized domain scores from TA + sentiment results."""
    from alpha_engine import rank_opportunity
    domain_outputs = []

    # Technical domain
    if ta_result and ta_result.get("god_mode"):
        gm = ta_result["god_mode"]
        net = gm.get("net_score", 0)
        domain_outputs.append({
            "domain": "technicals",
            "score": max(-1, min(1, net)),
            "confidence": gm.get("confidence", 50),
            "bias": "Bullish" if net > 0.15 else ("Bearish" if net < -0.15 else "Neutral"),
            "setup": gm.get("direction", ""),
            "drivers": gm.get("primary_signals", [])[:2],
            "risks": [],
        })

    # Sentiment/quant domain
    if sent_result and sent_result.get("score") is not None:
        s = max(-1, min(1, sent_result["score"]))
        domain_outputs.append({
            "domain": "quant",
            "score": s,
            "confidence": min(100, abs(s) * 50 + (sent_result.get("articles", 0)) * 2),
            "bias": "Bullish" if s > 0.15 else ("Bearish" if s < -0.15 else "Neutral"),
            "drivers": [f"Sentiment: {sent_result.get('direction', 'neutral')}"],
            "risks": [],
        })

    if domain_outputs:
        return rank_opportunity(symbol, domain_outputs)
    return {"symbol": symbol, "alpha_score": 0, "confidence": 0, "status": "No Trade"}


# ---------------------------------------------------------------------------
# Batch Universe Pre-computation
# ---------------------------------------------------------------------------

def precompute_universe(session_factory, symbols: list[str] = None, max_workers: int = 4):
    """
    Batch-compute TA, sentiment, and domain scores for all tickers.
    Stores results in the cached_results DB table.
    """
    from alpha_engine import DEFAULT_UNIVERSE

    if symbols is None:
        symbols = [t["symbol"] for t in DEFAULT_UNIVERSE]

    logger.info("Pre-computing universe: %d tickers", len(symbols))
    computed = 0
    errors = 0

    def process_ticker(sym):
        nonlocal computed, errors
        try:
            # TA
            ta = compute_ta_for_ticker(sym)
            if ta:
                db_cache_set(session_factory, f"ta:{sym}:1y:1d", ta, TTL_TA, source="precompute")

            # Sentiment
            sent = compute_sentiment_for_ticker(sym)
            if sent:
                db_cache_set(session_factory, f"sentiment:{sym}", sent, TTL_SENTIMENT, source="precompute")

            # Domain scores for Alpha
            domain = compute_domain_score(sym, ta, sent)
            if domain:
                db_cache_set(session_factory, f"alpha:domain:{sym}", domain, TTL_DOMAIN_SCORES, source="precompute")

            computed += 1
            logger.info("Pre-computed %s (%d/%d)", sym, computed, len(symbols))
        except Exception as e:
            errors += 1
            logger.warning("Pre-compute failed for %s: %s", sym, e)

    # Process in parallel with limited concurrency
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(process_ticker, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception:
                pass

    logger.info("Pre-computation complete: %d succeeded, %d failed", computed, errors)
    return {"computed": computed, "errors": errors, "total": len(symbols)}


def precompute_market_overview(session_factory):
    """Pre-compute and cache market overview data."""
    try:
        import yfinance as yf
        # This mirrors the _compute_market_overview logic in main.py
        # but stores it in DB for instant reads
        logger.info("Pre-computing market overview")
        # The actual market overview computation is complex and lives in main.py
        # We'll let the existing cache warmer handle it, but persist to DB too
    except Exception as e:
        logger.warning("Market overview precompute failed: %s", e)
