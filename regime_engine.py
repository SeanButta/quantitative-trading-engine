"""
Unified Regime Engine
=====================
Shared regime vocabulary across Markets, Macro, and Sectors tabs.
Each tab keeps its own scoring logic but maps into a common framework.

Shared regime labels: Risk-On, Constructive, Neutral, Cautious, Risk-Off, Transitional
Cross-tab alignment: Aligned, Partially Aligned, Diverging, Conflicted
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared Regime Vocabulary
# ---------------------------------------------------------------------------

REGIME_RANK = {
    "Risk-Off": -2,
    "Cautious": -1,
    "Neutral": 0,
    "Constructive": 1,
    "Risk-On": 2,
    "Transitional": 999,
}

REGIME_ORDER = ["Risk-Off", "Cautious", "Neutral", "Constructive", "Risk-On"]


# ---------------------------------------------------------------------------
# Tab Regime Mapping Functions
# ---------------------------------------------------------------------------

def map_markets_regime(raw_score: float) -> str:
    """Map Markets composite score (roughly -1 to +1) to shared regime."""
    if raw_score >= 0.5:
        return "Risk-On"
    elif raw_score >= 0.2:
        return "Constructive"
    elif raw_score > -0.2:
        return "Neutral"
    elif raw_score > -0.5:
        return "Cautious"
    return "Risk-Off"


def map_macro_regime(raw_score: float, tab_regime: str = "") -> str:
    """Map Macro composite score (-50 to +50) to shared regime."""
    if tab_regime == "Mixed / Transitional":
        return "Transitional"
    if raw_score >= 20:
        return "Risk-On"
    elif raw_score >= 8:
        return "Constructive"
    elif raw_score > -8:
        return "Neutral"
    elif raw_score > -20:
        return "Cautious"
    return "Risk-Off"


def map_sectors_regime(
    rotation_regime: str,
    avg_sector_score: float,
    breadth_ratio: float = 0.5,
) -> str:
    """
    Map Sectors rotation/leadership into shared regime.

    rotation_regime: Cyclical Leadership / Defensive Rotation / Growth Leadership /
                     Broad Participation / Mixed Rotation
    avg_sector_score: average 1D change across sectors
    breadth_ratio: fraction of sectors advancing (0-1)
    """
    breadth_weak = breadth_ratio < 0.4

    if rotation_regime == "Broad Participation" and avg_sector_score > 0.4:
        return "Risk-On"
    if rotation_regime == "Cyclical Leadership" and avg_sector_score > 0.15:
        return "Constructive"
    if rotation_regime == "Growth Leadership" and breadth_weak:
        return "Neutral"
    if rotation_regime == "Defensive Rotation":
        return "Cautious"
    if avg_sector_score < -0.35:
        return "Risk-Off"
    if rotation_regime == "Mixed Rotation":
        return "Transitional"
    return "Neutral"


# ---------------------------------------------------------------------------
# Markets Descriptors
# ---------------------------------------------------------------------------

def get_markets_descriptors(scores: dict, mkt_data: dict = None) -> list[str]:
    descs = []
    if scores.get("equities", 0) >= 0.5:
        descs.append("Broad Participation")
    elif scores.get("equities", 0) <= -0.5:
        descs.append("Narrow Leadership")

    if scores.get("volatility", 0) <= -0.5:
        descs.append("Volatility Elevated")

    if scores.get("credit", 0) >= 0.3:
        descs.append("Credit Stable")
    elif scores.get("credit", 0) <= -0.3:
        descs.append("Credit Stress Building")

    vol_score = scores.get("volatility", 0)
    if vol_score >= 0.5:
        descs.append("Sentiment Risk-On")
    elif vol_score <= -0.5:
        pass  # already covered by Volatility Elevated
    else:
        descs.append("Sentiment Neutral")

    return descs


# ---------------------------------------------------------------------------
# Macro Descriptors
# ---------------------------------------------------------------------------

def get_macro_descriptors(tab_regime: str, pillar_scores: dict = None) -> list[str]:
    descs = []
    if tab_regime and tab_regime != "Mixed / Transitional":
        descs.append(tab_regime)

    if pillar_scores:
        policy = pillar_scores.get("policy", {}).get("score", 0)
        liquidity = pillar_scores.get("liquidity", {}).get("score", 0)
        if policy <= -1:
            descs.append("Policy Restrictive")
        if liquidity <= -0.5:
            descs.append("Liquidity Tight")

    return descs


# ---------------------------------------------------------------------------
# Sectors Descriptors
# ---------------------------------------------------------------------------

def get_sectors_descriptors(
    rotation_regime: str,
    breadth_ratio: float,
    prev_breadth_ratio: float = None,
) -> list[str]:
    descs = []
    if rotation_regime:
        descs.append(rotation_regime)

    if breadth_ratio >= 0.7:
        descs.append("Breadth Improving")
    elif breadth_ratio <= 0.35:
        descs.append("Breadth Weakening")

    return descs


# ---------------------------------------------------------------------------
# Sector Rotation Classification
# ---------------------------------------------------------------------------

CYCLICAL_SECTORS = {"Energy", "Materials", "Industrials", "Financials", "Consumer Discretionary"}
DEFENSIVE_SECTORS = {"Utilities", "Consumer Staples", "Health Care", "Real Estate"}
GROWTH_SECTORS = {"Information Technology", "Communication Services"}


def classify_sector_rotation(sector_data: list[dict]) -> str:
    """
    Classify sector leadership pattern from sector performance data.
    Each entry: {sector, avg_change_1d or etf_change_1d, ...}
    """
    if not sector_data:
        return "Mixed Rotation"

    cyc_avg = []
    def_avg = []
    growth_avg = []

    for s in sector_data:
        name = s.get("sector", "")
        chg = s.get("avg_change_1d") or s.get("etf_change_1d") or 0

        if name in CYCLICAL_SECTORS:
            cyc_avg.append(chg)
        elif name in DEFENSIVE_SECTORS:
            def_avg.append(chg)
        elif name in GROWTH_SECTORS:
            growth_avg.append(chg)

    cyc = sum(cyc_avg) / len(cyc_avg) if cyc_avg else 0
    defe = sum(def_avg) / len(def_avg) if def_avg else 0
    gro = sum(growth_avg) / len(growth_avg) if growth_avg else 0

    # All positive with similar strength
    all_chgs = [s.get("avg_change_1d") or s.get("etf_change_1d") or 0 for s in sector_data]
    advancing = sum(1 for c in all_chgs if c > 0) / max(len(all_chgs), 1)

    if advancing >= 0.8 and cyc > 0 and defe > 0 and gro > 0:
        return "Broad Participation"

    # Cyclical leadership
    if cyc > defe + 0.15 and cyc > gro + 0.1 and cyc > 0:
        return "Cyclical Leadership"

    # Defensive rotation
    if defe > cyc + 0.15 and defe > gro + 0.1:
        return "Defensive Rotation"

    # Growth leadership
    if gro > cyc + 0.15 and gro > defe + 0.1 and gro > 0:
        return "Growth Leadership"

    return "Mixed Rotation"


# ---------------------------------------------------------------------------
# Cross-Tab Alignment Engine
# ---------------------------------------------------------------------------

def classify_alignment(tab_outputs: list[dict]) -> dict:
    """
    Compare mapped regimes across tabs and determine alignment.

    Each tab_output: {tab, mapped_regime, raw_score, ...}
    Returns: {overall_alignment, dominant_regime, outlier_tabs, explanation}
    """
    mapped = [t.get("mapped_regime", "Neutral") for t in tab_outputs]
    tabs = [t.get("tab", "") for t in tab_outputs]

    # Handle Transitional
    non_transitional = [(t, m) for t, m in zip(tabs, mapped) if m != "Transitional"]

    if len(non_transitional) < 2:
        return {
            "overall_alignment": "Conflicted",
            "dominant_regime": "Neutral",
            "outlier_tabs": tabs,
            "explanation": "Multiple lenses are transitional or mixed.",
        }

    ranks = [REGIME_RANK.get(m, 0) for _, m in non_transitional]
    avg_rank = sum(ranks) / len(ranks)

    # Determine dominant regime from average
    if avg_rank >= 1.5:
        dominant = "Risk-On"
    elif avg_rank >= 0.5:
        dominant = "Constructive"
    elif avg_rank > -0.5:
        dominant = "Neutral"
    elif avg_rank > -1.5:
        dominant = "Cautious"
    else:
        dominant = "Risk-Off"

    min_rank = min(ranks)
    max_rank = max(ranks)
    spread = max_rank - min_rank

    # Find outliers
    dominant_rank = REGIME_RANK.get(dominant, 0)
    outliers = [t for t, m in zip(tabs, mapped) if m != "Transitional" and abs(REGIME_RANK.get(m, 0) - dominant_rank) >= 2]

    if spread == 0:
        return {
            "overall_alignment": "Aligned",
            "dominant_regime": dominant,
            "outlier_tabs": [],
            "explanation": "Macro, markets, and sectors are aligned on the same regime.",
        }

    if spread == 1:
        return {
            "overall_alignment": "Partially Aligned",
            "dominant_regime": dominant,
            "outlier_tabs": [],
            "explanation": "Tabs are broadly aligned with mild differences in tone.",
        }

    if spread >= 2 and len(outliers) == 1:
        return {
            "overall_alignment": "Diverging",
            "dominant_regime": dominant,
            "outlier_tabs": outliers,
            "explanation": f"{outliers[0].title()} materially diverges from the broader system.",
        }

    return {
        "overall_alignment": "Conflicted",
        "dominant_regime": dominant,
        "outlier_tabs": [t for t, _ in non_transitional],
        "explanation": "Macro, markets, and sectors are not confirming the same regime.",
    }


# ---------------------------------------------------------------------------
# Cross-Tab Narrative Generation
# ---------------------------------------------------------------------------

def generate_alignment_narrative(alignment: dict, tab_outputs: list[dict]) -> dict:
    """Generate headline + bullets from cross-tab alignment."""
    status = alignment["overall_alignment"]
    dominant = alignment["dominant_regime"]
    outliers = alignment.get("outlier_tabs", [])

    templates = {
        "Aligned": f"Macro, markets, and sectors are broadly aligned around a {dominant.lower()} backdrop.",
        "Partially Aligned": f"The system leans {dominant.lower()}, though one or more lenses remain less convinced.",
        "Diverging": f"Markets and sectors are pricing a different tone than the macro backdrop currently implies.",
        "Conflicted": "The system is mixed, with macro, market pricing, and sector leadership not yet confirming one another.",
    }

    headline = templates.get(status, "Regime assessment is unclear.")

    bullets = []
    for t in tab_outputs:
        tab = t.get("tab", "")
        regime = t.get("mapped_regime", "Neutral")
        descs = t.get("descriptors", [])
        if descs:
            bullets.append(f"{tab.title()}: {regime} ({', '.join(descs[:2])})")
        else:
            bullets.append(f"{tab.title()}: {regime}")

    if outliers:
        bullets.append(f"Watch {', '.join(o.title() for o in outliers)} for confirmation or further divergence.")

    return {"headline": headline, "bullets": bullets}


# ---------------------------------------------------------------------------
# Full Unified Dashboard Builder
# ---------------------------------------------------------------------------

def build_unified_regime(
    markets_scores: Optional[dict] = None,
    macro_snapshot: Optional[dict] = None,
    sector_data: Optional[list[dict]] = None,
) -> dict:
    """
    Build the unified regime dashboard from all three tab outputs.
    Any tab can be None if data is unavailable.
    """
    from datetime import date

    tab_outputs = []

    # Markets
    if markets_scores:
        raw = markets_scores.get("composite", 0)
        mapped = map_markets_regime(raw)
        descs = get_markets_descriptors(markets_scores)
        tab_outputs.append({
            "tab": "markets",
            "raw_score": raw,
            "tab_specific_regime": markets_scores.get("regime", "Neutral"),
            "mapped_regime": mapped,
            "descriptors": descs,
            "trend": "Stable",
            "confidence": "Moderate",
        })

    # Macro
    if macro_snapshot:
        snap = macro_snapshot.get("macro_snapshot", {})
        raw = snap.get("composite_score", 0)
        tab_regime = snap.get("regime", "")
        mapped = map_macro_regime(raw, tab_regime)
        pillars = macro_snapshot.get("pillars", {})
        descs = get_macro_descriptors(tab_regime, pillars)
        tab_outputs.append({
            "tab": "macro",
            "raw_score": raw,
            "tab_specific_regime": tab_regime,
            "mapped_regime": mapped,
            "descriptors": descs,
            "trend": snap.get("trend", "Stable"),
            "confidence": snap.get("confidence", "Low"),
        })

    # Sectors
    if sector_data:
        rotation = classify_sector_rotation(sector_data)
        all_chgs = [s.get("avg_change_1d") or s.get("etf_change_1d") or 0 for s in sector_data]
        avg_chg = sum(all_chgs) / len(all_chgs) if all_chgs else 0
        breadth = sum(1 for c in all_chgs if c > 0) / max(len(all_chgs), 1)
        mapped = map_sectors_regime(rotation, avg_chg, breadth)
        descs = get_sectors_descriptors(rotation, breadth)
        tab_outputs.append({
            "tab": "sectors",
            "raw_score": round(avg_chg, 3),
            "tab_specific_regime": rotation,
            "mapped_regime": mapped,
            "descriptors": descs,
            "trend": "Improving" if avg_chg > 0.2 else ("Deteriorating" if avg_chg < -0.2 else "Stable"),
            "confidence": "High" if breadth > 0.7 or breadth < 0.3 else "Moderate",
        })

    # Alignment
    alignment = classify_alignment(tab_outputs) if len(tab_outputs) >= 2 else {
        "overall_alignment": "Insufficient Data",
        "dominant_regime": "Neutral",
        "outlier_tabs": [],
        "explanation": "Need at least 2 tabs loaded for alignment.",
    }

    narrative = generate_alignment_narrative(alignment, tab_outputs)

    return {
        "as_of": date.today().isoformat(),
        "tabs": {t["tab"]: t for t in tab_outputs},
        "alignment": alignment,
        "summary": narrative,
    }
