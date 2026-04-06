"""
Macro Regime Engine
===================
8-pillar scoring model that classifies the macro environment into
regimes (Goldilocks, Late-Cycle, Stagflation, etc.) using FRED data.

Pillars: Growth, Inflation, Labor, Policy, Liquidity, Credit, Fiscal, Global
Each scored -2 to +2. Composite = weighted average * 25 → range ~[-50, +50].

Deterministic templates for narrative, risk, and market implications.
No LLM dependency.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pillar Weights
# ---------------------------------------------------------------------------

PILLAR_WEIGHTS = {
    "growth": 0.20,
    "inflation": 0.15,
    "labor": 0.10,
    "policy": 0.15,
    "liquidity": 0.15,
    "credit": 0.10,
    "fiscal": 0.05,
    "global": 0.10,
}

# ---------------------------------------------------------------------------
# FRED Series → Pillar Mapping
# ---------------------------------------------------------------------------

PILLAR_SERIES = {
    "growth": ["GDPC1", "A191RL1Q225SBEA", "INDPRO", "RETAILSMNSA", "HOUST", "TCU"],
    "inflation": ["CPIAUCSL", "CPILFESL", "PCEPILFE", "T5YIE", "T10YIE"],
    "labor": ["UNRATE", "PAYEMS", "ICSA", "U6RATE", "AWHAETP"],
    "policy": ["FEDFUNDS", "DGS10", "DGS2", "T10Y2Y", "T10Y3M"],
    "liquidity": ["WALCL", "M2SL", "BOGMBASE", "DTWEXBGS"],
    "credit": ["BAA10Y", "DRTSCILM"],
    "fiscal": [],  # Limited FRED data; scored from proxies
    "global": ["DEXUSEU", "GOLDAMGBD228NLBM", "DCOILWTICO", "VIXCLS"],
}


def _clamp(v, lo=-2.0, hi=2.0):
    return max(lo, min(hi, v))


def _pct_change(obs, months_back=12):
    """Compute % change from N months ago. obs = [{date, value}, ...]"""
    if not obs or len(obs) < 2:
        return None
    current = obs[-1]["value"]
    if current is None:
        return None
    target_date = datetime.strptime(obs[-1]["date"], "%Y-%m-%d") - timedelta(days=months_back * 30)
    for o in reversed(obs):
        d = datetime.strptime(o["date"], "%Y-%m-%d")
        if d <= target_date and o["value"] is not None:
            if o["value"] == 0:
                return None
            return ((current - o["value"]) / abs(o["value"])) * 100
    return None


def _latest(obs):
    """Get latest non-null value."""
    if not obs:
        return None
    for o in reversed(obs):
        if o.get("value") is not None:
            return o["value"]
    return None


def _trend_direction(obs, periods=3):
    """Determine if recent observations are rising, falling, or flat."""
    vals = [o["value"] for o in obs[-periods - 1:] if o.get("value") is not None]
    if len(vals) < 2:
        return "unknown"
    delta = vals[-1] - vals[0]
    pct = delta / abs(vals[0]) * 100 if vals[0] != 0 else 0
    if pct > 1:
        return "rising"
    elif pct < -1:
        return "falling"
    return "flat"


# ---------------------------------------------------------------------------
# Pillar Scoring Functions
# ---------------------------------------------------------------------------

def score_growth(series_data: dict) -> dict:
    """Score the growth pillar from FRED data."""
    score = 0.0
    drivers = []

    # GDP growth rate
    gdp_growth = series_data.get("A191RL1Q225SBEA", {})
    gdp_val = _latest(gdp_growth.get("obs", []))
    if gdp_val is not None:
        direction = "positive" if gdp_val > 1 else "negative" if gdp_val < 0 else "neutral"
        drivers.append({"label": "Real GDP Growth", "value": round(gdp_val, 1), "unit": "% QoQ Ann.", "direction": direction})
        if gdp_val > 2.5:
            score += 0.75
        elif gdp_val > 1:
            score += 0.25
        elif gdp_val > 0:
            score -= 0.25
        else:
            score -= 1.0

    # Industrial production YoY
    indpro = series_data.get("INDPRO", {})
    indpro_chg = _pct_change(indpro.get("obs", []), 12)
    if indpro_chg is not None:
        direction = "positive" if indpro_chg > 0 else "negative"
        drivers.append({"label": "Industrial Production", "value": round(indpro_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.5 if indpro_chg > 0 else -0.5

    # Retail sales trend
    retail = series_data.get("RETAILSMNSA", {})
    retail_chg = _pct_change(retail.get("obs", []), 12)
    if retail_chg is not None:
        direction = "positive" if retail_chg > 2 else "negative" if retail_chg < -2 else "neutral"
        drivers.append({"label": "Retail Sales", "value": round(retail_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.5 if retail_chg > 2 else (-0.5 if retail_chg < -2 else 0)

    # Housing starts trend
    housing = series_data.get("HOUST", {})
    housing_chg = _pct_change(housing.get("obs", []), 12)
    if housing_chg is not None:
        direction = "positive" if housing_chg > 0 else "negative"
        drivers.append({"label": "Housing Starts", "value": round(housing_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.25 if housing_chg > 0 else -0.25

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Growth is expanding with broadening momentum" if score >= 1 else
        "Growth is positive but moderating" if score > 0 else
        "Growth is slowing with weaker breadth" if score > -1 else
        "Growth is contracting across multiple indicators"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_inflation(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # CPI YoY
    cpi = series_data.get("CPIAUCSL", {})
    cpi_chg = _pct_change(cpi.get("obs", []), 12)
    if cpi_chg is not None:
        direction = "negative" if cpi_chg > 3 else ("positive" if cpi_chg < 2.5 else "neutral")
        drivers.append({"label": "CPI YoY", "value": round(cpi_chg, 1), "unit": "%", "direction": direction})
        if cpi_chg < 2.0:
            score += 0.75
        elif cpi_chg < 3.0:
            score += 0.25
        elif cpi_chg < 4.0:
            score -= 0.5
        else:
            score -= 1.0

    # Core CPI YoY
    core_cpi = series_data.get("CPILFESL", {})
    core_chg = _pct_change(core_cpi.get("obs", []), 12)
    if core_chg is not None:
        direction = "negative" if core_chg > 3 else ("positive" if core_chg < 2.5 else "neutral")
        drivers.append({"label": "Core CPI YoY", "value": round(core_chg, 1), "unit": "%", "direction": direction})
        if core_chg < 2.5:
            score += 0.5
        elif core_chg > 3.5:
            score -= 0.75

    # 5Y breakeven inflation expectations
    t5yie = series_data.get("T5YIE", {})
    t5yie_val = _latest(t5yie.get("obs", []))
    if t5yie_val is not None:
        direction = "positive" if t5yie_val < 2.5 else "negative"
        drivers.append({"label": "5Y Breakeven", "value": round(t5yie_val, 2), "unit": "%", "direction": direction})
        if t5yie_val < 2.0:
            score += 0.25
        elif t5yie_val > 3.0:
            score -= 0.5

    # Note: positive score = inflation falling (good), negative = sticky/rising (bad)
    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Inflation is falling toward target" if score >= 1 else
        "Inflation is cooling but remains above target" if score > 0 else
        "Inflation is sticky and above target" if score > -1 else
        "Inflation is elevated and re-accelerating"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_labor(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # Unemployment rate
    unrate = series_data.get("UNRATE", {})
    ur_val = _latest(unrate.get("obs", []))
    if ur_val is not None:
        direction = "positive" if ur_val < 4.5 else ("negative" if ur_val > 5.5 else "neutral")
        drivers.append({"label": "Unemployment Rate", "value": round(ur_val, 1), "unit": "%", "direction": direction})
        if ur_val < 4.0:
            score += 0.75
        elif ur_val < 5.0:
            score += 0.25
        elif ur_val > 6.0:
            score -= 1.0
        else:
            score -= 0.5

    # Initial claims trend
    icsa = series_data.get("ICSA", {})
    icsa_val = _latest(icsa.get("obs", []))
    if icsa_val is not None:
        direction = "positive" if icsa_val < 250 else ("negative" if icsa_val > 350 else "neutral")
        drivers.append({"label": "Initial Claims", "value": round(icsa_val, 0), "unit": "K", "direction": direction})
        if icsa_val < 220:
            score += 0.5
        elif icsa_val > 300:
            score -= 0.5

    # Payrolls trend
    payems = series_data.get("PAYEMS", {})
    payems_chg = _pct_change(payems.get("obs", []), 12)
    if payems_chg is not None:
        direction = "positive" if payems_chg > 1 else "negative"
        drivers.append({"label": "Payroll Growth", "value": round(payems_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.5 if payems_chg > 1 else (-0.5 if payems_chg < 0 else 0)

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Labor market is strong with robust hiring" if score >= 1 else
        "Labor market is resilient but gradually cooling" if score > 0 else
        "Labor market is softening" if score > -1 else
        "Labor market is deteriorating with rising joblessness"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_policy(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # Fed funds rate (higher = more restrictive = negative for score)
    ff = series_data.get("FEDFUNDS", {})
    ff_val = _latest(ff.get("obs", []))
    if ff_val is not None:
        direction = "negative" if ff_val > 4 else ("positive" if ff_val < 2 else "neutral")
        drivers.append({"label": "Fed Funds Rate", "value": round(ff_val, 2), "unit": "%", "direction": direction})
        if ff_val > 5.0:
            score -= 1.5
        elif ff_val > 4.0:
            score -= 1.0
        elif ff_val > 2.5:
            score -= 0.5
        elif ff_val < 1.0:
            score += 0.75

    # Yield curve 10Y-2Y
    curve = series_data.get("T10Y2Y", {})
    curve_val = _latest(curve.get("obs", []))
    if curve_val is not None:
        direction = "negative" if curve_val < 0 else "positive"
        drivers.append({"label": "Yield Curve (10Y-2Y)", "value": round(curve_val, 2), "unit": "bps", "direction": direction})
        if curve_val < -0.5:
            score -= 0.75
        elif curve_val < 0:
            score -= 0.25
        elif curve_val > 0.5:
            score += 0.25

    # 10Y yield level
    dgs10 = series_data.get("DGS10", {})
    dgs10_val = _latest(dgs10.get("obs", []))
    if dgs10_val is not None:
        drivers.append({"label": "10Y Treasury", "value": round(dgs10_val, 2), "unit": "%", "direction": "neutral"})

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Policy is accommodative — supporting risk assets" if score >= 1 else
        "Policy stance is neutral" if score > -0.5 else
        "Policy is restrictive" if score > -1.5 else
        "Policy is deeply restrictive — significant headwind"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_liquidity(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # Fed balance sheet YoY
    walcl = series_data.get("WALCL", {})
    walcl_chg = _pct_change(walcl.get("obs", []), 12)
    if walcl_chg is not None:
        direction = "positive" if walcl_chg > 0 else "negative"
        drivers.append({"label": "Fed Balance Sheet", "value": round(walcl_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.75 if walcl_chg > 0 else -0.75

    # M2 YoY
    m2 = series_data.get("M2SL", {})
    m2_chg = _pct_change(m2.get("obs", []), 12)
    if m2_chg is not None:
        direction = "positive" if m2_chg > 0 else "negative"
        drivers.append({"label": "M2 Money Supply", "value": round(m2_chg, 1), "unit": "% YoY", "direction": direction})
        score += 0.5 if m2_chg > 2 else (-0.5 if m2_chg < 0 else 0)

    # Dollar strength (stronger dollar = tighter liquidity)
    dxy = series_data.get("DTWEXBGS", {})
    dxy_chg = _pct_change(dxy.get("obs", []), 12)
    if dxy_chg is not None:
        direction = "negative" if dxy_chg > 3 else ("positive" if dxy_chg < -3 else "neutral")
        drivers.append({"label": "USD Index", "value": round(dxy_chg, 1), "unit": "% YoY", "direction": direction})
        if dxy_chg > 5:
            score -= 0.5
        elif dxy_chg < -5:
            score += 0.5

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Liquidity is expanding — supportive for risk assets" if score >= 1 else
        "Liquidity is adequate but not abundant" if score > 0 else
        "Liquidity remains tight but drain has slowed" if score > -1 else
        "Liquidity is draining — significant headwind"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_credit(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # BAA corporate spread
    baa = series_data.get("BAA10Y", {})
    baa_val = _latest(baa.get("obs", []))
    if baa_val is not None:
        direction = "positive" if baa_val < 2.0 else ("negative" if baa_val > 3.0 else "neutral")
        drivers.append({"label": "BAA Spread", "value": round(baa_val, 2), "unit": "%", "direction": direction})
        if baa_val < 1.5:
            score += 1.0
        elif baa_val < 2.5:
            score += 0.25
        elif baa_val > 3.5:
            score -= 1.0
        else:
            score -= 0.5

    # C&I loan tightening
    ci = series_data.get("DRTSCILM", {})
    ci_val = _latest(ci.get("obs", []))
    if ci_val is not None:
        direction = "positive" if ci_val < 10 else ("negative" if ci_val > 30 else "neutral")
        drivers.append({"label": "C&I Loan Tightening", "value": round(ci_val, 1), "unit": "% banks", "direction": direction})
        if ci_val > 40:
            score -= 1.0
        elif ci_val > 20:
            score -= 0.5
        elif ci_val < 0:
            score += 0.5

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Credit conditions are benign — spreads tight" if score >= 1 else
        "Credit conditions are not yet stressed" if score > 0 else
        "Credit is tightening" if score > -1 else
        "Credit stress is elevated — risk of broader contagion"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_fiscal(series_data: dict) -> dict:
    """Fiscal pillar — limited FRED data, score conservatively."""
    score = -0.5  # Default mild headwind (deficits are persistent)
    drivers = [{"label": "Fiscal Stance", "value": None, "unit": "", "direction": "negative"}]
    trend = "Stable"
    interp = "Fiscal burden and issuance pressure remain elevated"
    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


def score_global(series_data: dict) -> dict:
    score = 0.0
    drivers = []

    # Dollar as proxy (weakening dollar = improving global conditions)
    eur = series_data.get("DEXUSEU", {})
    eur_chg = _pct_change(eur.get("obs", []), 6)
    if eur_chg is not None:
        direction = "positive" if eur_chg > 2 else ("negative" if eur_chg < -2 else "neutral")
        drivers.append({"label": "EUR/USD", "value": round(eur_chg, 1), "unit": "% 6M", "direction": direction})
        score += 0.5 if eur_chg > 2 else (-0.5 if eur_chg < -5 else 0)

    # Oil as global demand proxy
    oil = series_data.get("DCOILWTICO", {})
    oil_chg = _pct_change(oil.get("obs", []), 12)
    if oil_chg is not None:
        direction = "positive" if oil_chg > 5 else ("negative" if oil_chg < -10 else "neutral")
        drivers.append({"label": "WTI Crude", "value": round(oil_chg, 1), "unit": "% YoY", "direction": direction})

    # VIX as stress proxy
    vix = series_data.get("VIXCLS", {})
    vix_val = _latest(vix.get("obs", []))
    if vix_val is not None:
        direction = "positive" if vix_val < 18 else ("negative" if vix_val > 25 else "neutral")
        drivers.append({"label": "VIX", "value": round(vix_val, 1), "unit": "", "direction": direction})
        if vix_val > 30:
            score -= 0.75
        elif vix_val > 25:
            score -= 0.25
        elif vix_val < 15:
            score += 0.5

    trend = "Improving" if score > 0.3 else ("Deteriorating" if score < -0.3 else "Stable")
    interp = (
        "Global backdrop is supportive" if score >= 0.5 else
        "Global picture is mixed" if score > -0.5 else
        "Global conditions are deteriorating"
    )

    return {"score": _clamp(score), "trend": trend, "interpretation": interp, "drivers": drivers}


# ---------------------------------------------------------------------------
# Composite Score & Regime Classification
# ---------------------------------------------------------------------------

SCORING_FUNCTIONS = {
    "growth": score_growth,
    "inflation": score_inflation,
    "labor": score_labor,
    "policy": score_policy,
    "liquidity": score_liquidity,
    "credit": score_credit,
    "fiscal": score_fiscal,
    "global": score_global,
}


def compute_pillar_scores(series_data: dict) -> dict:
    """Run all pillar scoring functions. Returns {pillar: {score, trend, interpretation, drivers}}."""
    results = {}
    for pillar, fn in SCORING_FUNCTIONS.items():
        try:
            results[pillar] = fn(series_data)
            results[pillar]["weight"] = PILLAR_WEIGHTS[pillar]
        except Exception as e:
            logger.warning("Pillar %s scoring failed: %s", pillar, e)
            results[pillar] = {
                "score": 0, "weight": PILLAR_WEIGHTS[pillar],
                "trend": "Unknown", "interpretation": "Data unavailable", "drivers": [],
            }
    return results


def compute_composite(pillar_scores: dict) -> float:
    """Weighted average * 25 → range ~[-50, +50]."""
    weighted_avg = sum(
        pillar_scores[p]["score"] * PILLAR_WEIGHTS[p]
        for p in PILLAR_WEIGHTS
    )
    return round(weighted_avg * 25, 1)


def classify_regime(pillar_scores: dict) -> str:
    g = pillar_scores.get("growth", {}).get("score", 0)
    i = pillar_scores.get("inflation", {}).get("score", 0)
    l = pillar_scores.get("labor", {}).get("score", 0)
    p = pillar_scores.get("policy", {}).get("score", 0)
    liq = pillar_scores.get("liquidity", {}).get("score", 0)
    c = pillar_scores.get("credit", {}).get("score", 0)

    # Goldilocks: growth stable+, inflation falling, policy not restrictive, credit fine
    if g >= 0 and i >= 0 and p >= 0 and c >= 0:
        return "Goldilocks"
    # Recession / Stress
    if g <= -1 and l <= -1 and c <= -1:
        return "Recession / Stress"
    # Stagflation Risk
    if g <= -1 and i <= -1 and p <= -1:
        return "Stagflation Risk"
    # Late-Cycle Tightening
    if g <= 0 and i <= 0 and p <= -1 and liq <= 0:
        return "Late-Cycle Tightening"
    # Disinflationary Slowdown
    if g <= -1 and i >= 0 and l <= 0:
        return "Disinflationary Slowdown"
    # Reflation
    if g >= 1 and i <= -1:
        return "Reflation"
    return "Mixed / Transitional"


def classify_trend(composite: float) -> str:
    if composite > 5:
        return "Improving"
    elif composite < -5:
        return "Deteriorating"
    return "Stable"


def classify_confidence(pillar_scores: dict) -> str:
    scores = [ps["score"] for ps in pillar_scores.values()]
    populated = sum(1 for ps in pillar_scores.values() if ps.get("drivers"))
    populated_ratio = populated / len(pillar_scores) if pillar_scores else 0

    # Agreement: how aligned are the signs?
    positive = sum(1 for s in scores if s > 0)
    negative = sum(1 for s in scores if s < 0)
    agreement = max(positive, negative) / len(scores) if scores else 0

    points = 0
    if populated_ratio >= 0.75:
        points += 1
    if agreement >= 0.6:
        points += 1
    if all(abs(s) >= 0.5 for s in scores):
        points += 1

    if points >= 3:
        return "High"
    elif points >= 2:
        return "Moderate"
    return "Low"


# ---------------------------------------------------------------------------
# Risk Dashboard
# ---------------------------------------------------------------------------

def compute_risks(pillar_scores: dict, series_data: dict) -> list[dict]:
    risks = []

    # Sticky inflation
    inf_score = pillar_scores.get("inflation", {}).get("score", 0)
    if inf_score <= -0.5:
        risks.append({
            "risk": "Sticky inflation",
            "severity": "High" if inf_score <= -1 else "Medium",
            "explanation": "Inflation remains above target, constraining policy flexibility",
            "linked_series": ["CPIAUCSL", "CPILFESL", "PCEPILFE"],
        })

    # Recession risk
    growth_score = pillar_scores.get("growth", {}).get("score", 0)
    labor_score = pillar_scores.get("labor", {}).get("score", 0)
    if growth_score <= -1 or (growth_score <= 0 and labor_score <= -0.5):
        risks.append({
            "risk": "Recession risk",
            "severity": "High" if growth_score <= -1 and labor_score <= -0.5 else "Medium",
            "explanation": "Growth is weakening with labor market showing signs of stress",
            "linked_series": ["GDPC1", "INDPRO", "UNRATE", "ICSA"],
        })

    # Liquidity drain
    liq_score = pillar_scores.get("liquidity", {}).get("score", 0)
    if liq_score <= -0.5:
        risks.append({
            "risk": "Liquidity drain",
            "severity": "High" if liq_score <= -1 else "Medium",
            "explanation": "Quantitative tightening and dollar strength are draining liquidity",
            "linked_series": ["WALCL", "M2SL", "DTWEXBGS"],
        })

    # Credit spread widening
    credit_score = pillar_scores.get("credit", {}).get("score", 0)
    if credit_score <= -0.5:
        risks.append({
            "risk": "Credit stress",
            "severity": "High" if credit_score <= -1 else "Medium",
            "explanation": "Credit spreads widening and lending standards tightening",
            "linked_series": ["BAA10Y", "DRTSCILM"],
        })

    # Policy error
    policy_score = pillar_scores.get("policy", {}).get("score", 0)
    if policy_score <= -1 and growth_score <= 0:
        risks.append({
            "risk": "Policy error risk",
            "severity": "Medium",
            "explanation": "Restrictive policy stance risks overtightening into a slowdown",
            "linked_series": ["FEDFUNDS", "T10Y2Y"],
        })

    # Fiscal pressure
    fiscal_score = pillar_scores.get("fiscal", {}).get("score", 0)
    if fiscal_score <= -0.5:
        risks.append({
            "risk": "Fiscal pressure",
            "severity": "Medium",
            "explanation": "Rising interest costs and deficit spending pressure Treasury markets",
            "linked_series": [],
        })

    # Global slowdown
    global_score = pillar_scores.get("global", {}).get("score", 0)
    if global_score <= -0.5:
        risks.append({
            "risk": "Global slowdown",
            "severity": "High" if global_score <= -1 else "Medium",
            "explanation": "International growth is decelerating, weighing on exports and sentiment",
            "linked_series": ["DEXUSEU", "DCOILWTICO", "VIXCLS"],
        })

    if not risks:
        risks.append({
            "risk": "No major risks flagged",
            "severity": "Low",
            "explanation": "Macro environment is broadly supportive",
            "linked_series": [],
        })

    return risks


# ---------------------------------------------------------------------------
# Market Implications
# ---------------------------------------------------------------------------

def compute_implications(regime: str, pillar_scores: dict, composite: float) -> dict:
    g = pillar_scores.get("growth", {}).get("score", 0)
    i = pillar_scores.get("inflation", {}).get("score", 0)
    p = pillar_scores.get("policy", {}).get("score", 0)
    liq = pillar_scores.get("liquidity", {}).get("score", 0)

    implications = {}

    # Equities
    if composite > 10:
        implications["equities"] = "Favorable — growth supportive, policy accommodative"
    elif composite > -5:
        implications["equities"] = "Mixed — constrained by policy but growth still intact"
    else:
        implications["equities"] = "Cautious — deteriorating macro backdrop suggests defensive positioning"

    # Bonds
    if i >= 0 and p <= -1:
        implications["bonds"] = "Duration attractive — disinflation + restrictive policy = eventual easing"
    elif i <= -1:
        implications["bonds"] = "Front-end vulnerable — sticky inflation keeps rates elevated"
    else:
        implications["bonds"] = "Neutral — rates likely range-bound near term"

    # Dollar
    if p <= -1 and liq <= 0:
        implications["dollar"] = "Supported by relative policy tightness and liquidity squeeze"
    elif p >= 0:
        implications["dollar"] = "Likely to weaken as policy stance eases"
    else:
        implications["dollar"] = "Range-bound, driven by relative rate differentials"

    # Commodities
    if g >= 0 and i <= -1:
        implications["commodities"] = "Firm demand + inflation concerns support select commodities"
    elif g <= -1:
        implications["commodities"] = "Weak demand outlook pressures cyclical commodities"
    else:
        implications["commodities"] = "Mixed — supply constraints vs demand uncertainty"

    # Crypto
    if liq >= 0 and p >= 0:
        implications["crypto"] = "Favorable liquidity conditions support risk-on digital assets"
    elif liq <= -1:
        implications["crypto"] = "Tight liquidity and strong dollar create headwinds"
    else:
        implications["crypto"] = "Sensitive to liquidity and dollar direction"

    return implications


# ---------------------------------------------------------------------------
# Narrative Engine (deterministic templates)
# ---------------------------------------------------------------------------

def generate_narrative(pillar_scores: dict, regime: str, composite: float) -> dict:
    improving = []
    deteriorating = []

    for pillar, data in pillar_scores.items():
        name = pillar.replace("_", " ").title()
        if data["trend"] == "Improving":
            improving.append(f"{name}: {data['interpretation']}")
        elif data["trend"] == "Deteriorating":
            deteriorating.append(f"{name}: {data['interpretation']}")

    if not improving:
        improving.append("No macro pillars currently improving")
    if not deteriorating:
        deteriorating.append("No significant deterioration across pillars")

    return {"improving": improving, "deteriorating": deteriorating}


def generate_summary_bullets(pillar_scores: dict, regime: str) -> list[str]:
    bullets = []

    g = pillar_scores.get("growth", {})
    i = pillar_scores.get("inflation", {})
    l = pillar_scores.get("labor", {})
    p = pillar_scores.get("policy", {})
    liq = pillar_scores.get("liquidity", {})

    if g["score"] > 0:
        bullets.append("Growth is positive but watch for deceleration signals")
    elif g["score"] > -1:
        bullets.append("Growth is slowing but not yet collapsing")
    else:
        bullets.append("Growth is contracting — recession indicators flashing")

    if i["score"] >= 0:
        bullets.append("Inflation is trending toward target — constructive")
    else:
        bullets.append("Inflation remains sticky and above target")

    if p["score"] <= -1:
        bullets.append("Policy remains restrictive — headwind for risk assets")
    elif p["score"] >= 0:
        bullets.append("Policy is accommodative or turning less restrictive")

    if liq["score"] <= -0.5:
        bullets.append("Liquidity is tight — constraining asset valuations")
    elif liq["score"] >= 0.5:
        bullets.append("Liquidity conditions are improving")

    regime_desc = {
        "Goldilocks": "Macro regime suggests balanced growth — favorable for equities",
        "Late-Cycle Tightening": "Macro regime suggests late-cycle conditions — selective positioning warranted",
        "Disinflationary Slowdown": "Macro regime suggests disinflationary slowdown — bonds may outperform",
        "Reflation": "Macro regime suggests reflation — commodities and value may benefit",
        "Stagflation Risk": "Macro regime suggests stagflation risk — cash and real assets preferred",
        "Recession / Stress": "Macro regime suggests recession risk — defensive positioning critical",
        "Mixed / Transitional": "Macro regime is transitional — signals are mixed",
    }
    bullets.append(regime_desc.get(regime, "Regime is unclear"))

    return bullets


# ---------------------------------------------------------------------------
# Static Catalysts (hardcoded schedule — replace with API later)
# ---------------------------------------------------------------------------

def get_upcoming_catalysts() -> list[dict]:
    """Return upcoming macro events. Hardcoded for Phase 1."""
    today = date.today()
    catalysts = [
        {"event": "CPI", "event_key": "cpi", "importance": "high", "region": "US"},
        {"event": "Core PCE", "event_key": "core_pce", "importance": "high", "region": "US"},
        {"event": "Nonfarm Payrolls", "event_key": "nfp", "importance": "high", "region": "US"},
        {"event": "FOMC Decision", "event_key": "fomc", "importance": "high", "region": "US"},
        {"event": "GDP (Advance)", "event_key": "gdp", "importance": "high", "region": "US"},
        {"event": "Initial Claims", "event_key": "claims", "importance": "medium", "region": "US"},
        {"event": "Retail Sales", "event_key": "retail", "importance": "medium", "region": "US"},
        {"event": "ISM Manufacturing", "event_key": "ism_mfg", "importance": "medium", "region": "US"},
        {"event": "Consumer Sentiment", "event_key": "umich", "importance": "medium", "region": "US"},
        {"event": "Treasury Refunding", "event_key": "refunding", "importance": "medium", "region": "US"},
    ]
    return catalysts


# ---------------------------------------------------------------------------
# Global Context (Phase 1 — simplified)
# ---------------------------------------------------------------------------

def get_global_context(pillar_scores: dict) -> dict:
    global_score = pillar_scores.get("global", {}).get("score", 0)
    return {
        "world_growth_trend": "Improving" if global_score > 0.5 else ("Slowing" if global_score < -0.5 else "Stable"),
        "forecast_revision_direction": "Mixed",
        "regions": [
            {"region": "Euro Area", "signal": "Weak growth, easing bias" if global_score <= 0 else "Stabilizing with fiscal support"},
            {"region": "China", "signal": "Uneven stabilization amid structural headwinds"},
            {"region": "Emerging Markets", "signal": "Sensitive to dollar and commodity dynamics"},
        ],
    }


# ---------------------------------------------------------------------------
# Full Snapshot Builder
# ---------------------------------------------------------------------------

def build_macro_snapshot(series_data: dict) -> dict:
    """
    Main entry point. Takes raw FRED series data and returns
    the complete macro snapshot: regime, pillars, risks, implications,
    narrative, catalysts, global context.
    """
    pillars = compute_pillar_scores(series_data)
    composite = compute_composite(pillars)
    regime = classify_regime(pillars)
    trend = classify_trend(composite)
    confidence = classify_confidence(pillars)
    risks = compute_risks(pillars, series_data)
    implications = compute_implications(regime, pillars, composite)
    narrative = generate_narrative(pillars, regime, composite)
    bullets = generate_summary_bullets(pillars, regime)
    catalysts = get_upcoming_catalysts()
    global_ctx = get_global_context(pillars)

    return {
        "as_of": date.today().isoformat(),
        "macro_snapshot": {
            "regime": regime,
            "composite_score": composite,
            "trend": trend,
            "confidence": confidence,
            "summary_bullets": bullets,
            "recent_change_summary": _recent_change_summary(pillars),
        },
        "pillars": pillars,
        "risk_dashboard": risks,
        "market_implications": implications,
        "narrative": narrative,
        "catalysts": catalysts,
        "global_context": global_ctx,
    }


def _recent_change_summary(pillars: dict) -> str:
    improving = [p for p, d in pillars.items() if d["trend"] == "Improving"]
    deteriorating = [p for p, d in pillars.items() if d["trend"] == "Deteriorating"]
    parts = []
    if improving:
        parts.append(f"{', '.join(p.title() for p in improving)} improving")
    if deteriorating:
        parts.append(f"{', '.join(p.title() for p in deteriorating)} weakening")
    return " while ".join(parts) if parts else "No significant recent changes"
