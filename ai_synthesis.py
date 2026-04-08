"""
AI Synthesis Engine
===================
Uses Claude API to generate institutional-grade narrative summaries
from structured quantitative data.

Cost: ~$0.014 per call (Claude 3.5 Sonnet)
      ~$0.001 per call (Claude 3.5 Haiku — for simple summaries)

Environment:
    ANTHROPIC_API_KEY=sk-ant-...
    AI_MODEL=claude-sonnet-4-20250514  (default)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
DEFAULT_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")


def synthesize_daily_brief(brief_data: dict, model: str = None) -> Optional[dict]:
    """
    Generate an institutional morning note narrative from structured brief data.

    Input: the full daily-brief JSON (market summary, indices, sectors, alerts, etc.)
    Output: {narrative: str, key_takeaways: [str], risk_flags: [str], model: str, tokens_used: int, cost_usd: float}
    """
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — AI synthesis disabled")
        return None

    model = model or DEFAULT_MODEL

    # Build the prompt from structured data
    prompt = _build_brief_prompt(brief_data)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        response = client.messages.create(
            model=model,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
            system=(
                "You are a senior equity strategist writing a concise morning note for institutional investors. "
                "Write in a direct, professional tone. No fluff. Focus on actionable insights. "
                "Use specific numbers and tickers. 3-4 paragraphs max. "
                "End with 1-2 key risk flags if applicable."
            ),
        )

        narrative = response.content[0].text
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        # Cost calculation (Claude 3.5 Sonnet pricing)
        cost_per_input = 3.00 / 1_000_000   # $3/M input tokens
        cost_per_output = 15.00 / 1_000_000  # $15/M output tokens
        if "haiku" in model.lower():
            cost_per_input = 0.25 / 1_000_000
            cost_per_output = 1.25 / 1_000_000

        cost = input_tokens * cost_per_input + output_tokens * cost_per_output

        # Extract key takeaways and risks from the narrative
        lines = narrative.split("\n")
        takeaways = [l.strip("- •").strip() for l in lines if l.strip().startswith(("-", "•", "→"))]
        risks = [l.strip("- •⚠").strip() for l in lines if any(kw in l.lower() for kw in ["risk", "caution", "watch", "warning", "concern"])]

        logger.info("AI synthesis complete: %d input, %d output tokens, $%.4f",
                     input_tokens, output_tokens, cost)

        return {
            "narrative": narrative,
            "key_takeaways": takeaways[:5],
            "risk_flags": risks[:3],
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "cost_usd": round(cost, 5),
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error("AI synthesis failed: %s", e)
        return {"narrative": None, "error": str(e)}


def synthesize_ticker_thesis(ticker_data: dict, model: str = None) -> Optional[dict]:
    """
    Generate a concise investment thesis for a single ticker
    from its fundamentals, technicals, and valuation data.
    """
    if not ANTHROPIC_API_KEY:
        return None

    model = model or DEFAULT_MODEL
    prompt = _build_ticker_prompt(ticker_data)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        response = client.messages.create(
            model=model,
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
            system=(
                "You are an equity research analyst writing a brief investment thesis. "
                "Be concise and data-driven. Include: bull case, bear case, and key catalyst. "
                "2-3 paragraphs max. Use specific numbers."
            ),
        )

        narrative = response.content[0].text
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost_per_input = 3.00 / 1_000_000
        cost_per_output = 15.00 / 1_000_000
        if "haiku" in model.lower():
            cost_per_input = 0.25 / 1_000_000
            cost_per_output = 1.25 / 1_000_000
        cost = input_tokens * cost_per_input + output_tokens * cost_per_output

        return {
            "thesis": narrative,
            "model": model,
            "tokens_used": input_tokens + output_tokens,
            "cost_usd": round(cost, 5),
        }

    except Exception as e:
        logger.error("AI ticker thesis failed: %s", e)
        return {"thesis": None, "error": str(e)}


def _build_brief_prompt(data: dict) -> str:
    """Build a structured prompt from daily brief data."""
    parts = [f"Date: {data.get('date', 'today')}"]

    # Market environment
    if data.get("market_summary"):
        parts.append("Market Environment:")
        for s in data["market_summary"]:
            parts.append(f"  - {s}")

    # Index performance
    if data.get("index_performance"):
        parts.append("Index Performance:")
        for idx in data["index_performance"]:
            chg = idx.get("change")
            parts.append(f"  - {idx['symbol']}: ${idx.get('price','?')} ({'+' if chg and chg>=0 else ''}{chg:.1f}%)" if chg is not None else f"  - {idx['symbol']}")

    # Sector leaders/laggards
    if data.get("sector_leaders"):
        parts.append("Sector Leaders: " + ", ".join(f"{s['symbol']} ({s.get('change',0):+.1f}%)" for s in data["sector_leaders"]))
    if data.get("sector_laggards"):
        parts.append("Sector Laggards: " + ", ".join(f"{s['symbol']} ({s.get('change',0):+.1f}%)" for s in data["sector_laggards"]))

    # Positioning
    if data.get("positioning"):
        p = data["positioning"]
        parts.append(f"Positioning: {p.get('posture','?')} — {p.get('suggestion','')}")
        if p.get("overweight"):
            parts.append(f"  Overweight: {', '.join(p['overweight'])}")
        if p.get("underweight"):
            parts.append(f"  Underweight: {', '.join(p['underweight'])}")

    # Watchlist movers
    if data.get("watchlist_movers"):
        parts.append("Watchlist Movers:")
        for m in data["watchlist_movers"][:5]:
            parts.append(f"  - {m['symbol']}: {m.get('change',0):+.1f}% (${m.get('price','?')})")

    # Alerts
    if data.get("alerts"):
        parts.append("Alerts:")
        for a in data["alerts"][:5]:
            parts.append(f"  - [{a.get('severity','info')}] {a['message']}")

    # Earnings
    if data.get("earnings_upcoming"):
        parts.append("Upcoming Earnings:")
        for e in data["earnings_upcoming"][:5]:
            parts.append(f"  - {e['symbol']} {e.get('label','')} (streak: {e.get('streak',0)})")

    # Alpha picks
    if data.get("alpha_top_picks"):
        parts.append("Alpha Top Picks:")
        for o in data["alpha_top_picks"]:
            parts.append(f"  - {o['symbol']}: score {o.get('score',0):+.2f}, {o.get('type','')}, {o.get('bias','')}")

    parts.append("\nWrite a concise institutional morning note synthesizing the above data.")
    return "\n".join(parts)


def _build_ticker_prompt(data: dict) -> str:
    """Build a structured prompt from ticker analysis data."""
    parts = [f"Ticker: {data.get('symbol', '?')}"]

    f = data.get("fundamentals", {})
    if f:
        parts.append(f"Company: {f.get('company_name', '?')} — {f.get('sector', '?')} / {f.get('industry', '?')}")
        parts.append(f"Price: ${f.get('price') or '?'} | Mkt Cap: {f.get('market_cap', '?')}")
        parts.append(f"P/E: {f.get('pe_ratio', '?')} | Fwd P/E: {f.get('forward_pe', '?')} | P/B: {f.get('pb_ratio', '?')}")
        parts.append(f"ROE: {f.get('roe', '?')}% | Net Margin: {f.get('net_margin', '?')}% | Rev Growth: {f.get('revenue_growth', '?')}%")
        if f.get("dcf_value"):
            parts.append(f"DCF Fair Value: ${f['dcf_value']} ({f.get('dcf_upside', '?')}% upside)")
        if f.get("graham_number"):
            parts.append(f"Graham Number: ${f['graham_number']}")
        if f.get("analyst_target_mean"):
            parts.append(f"Analyst Target: ${f['analyst_target_mean']} ({f.get('target_upside', '?')}% upside)")

    t = data.get("technical", {})
    if t:
        parts.append(f"RSI: {t.get('rsi', '?')} | Above MA50: {t.get('above_ma50', '?')} | Bias: {t.get('ta_bias', '?')}")

    s = data.get("sentiment", {})
    if s:
        parts.append(f"Sentiment: {s.get('direction', '?')} (score: {s.get('score', '?')}, {s.get('articles', '?')} articles)")

    parts.append("\nWrite a concise 2-3 paragraph investment thesis for this ticker.")
    return "\n".join(parts)
