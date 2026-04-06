"""
Alpha Opportunity Engine
========================
Scans the universe, consumes normalized domain outputs,
ranks opportunities, and produces a shortlist of actionable ideas.

This is the platform's unified alpha layer — the final synthesis.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default Domain Weights
# ---------------------------------------------------------------------------

DEFAULT_WEIGHTS = {
    "macro": 0.10,
    "markets": 0.10,
    "sectors": 0.10,
    "technicals": 0.20,
    "options": 0.15,
    "quant": 0.20,
    "fundamentals": 0.10,
    "pairs": 0.05,
}


# ---------------------------------------------------------------------------
# Core Scoring
# ---------------------------------------------------------------------------

def compute_alpha_score(domain_outputs: list[dict], weights: dict = None) -> float:
    """Weighted average of available domain scores, renormalized for coverage."""
    w = weights or DEFAULT_WEIGHTS
    available = [d for d in domain_outputs if d.get("score") is not None]
    if not available:
        return 0.0

    total_weight = sum(w.get(d["domain"], 0.05) for d in available)
    if total_weight == 0:
        return 0.0

    score = sum(d["score"] * w.get(d["domain"], 0.05) for d in available) / total_weight
    return max(-1, min(1, score))


def compute_domain_agreement(domain_outputs: list[dict]) -> dict:
    """Evaluate alignment across domains."""
    scores = [d["score"] for d in domain_outputs if d.get("score") is not None]
    if len(scores) < 2:
        return {"label": "Insufficient Data", "score": 0}

    avg = sum(scores) / len(scores)
    dispersion = sum((s - avg) ** 2 for s in scores) / len(scores)

    if dispersion < 0.05:
        return {"label": "High Agreement", "score": 90}
    elif dispersion < 0.12:
        return {"label": "Moderate Agreement", "score": 70}
    elif dispersion < 0.25:
        return {"label": "Mixed", "score": 50}
    return {"label": "Conflicted", "score": 25}


def compute_alpha_confidence(
    domain_outputs: list[dict],
    total_domains: int = 8,
) -> float:
    """Confidence based on agreement, domain confidence, and coverage."""
    available = [d for d in domain_outputs if d.get("score") is not None]
    if not available:
        return 0

    agreement = compute_domain_agreement(available)["score"]
    avg_conf = sum(d.get("confidence", 50) for d in available) / len(available)
    coverage = len(available) / total_domains * 100

    confidence = 0.30 * agreement + 0.30 * avg_conf + 0.25 * coverage + 0.15 * 50  # freshness placeholder
    return max(0, min(100, confidence))


def score_to_bias(score: float) -> str:
    if score >= 0.40:
        return "Bullish"
    elif score >= 0.15:
        return "Neutral-to-Bullish"
    elif score > -0.15:
        return "Neutral"
    elif score > -0.40:
        return "Neutral-to-Bearish"
    return "Bearish"


def score_to_posture(score: float, confidence: float) -> str:
    if score >= 0.5 and confidence >= 65:
        return "Aggressive Long"
    elif score >= 0.2 and confidence >= 45:
        return "Tactical Long"
    elif score <= -0.5 and confidence >= 65:
        return "Aggressive Short"
    elif score <= -0.2 and confidence >= 45:
        return "Tactical Short"
    elif confidence < 25:
        return "No Trade"
    return "Neutral / Wait"


# ---------------------------------------------------------------------------
# Opportunity Classification
# ---------------------------------------------------------------------------

def classify_opportunity_type(domain_outputs: list[dict]) -> str:
    by_domain = {d["domain"]: d for d in domain_outputs if d.get("score") is not None}

    tech = by_domain.get("technicals", {})
    quant = by_domain.get("quant", {})
    opts = by_domain.get("options", {})
    fund = by_domain.get("fundamentals", {})
    pairs = by_domain.get("pairs", {})

    if pairs.get("score") and abs(pairs["score"]) > 0.25:
        return "Relative Value"

    tech_s = tech.get("score", 0)
    quant_s = quant.get("score", 0)

    if tech_s > 0.35 and quant_s > 0.20:
        return "Trend Continuation"

    fund_s = fund.get("score", 0)
    if fund_s > 0.30 and tech_s > 0:
        return "Value + Momentum"

    opts_s = opts.get("score", 0)
    if abs(opts_s) > 0.30 and abs(tech_s) < 0.20:
        return "Volatility Opportunity"

    setup = tech.get("setup", "")
    if "Breakout" in str(setup):
        return "Breakout"
    if "Breakdown" in str(setup):
        return "Breakdown Risk"

    if tech_s < -0.3 and quant_s < -0.2:
        return "Reversal Watch"

    return "Watchlist Only"


def classify_status(alpha_score: float, confidence: float, posture: str) -> str:
    if confidence >= 65 and abs(alpha_score) >= 0.35:
        return "Active Trade"
    elif confidence >= 50 and abs(alpha_score) >= 0.20:
        return "Pre-Entry"
    elif confidence >= 35 and abs(alpha_score) >= 0.10:
        return "Watchlist"
    elif posture == "No Trade":
        return "No Trade"
    return "Weak"


# ---------------------------------------------------------------------------
# Full Alpha Ranking
# ---------------------------------------------------------------------------

def rank_opportunity(symbol: str, domain_outputs: list[dict]) -> dict:
    """Compute full Alpha ranking for a single symbol."""
    alpha_score = compute_alpha_score(domain_outputs)
    agreement = compute_domain_agreement(domain_outputs)
    confidence = compute_alpha_confidence(domain_outputs)
    bias = score_to_bias(alpha_score)
    posture = score_to_posture(alpha_score, confidence)
    opp_type = classify_opportunity_type(domain_outputs)
    status = classify_status(alpha_score, confidence, posture)

    # Collect drivers and risks
    drivers = []
    risks = []
    for d in sorted(domain_outputs, key=lambda x: abs(x.get("score", 0)), reverse=True)[:3]:
        drivers.extend(d.get("drivers", [])[:1])
        risks.extend(d.get("risks", [])[:1])

    return {
        "symbol": symbol,
        "alpha_score": round(alpha_score, 3),
        "confidence": round(confidence, 1),
        "bias": bias,
        "opportunity_type": opp_type,
        "status": status,
        "posture": posture,
        "domain_agreement": agreement["label"],
        "top_drivers": drivers[:3],
        "risks": risks[:3],
        "domain_breakdown": [{
            "domain": d["domain"],
            "score": d.get("score"),
            "confidence": d.get("confidence"),
            "bias": d.get("bias"),
        } for d in domain_outputs if d.get("score") is not None],
        "timestamp": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Default Universe
# ---------------------------------------------------------------------------

DEFAULT_UNIVERSE = [
    {"symbol": "SPY", "display_name": "S&P 500", "asset_type": "ETF", "sector": "Broad Market"},
    {"symbol": "QQQ", "display_name": "Nasdaq 100", "asset_type": "ETF", "sector": "Technology"},
    {"symbol": "IWM", "display_name": "Russell 2000", "asset_type": "ETF", "sector": "Small Cap"},
    {"symbol": "AAPL", "display_name": "Apple", "asset_type": "Equity", "sector": "Technology"},
    {"symbol": "MSFT", "display_name": "Microsoft", "asset_type": "Equity", "sector": "Technology"},
    {"symbol": "GOOGL", "display_name": "Alphabet", "asset_type": "Equity", "sector": "Communication"},
    {"symbol": "AMZN", "display_name": "Amazon", "asset_type": "Equity", "sector": "Consumer"},
    {"symbol": "NVDA", "display_name": "NVIDIA", "asset_type": "Equity", "sector": "Technology"},
    {"symbol": "TSLA", "display_name": "Tesla", "asset_type": "Equity", "sector": "Consumer"},
    {"symbol": "META", "display_name": "Meta", "asset_type": "Equity", "sector": "Communication"},
    {"symbol": "GLD", "display_name": "Gold", "asset_type": "ETF", "sector": "Commodities"},
    {"symbol": "TLT", "display_name": "20Y Treasury", "asset_type": "ETF", "sector": "Fixed Income"},
    {"symbol": "XLF", "display_name": "Financials", "asset_type": "SectorETF", "sector": "Financials"},
    {"symbol": "XLK", "display_name": "Technology", "asset_type": "SectorETF", "sector": "Technology"},
    {"symbol": "XLE", "display_name": "Energy", "asset_type": "SectorETF", "sector": "Energy"},
]
