"""
Ensemble Signal Engine
======================
Combines multiple signal sources into a unified decision output
using the platform's standardized scoring system.

Signal sources: ML (from signal_engine), Sentiment, Technical signals,
Regime-based, Pairs, and any promoted Lab signals.

All outputs normalized to -1 to +1 with bias, confidence, and posture.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Standardized Output Helpers
# ---------------------------------------------------------------------------

def score_to_bias(score: float) -> str:
    if score >= 0.4:
        return "Bullish"
    elif score >= 0.15:
        return "Neutral-to-Bullish"
    elif score > -0.15:
        return "Neutral"
    elif score > -0.4:
        return "Neutral-to-Bearish"
    return "Bearish"


def score_to_posture(score: float, confidence: float) -> str:
    if score >= 0.6 and confidence >= 60:
        return "Aggressive Long"
    elif score >= 0.2 and confidence >= 40:
        return "Tactical Long"
    elif score <= -0.6 and confidence >= 60:
        return "Aggressive Short"
    elif score <= -0.2 and confidence >= 40:
        return "Tactical Short"
    elif confidence < 25:
        return "No Trade"
    return "Neutral / Wait"


# ---------------------------------------------------------------------------
# Normalize Individual Signals
# ---------------------------------------------------------------------------

def normalize_ml_signal(ml_data: dict) -> Optional[dict]:
    """Normalize ML signal output to standard contract."""
    if not ml_data:
        return None
    p_up = ml_data.get("p_up")
    if p_up is None:
        return None

    # Convert probability to score: 0.5 = neutral, >0.5 = bullish
    score = (p_up - 0.5) * 2  # maps 0-1 to -1..+1
    score = max(-1, min(1, score))
    confidence = abs(score) * 100 * (ml_data.get("accuracy", 0.5))

    return {
        "signal_id": "ml_gradient_boosting",
        "signal_name": "ML Gradient Boosting",
        "signal_type": "ML",
        "score": round(score, 3),
        "confidence": round(min(100, confidence), 1),
        "bias": score_to_bias(score),
        "horizon": "Short",
        "drivers": [f"P(up) = {p_up:.1%}", f"Top feature: {ml_data.get('top_feature', '—')}"],
        "risks": ["Model trained on historical patterns that may not persist"],
        "weight": 0.35,
    }


def normalize_sentiment_signal(sent_data: dict) -> Optional[dict]:
    """Normalize sentiment signal."""
    if not sent_data:
        return None
    raw_score = sent_data.get("score", 0)
    if raw_score is None:
        return None

    score = max(-1, min(1, raw_score))
    momentum = sent_data.get("momentum", 0) or 0
    articles = sent_data.get("articles", 0) or 0
    confidence = min(100, abs(score) * 50 + (articles * 2) + abs(momentum) * 20)

    drivers = []
    if sent_data.get("direction"):
        drivers.append(f"Sentiment: {sent_data['direction']}")
    if momentum > 0:
        drivers.append("Momentum improving")
    elif momentum < 0:
        drivers.append("Momentum softening")
    drivers.append(f"{articles} articles analyzed")

    return {
        "signal_id": "news_sentiment",
        "signal_name": "News Sentiment",
        "signal_type": "Sentiment",
        "score": round(score, 3),
        "confidence": round(confidence, 1),
        "bias": score_to_bias(score),
        "horizon": "Short",
        "drivers": drivers,
        "risks": ["Sentiment can reverse quickly", "Keyword-based — may miss nuance"],
        "weight": 0.15,
    }


def normalize_technical_signals(signals_data: list, god_mode: dict) -> Optional[dict]:
    """Normalize technical signal engine output."""
    if not god_mode:
        return None

    bull_count = god_mode.get("bull_count", 0)
    bear_count = god_mode.get("bear_count", 0)
    total = bull_count + bear_count
    if total == 0:
        return None

    net = god_mode.get("net_score", 0)
    score = max(-1, min(1, net))
    confidence = god_mode.get("confidence", 0)

    drivers = []
    if god_mode.get("primary_signals"):
        drivers.extend(god_mode["primary_signals"][:3])
    drivers.append(f"{bull_count} bull / {bear_count} bear signals")

    return {
        "signal_id": "technical_28_signals",
        "signal_name": "Technical Signal Engine",
        "signal_type": "Rule",
        "score": round(score, 3),
        "confidence": round(confidence, 1),
        "bias": score_to_bias(score),
        "horizon": "Short",
        "drivers": drivers,
        "risks": ["Signals may conflict in choppy markets"],
        "weight": 0.30,
    }


def normalize_quant_signals(signal_results: dict) -> Optional[dict]:
    """Normalize the 5-signal quant engine output (conditional prob, bayesian, etc.)."""
    if not signal_results:
        return None

    # Aggregate directional signals
    directional = signal_results.get("directional_score", 0)
    if directional is None:
        return None

    score = max(-1, min(1, directional))
    signals_used = signal_results.get("signals_used", [])
    confidence = min(100, abs(score) * 60 + len(signals_used) * 5)

    return {
        "signal_id": "quant_5_signal",
        "signal_name": "Quant Signal Engine",
        "signal_type": "Statistical",
        "score": round(score, 3),
        "confidence": round(confidence, 1),
        "bias": score_to_bias(score),
        "horizon": "Medium",
        "drivers": [f"Directional score: {score:.2f}"] + signals_used[:2],
        "risks": ["Statistical edge may be regime-dependent"],
        "weight": 0.20,
    }


# ---------------------------------------------------------------------------
# Ensemble Engine
# ---------------------------------------------------------------------------

def compute_ensemble(signals: list[dict]) -> dict:
    """
    Combine normalized signals into a unified ensemble output.

    Each signal: {signal_id, score, confidence, weight, ...}
    """
    if not signals:
        return {
            "score": 0,
            "bias": "Neutral",
            "confidence": 0,
            "posture": "No Trade",
            "top_drivers": ["No active signals"],
            "risks": ["Insufficient signal data"],
            "active_signals": [],
            "agreement_score": 0,
        }

    # Weighted score
    total_weight = sum(s.get("weight", 0.1) for s in signals)
    if total_weight == 0:
        total_weight = 1

    weighted_score = sum(
        s["score"] * s.get("weight", 0.1) * (s["confidence"] / 100)
        for s in signals
    ) / total_weight

    ensemble_score = max(-1, min(1, weighted_score))

    # Agreement score
    bullish = sum(1 for s in signals if s["score"] > 0.1)
    bearish = sum(1 for s in signals if s["score"] < -0.1)
    neutral = len(signals) - bullish - bearish
    agreement = max(bullish, bearish) / max(len(signals), 1) * 100

    # Confidence
    avg_confidence = sum(s["confidence"] for s in signals) / len(signals)
    ensemble_confidence = min(100, 0.5 * avg_confidence + 0.5 * agreement)

    # Top drivers
    drivers = []
    for s in sorted(signals, key=lambda x: abs(x["score"]) * x.get("weight", 0.1), reverse=True)[:3]:
        drivers.extend(s.get("drivers", [])[:1])

    # Risks
    risks = []
    for s in signals:
        risks.extend(s.get("risks", [])[:1])
    risks = risks[:3]

    bias = score_to_bias(ensemble_score)
    posture = score_to_posture(ensemble_score, ensemble_confidence)

    return {
        "score": round(ensemble_score, 3),
        "bias": bias,
        "confidence": round(ensemble_confidence, 1),
        "posture": posture,
        "top_drivers": drivers,
        "risks": risks,
        "active_signals": signals,
        "agreement_score": round(agreement, 1),
        "bull_count": bullish,
        "bear_count": bearish,
        "neutral_count": neutral,
    }


def generate_ensemble_narrative(ensemble: dict) -> list[str]:
    """Generate deterministic narrative from ensemble output."""
    bullets = []
    score = ensemble["score"]
    confidence = ensemble["confidence"]
    agreement = ensemble.get("agreement_score", 0)

    if score >= 0.3 and confidence >= 50:
        bullets.append("The live signal ensemble shows a clear bullish edge with moderate-to-high confidence.")
    elif score >= 0.1:
        bullets.append("The live signal ensemble shows a modest bullish lean, though conviction is not strong.")
    elif score <= -0.3 and confidence >= 50:
        bullets.append("Multiple signals are aligned to the downside with elevated conviction.")
    elif score <= -0.1:
        bullets.append("Signals lean modestly bearish, but agreement is not decisive.")
    else:
        bullets.append("Signals are mixed with limited directional edge.")

    if agreement >= 70:
        bullets.append(f"Signal agreement is high ({agreement:.0f}%) — conviction is elevated.")
    elif agreement <= 40:
        bullets.append(f"Signal agreement is low ({agreement:.0f}%) — conflicting views across sources.")

    if ensemble.get("bull_count", 0) > 0 and ensemble.get("bear_count", 0) > 0:
        bullets.append(f"{ensemble['bull_count']} bullish vs {ensemble['bear_count']} bearish signals — partial conflict.")

    bullets.append(f"Suggested posture: {ensemble['posture']}")

    return bullets
