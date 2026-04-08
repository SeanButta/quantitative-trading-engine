"""
Factor Exposure Engine
======================
Computes Fama-French-style factor exposures for individual tickers.
Uses ETF proxies for factor returns (no external data dependency).

Factor Proxies:
  Market  : SPY (broad equity)
  Size    : IWM - SPY (small cap premium)
  Value   : IWD - IWF (value vs growth)
  Momentum: MTUM (momentum factor ETF, or computed from 12-1 month returns)
  Quality : QUAL (quality factor ETF, or computed from ROE/margins)

Computation: Rolling OLS regression of ticker returns against factor returns.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def compute_factor_exposure(
    symbol: str,
    period_days: int = 252,
    session_factory=None,
) -> Optional[dict]:
    """
    Compute factor betas for a ticker using ETF proxies.
    Returns factor loadings (betas) and R² for the regression.
    """
    from sqlalchemy import create_engine, text
    from pathlib import Path

    db_path = Path(__file__).parent / "quant_engine.db"
    if not db_path.exists():
        return None

    engine = create_engine(f"sqlite:///{db_path}", echo=False)
    start_date = (datetime.utcnow() - timedelta(days=period_days + 30)).strftime("%Y-%m-%d")

    # Fetch returns for ticker + factor proxies
    factor_syms = {
        "market": "SPY",
        "size_long": "IWM",
        "size_short": "SPY",
        "value_long": "IWD",
        "value_short": "IWF",
    }
    all_syms = [symbol.upper()] + list(set(factor_syms.values()))

    returns_map = {}
    with engine.connect() as conn:
        for sym in all_syms:
            rows = conn.execute(
                text("SELECT date, close FROM ohlcv_daily WHERE symbol = :sym AND date >= :start ORDER BY date"),
                {"sym": sym, "start": start_date},
            ).fetchall()
            if len(rows) >= 20:
                closes = [float(r[1]) for r in rows]
                rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
                returns_map[sym] = rets

    sym_upper = symbol.upper()
    if sym_upper not in returns_map:
        return {"symbol": sym_upper, "error": "Insufficient price data", "factors": {}}
    if "SPY" not in returns_map:
        return {"symbol": sym_upper, "error": "Missing market factor (SPY)", "factors": {}}

    # Align all return series to same length
    min_len = min(len(returns_map[s]) for s in returns_map)
    aligned = {k: v[-min_len:] for k, v in returns_map.items()}

    # Build factor returns
    ticker_rets = np.array(aligned[sym_upper])
    market_rets = np.array(aligned.get("SPY", [0] * min_len))

    factors = {"Market": market_rets}

    # Size factor: IWM - SPY (small cap premium)
    if "IWM" in aligned:
        factors["Size"] = np.array(aligned["IWM"]) - market_rets

    # Value factor: IWD - IWF (value vs growth)
    if "IWD" in aligned and "IWF" in aligned:
        factors["Value"] = np.array(aligned["IWD"]) - np.array(aligned["IWF"])

    # Momentum: simple 12-1 month momentum of the ticker itself
    if len(ticker_rets) >= 252:
        mom = np.zeros(len(ticker_rets))
        for i in range(252, len(ticker_rets)):
            mom[i] = np.mean(ticker_rets[i - 252:i - 21])  # 12m - 1m
        factors["Momentum"] = mom
    elif len(ticker_rets) >= 63:
        mom = np.zeros(len(ticker_rets))
        for i in range(63, len(ticker_rets)):
            mom[i] = np.mean(ticker_rets[i - 63:i - 21])  # 3m - 1m
        factors["Momentum"] = mom

    # Build regression matrix: Y = α + β1*F1 + β2*F2 + ... + ε
    factor_names = list(factors.keys())
    X = np.column_stack([factors[f] for f in factor_names])
    X = np.column_stack([np.ones(len(ticker_rets)), X])  # add intercept

    try:
        # OLS: β = (X'X)^(-1) X'Y
        XtX_inv = np.linalg.inv(X.T @ X)
        betas = XtX_inv @ X.T @ ticker_rets

        # R² calculation
        y_hat = X @ betas
        ss_res = np.sum((ticker_rets - y_hat) ** 2)
        ss_tot = np.sum((ticker_rets - np.mean(ticker_rets)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0

        alpha = round(float(betas[0]) * 252 * 100, 2)  # annualized alpha in %
        factor_betas = {}
        for i, name in enumerate(factor_names):
            factor_betas[name] = {
                "beta": round(float(betas[i + 1]), 3),
                "label": _interpret_beta(name, float(betas[i + 1])),
            }

        return {
            "symbol": sym_upper,
            "alpha_annualized_pct": alpha,
            "r_squared": round(float(r_squared), 3),
            "factors": factor_betas,
            "period_days": min_len,
            "interpretation": _interpret_profile(factor_betas, alpha),
        }

    except np.linalg.LinAlgError:
        return {"symbol": sym_upper, "error": "Regression failed (singular matrix)", "factors": {}}


def _interpret_beta(factor: str, beta: float) -> str:
    """Generate a human-readable interpretation of a factor beta."""
    if factor == "Market":
        if beta > 1.2:
            return "Aggressive — amplifies market moves"
        elif beta > 0.8:
            return "Market-tracking"
        elif beta > 0.5:
            return "Defensive — dampens market moves"
        else:
            return "Low market sensitivity"
    elif factor == "Size":
        return "Small-cap tilt" if beta > 0.2 else ("Large-cap tilt" if beta < -0.2 else "Neutral size")
    elif factor == "Value":
        return "Value-oriented" if beta > 0.2 else ("Growth-oriented" if beta < -0.2 else "Blend")
    elif factor == "Momentum":
        return "Momentum exposure" if beta > 0.1 else ("Contrarian" if beta < -0.1 else "Neutral momentum")
    return ""


def _interpret_profile(factors: dict, alpha: float) -> str:
    """Generate a one-line factor profile summary."""
    parts = []
    mkt = factors.get("Market", {}).get("beta", 1.0)
    if mkt > 1.2:
        parts.append("high-beta")
    elif mkt < 0.7:
        parts.append("low-beta")

    size = factors.get("Size", {}).get("beta", 0)
    if size > 0.3:
        parts.append("small-cap tilted")
    elif size < -0.3:
        parts.append("large-cap tilted")

    val = factors.get("Value", {}).get("beta", 0)
    if val > 0.3:
        parts.append("value")
    elif val < -0.3:
        parts.append("growth")

    if alpha > 5:
        parts.append("positive alpha")
    elif alpha < -5:
        parts.append("negative alpha")

    return ", ".join(parts).capitalize() if parts else "Balanced factor profile"
