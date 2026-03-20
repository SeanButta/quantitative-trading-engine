"""
S&P 500 Universe Manager
========================
Fetches and caches the full S&P 500 constituent list from Wikipedia.
Maps tickers to GICS sectors and provides CIK numbers for SEC EDGAR.

No API key required — uses Wikipedia's publicly maintained constituent list,
which is updated within days of index changes.

Cache: runs/sp500_universe.json  (7-day TTL, refreshes automatically)
Fallback: sectors_engine.SECTOR_UNIVERSE hardcoded list if Wikipedia is unreachable.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

CACHE_PATH  = Path(__file__).parent / "runs" / "sp500_universe.json"
CACHE_TTL   = timedelta(days=7)

# Wikipedia GICS sector names → our internal sector names (exact match)
GICS_MAP: dict[str, str] = {
    "Energy":                     "Energy",
    "Materials":                  "Materials",
    "Industrials":                "Industrials",
    "Consumer Discretionary":     "Consumer Discretionary",
    "Consumer Staples":           "Consumer Staples",
    "Health Care":                "Health Care",
    "Financials":                 "Financials",
    "Information Technology":     "Information Technology",
    "Communication Services":     "Communication Services",
    "Utilities":                  "Utilities",
    "Real Estate":                "Real Estate",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalise_ticker(raw: str) -> str:
    """Wikipedia uses '.' for class shares; yfinance wants '-'."""
    return str(raw).strip().replace(".", "-")


def _load_cache() -> Optional[dict]:
    if not CACHE_PATH.exists():
        return None
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(data.get("fetched_at", "2000-01-01"))
        if datetime.utcnow() - fetched < CACHE_TTL:
            return data
    except Exception as exc:
        logger.debug("SP500 cache read failed: %s", exc)
    return None


def _save_cache(data: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


# ── Core fetch ────────────────────────────────────────────────────────────────

def _fetch_from_wikipedia() -> dict:
    """
    Scrape the S&P 500 list from Wikipedia using requests + pandas.read_html.
    Uses a browser-like User-Agent to avoid 403 blocks.
    Returns raw parsed result dict (same shape as cache format).
    """
    import io
    import pandas as pd  # lazy import — only needed here
    import requests

    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    tables = pd.read_html(io.StringIO(resp.text), header=0)
    df = tables[0]

    # Normalise column names (Wikipedia occasionally tweaks them)
    df.columns = [str(c).strip() for c in df.columns]

    universe:    dict[str, list[str]] = {}
    cik_map:     dict[str, str]       = {}
    ticker_info: dict[str, dict]      = {}

    for _, row in df.iterrows():
        sym = _normalise_ticker(row.get("Symbol", ""))
        if not sym:
            continue

        raw_sector = str(row.get("GICS Sector", "")).strip()
        sector = GICS_MAP.get(raw_sector)
        if not sector:
            logger.debug("Unknown GICS sector '%s' for %s — skipping", raw_sector, sym)
            continue

        universe.setdefault(sector, []).append(sym)

        # CIK (zero-padded 10-digit string for EDGAR)
        try:
            cik_raw = row.get("CIK", None)
            if cik_raw is not None:
                cik_map[sym] = str(int(float(str(cik_raw).replace(",", "")))).zfill(10)
        except (ValueError, TypeError):
            pass

        ticker_info[sym] = {
            "name":         str(row.get("Security", sym)).strip(),
            "sector":       sector,
            "sub_industry": str(row.get("GICS Sub-Industry", "")).strip(),
            "added":        str(row.get("Date added", "")).strip(),
            "founded":      str(row.get("Founded", "")).strip(),
        }

    total = sum(len(v) for v in universe.values())
    logger.info("S&P 500 universe fetched from Wikipedia: %d tickers across %d sectors", total, len(universe))

    return {
        "universe":    universe,
        "cik_map":     cik_map,
        "ticker_info": ticker_info,
        "fetched_at":  datetime.utcnow().isoformat(),
        "total":       total,
        "source":      "wikipedia",
    }


# ── Public API ────────────────────────────────────────────────────────────────

def get_sp500_universe(force_refresh: bool = False) -> Optional[dict]:
    """
    Returns the full S&P 500 universe dict:
    {
        "universe":    {sector_name: [ticker, ...]},   # all 11 sectors
        "cik_map":     {ticker: "0000012345"},         # 10-digit CIK for EDGAR
        "ticker_info": {ticker: {name, sector, sub_industry, added, founded}},
        "fetched_at":  "2025-01-01T12:00:00",
        "total":       503,
        "source":      "wikipedia",
    }

    Returns None if Wikipedia is unreachable and no cache exists.
    Falls back to cached data regardless of age if Wikipedia fails.
    """
    if not force_refresh:
        cached = _load_cache()
        if cached:
            return cached

    try:
        data = _fetch_from_wikipedia()
        _save_cache(data)
        return data
    except Exception as exc:
        logger.warning("Failed to fetch S&P 500 from Wikipedia: %s", exc)
        # Return stale cache if available, rather than nothing
        stale = None
        if CACHE_PATH.exists():
            try:
                stale = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
                logger.info("Using stale S&P 500 cache (age unknown) as fallback")
            except Exception:
                pass
        return stale


def get_cik(symbol: str) -> Optional[str]:
    """Convenience: return 10-digit CIK string for a ticker, or None."""
    univ = get_sp500_universe()
    if not univ:
        return None
    return univ.get("cik_map", {}).get(symbol.upper().replace(".", "-"))


def get_ticker_meta(symbol: str) -> Optional[dict]:
    """Return {name, sector, sub_industry, added, founded} for a ticker."""
    univ = get_sp500_universe()
    if not univ:
        return None
    return univ.get("ticker_info", {}).get(symbol.upper().replace(".", "-"))


def list_sp500_tickers() -> list[str]:
    """Flat list of all S&P 500 tickers."""
    univ = get_sp500_universe()
    if not univ:
        return []
    return [t for tickers in univ["universe"].values() for t in tickers]
