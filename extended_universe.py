"""
Extended Universe Manager
=========================
Provides CIK lookups for *any* SEC-registered public company — Russell 1000,
Russell 2000, and beyond — and exposes named index constituent lists for bulk
operations (options warming, sector refresh, etc.).

Sources
-------
CIK map   : SEC EDGAR ``/files/company_tickers.json``
             Free, no API key, covers ~10 000+ public companies.
             Updated daily by the SEC.  Cache TTL: 1 day.

Russell 1000 : Wikipedia "List of Russell 1000 Index companies"
             ~1 000 large-cap names.  Cache TTL: 7 days.

Russell 2000 : iShares IWM ETF holdings CSV (best-effort)
             ~2 000 small-cap names.  May fail if iShares changes URL.
             Falls back to a cached copy if available.  Cache TTL: 7 days.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_CACHE_DIR  = Path(__file__).parent / "runs"
_EDGAR_PATH = _CACHE_DIR / "edgar_cik_map.json"
_R1000_PATH = _CACHE_DIR / "russell1000.json"
_R2000_PATH = _CACHE_DIR / "russell2000.json"
_FULL_US_PATH = _CACHE_DIR / "full_us_universe.json"

_EDGAR_TTL  = timedelta(days=1)
_INDEX_TTL  = timedelta(days=7)

_EDGAR_URL  = "https://www.sec.gov/files/company_tickers.json"
_R1000_WIKI = "https://en.wikipedia.org/wiki/Russell_1000_Index"
_IWM_CSV    = (
    "https://www.ishares.com/us/products/239710/IWM/"
    "1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund"
)
_IWB_CSV    = (
    "https://www.ishares.com/us/products/239707/IWB/"
    "1467271812596.ajax?fileType=csv&fileName=IWB_holdings&dataType=fund"
)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# ---------------------------------------------------------------------------
# Generic cache helpers
# ---------------------------------------------------------------------------

def _load_json_cache(path: Path, ttl: timedelta) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(data.get("fetched_at", "2000-01-01"))
        if datetime.utcnow() - fetched < ttl:
            return data
    except Exception as exc:
        logger.debug("Cache read failed (%s): %s", path.name, exc)
    return None


def _save_json_cache(path: Path, data: dict) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def _load_stale(path: Path) -> Optional[dict]:
    """Return cached data regardless of age (fallback when remote fails)."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# SEC EDGAR — full public-company CIK map
# ---------------------------------------------------------------------------

def _fetch_edgar_cik_map() -> dict[str, str]:
    """
    Fetch SEC EDGAR's full ticker→CIK mapping.
    Returns {TICKER: "0000012345", ...} for ~10 000+ companies.
    """
    import requests
    headers = dict(_BROWSER_HEADERS)
    headers["User-Agent"] = "quant-research-platform research@example.com"  # SEC requests this
    resp = requests.get(_EDGAR_URL, headers=headers, timeout=20)
    resp.raise_for_status()
    raw: dict = resp.json()  # {"0": {"cik_str":..., "ticker":..., "title":...}, ...}
    cik_map: dict[str, str] = {}
    for entry in raw.values():
        ticker = str(entry.get("ticker", "")).upper().strip().replace(".", "-")
        cik    = str(int(entry.get("cik_str", 0))).zfill(10)
        if ticker and cik != "0000000000":
            cik_map[ticker] = cik
    logger.info("EDGAR CIK map loaded: %d companies", len(cik_map))
    return cik_map


def get_edgar_cik_map(force_refresh: bool = False) -> dict[str, str]:
    """
    Return {TICKER: CIK_10_DIGIT} for all SEC-registered public companies.
    Cached 1 day; falls back to stale cache on network failure.
    """
    if not force_refresh:
        cached = _load_json_cache(_EDGAR_PATH, _EDGAR_TTL)
        if cached:
            return cached.get("cik_map", {})
    try:
        cik_map = _fetch_edgar_cik_map()
        _save_json_cache(_EDGAR_PATH, {
            "cik_map":   cik_map,
            "fetched_at": datetime.utcnow().isoformat(),
            "total":      len(cik_map),
        })
        return cik_map
    except Exception as exc:
        logger.warning("EDGAR CIK fetch failed: %s", exc)
        stale = _load_stale(_EDGAR_PATH)
        if stale:
            logger.info("Using stale EDGAR CIK map as fallback")
            return stale.get("cik_map", {})
        return {}


def get_cik_any(symbol: str) -> Optional[str]:
    """
    Look up 10-digit CIK for *any* SEC-registered ticker.
    First checks the S&P 500 map (faster, always populated), then the
    full EDGAR map (covers Russell 1000/2000 and beyond).
    Returns None if not found.
    """
    sym = symbol.upper().strip().replace(".", "-")

    # 1. Fast path: S&P 500 map (Wikipedia source, has CIK embedded)
    try:
        from sp500_universe import get_cik as _sp500_cik
        cik = _sp500_cik(sym)
        if cik:
            return cik
    except Exception:
        pass

    # 2. Full EDGAR company ticker map
    cik_map = get_edgar_cik_map()
    return cik_map.get(sym)


# ---------------------------------------------------------------------------
# Russell 1000 — Wikipedia scrape
# ---------------------------------------------------------------------------

def _fetch_russell1000_wikipedia() -> list[str]:
    """
    Scrape Russell 1000 members from Wikipedia's Russell 1000 Index article.
    Wikipedia lists the top ~1000 constituents in a table.
    Returns a list of ticker symbols.
    """
    import io
    import requests
    import pandas as pd

    resp = requests.get(_R1000_WIKI, headers=_BROWSER_HEADERS, timeout=20)
    resp.raise_for_status()
    tables = pd.read_html(io.StringIO(resp.text), header=0)

    tickers: list[str] = []
    for df in tables:
        cols = [str(c).lower() for c in df.columns]
        # Look for a table with a ticker/symbol column
        ticker_col = next(
            (df.columns[i] for i, c in enumerate(cols) if "ticker" in c or "symbol" in c),
            None,
        )
        if ticker_col is not None and len(df) > 10:
            for val in df[ticker_col].dropna():
                sym = str(val).strip().replace(".", "-").upper()
                if re.match(r"^[A-Z]{1,5}(-[A-Z])?$", sym):
                    tickers.append(sym)
            if tickers:
                break

    # Deduplicate while preserving order
    seen: set[str] = set()
    return [t for t in tickers if not (t in seen or seen.add(t))]  # type: ignore[func-returns-value]


def _fetch_ishares_holdings(url: str, min_rows: int = 100) -> list[str]:
    """
    Download an iShares ETF holdings CSV and extract ticker symbols.
    Returns list of tickers.  Raises on failure.
    """
    import io
    import requests
    import pandas as pd

    headers = dict(_BROWSER_HEADERS)
    headers["Referer"] = "https://www.ishares.com/"
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()

    # iShares CSVs have a few header rows before the actual data
    text = resp.text
    lines = text.splitlines()
    # Find the row that looks like a header (contains "Ticker" or "Symbol")
    header_idx = 0
    for i, line in enumerate(lines):
        if "Ticker" in line or "Symbol" in line:
            header_idx = i
            break

    csv_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(io.StringIO(csv_text))
    df.columns = [str(c).strip() for c in df.columns]

    ticker_col = next(
        (c for c in df.columns if "ticker" in c.lower() or "symbol" in c.lower()),
        None,
    )
    if ticker_col is None or len(df) < min_rows:
        raise ValueError(f"iShares CSV parse failed: cols={list(df.columns)}, rows={len(df)}")

    tickers: list[str] = []
    for val in df[ticker_col].dropna():
        sym = str(val).strip().replace(".", "-").upper()
        # Skip non-tickers (cash, futures, blank rows)
        if re.match(r"^[A-Z]{1,6}(-[A-Z])?$", sym) and sym not in ("", "-", "N/A", "CASH"):
            tickers.append(sym)

    seen: set[str] = set()
    return [t for t in tickers if not (t in seen or seen.add(t))]  # type: ignore[func-returns-value]


def get_russell1000_tickers(force_refresh: bool = False) -> list[str]:
    """
    Return a list of Russell 1000 constituent tickers.
    Tries Wikipedia first, then iShares IWB CSV.
    Falls back to stale cache on failure.
    """
    if not force_refresh:
        cached = _load_json_cache(_R1000_PATH, _INDEX_TTL)
        if cached:
            return cached.get("tickers", [])

    tickers: list[str] = []

    # Try Wikipedia
    try:
        tickers = _fetch_russell1000_wikipedia()
        if len(tickers) >= 100:
            logger.info("Russell 1000 fetched from Wikipedia: %d tickers", len(tickers))
    except Exception as exc:
        logger.warning("Russell 1000 Wikipedia fetch failed: %s", exc)

    # Fallback: iShares IWB CSV
    if len(tickers) < 100:
        try:
            tickers = _fetch_ishares_holdings(_IWB_CSV, min_rows=100)
            logger.info("Russell 1000 fetched from iShares IWB: %d tickers", len(tickers))
        except Exception as exc:
            logger.warning("Russell 1000 iShares fetch failed: %s", exc)

    if tickers:
        _save_json_cache(_R1000_PATH, {
            "tickers":   tickers,
            "fetched_at": datetime.utcnow().isoformat(),
            "total":      len(tickers),
        })
        return tickers

    # Stale fallback
    stale = _load_stale(_R1000_PATH)
    if stale:
        logger.info("Using stale Russell 1000 cache as fallback")
        return stale.get("tickers", [])
    return []


def get_russell2000_tickers(force_refresh: bool = False) -> list[str]:
    """
    Return a list of Russell 2000 constituent tickers (best-effort).
    Source: iShares IWM ETF holdings CSV.
    Falls back to stale cache on failure.
    """
    if not force_refresh:
        cached = _load_json_cache(_R2000_PATH, _INDEX_TTL)
        if cached:
            return cached.get("tickers", [])

    tickers: list[str] = []
    try:
        tickers = _fetch_ishares_holdings(_IWM_CSV, min_rows=500)
        logger.info("Russell 2000 fetched from iShares IWM: %d tickers", len(tickers))
    except Exception as exc:
        logger.warning("Russell 2000 iShares fetch failed: %s", exc)

    if tickers:
        _save_json_cache(_R2000_PATH, {
            "tickers":   tickers,
            "fetched_at": datetime.utcnow().isoformat(),
            "total":      len(tickers),
        })
        return tickers

    stale = _load_stale(_R2000_PATH)
    if stale:
        logger.info("Using stale Russell 2000 cache as fallback")
        return stale.get("tickers", [])
    return []


def get_combined_universe() -> list[str]:
    """
    Return a deduplicated list of tickers from S&P 500 + Russell 1000
    (Russell 2000 is excluded from combined to keep it manageable).
    """
    from sp500_universe import list_sp500_tickers
    combined: list[str] = list_sp500_tickers() + get_russell1000_tickers()
    seen: set[str] = set()
    return [t for t in combined if not (t in seen or seen.add(t))]  # type: ignore[func-returns-value]


# ---------------------------------------------------------------------------
# Full US Universe — ALL actively traded securities
# ---------------------------------------------------------------------------

def _fetch_nasdaq_screener() -> list[dict]:
    """
    Fetch ALL actively traded US securities from NASDAQ screener API.
    Returns list of dicts with: symbol, name, lastsale, marketCap.
    Covers NYSE, NASDAQ, NYSE American/ARCA, ETFs, ADRs, preferred, warrants.
    """
    import requests

    all_rows: list[dict] = []
    offset = 0
    batch_size = 500
    headers = {"User-Agent": "Mozilla/5.0 (compatible; QuantEngine/2.0)"}

    while True:
        try:
            url = (
                f"https://api.nasdaq.com/api/screener/stocks"
                f"?tableType=traded&limit={batch_size}&offset={offset}"
            )
            r = requests.get(url, headers=headers, timeout=20)
            r.raise_for_status()
            data = r.json()
            rows = data.get("data", {}).get("table", {}).get("rows", [])
            if not rows:
                break
            all_rows.extend(rows)
            total = int(data.get("data", {}).get("totalrecords", 0))
            offset += batch_size
            if offset >= total:
                break
            # Brief pause to be polite
            import time
            time.sleep(0.5)
        except Exception as exc:
            logger.warning("NASDAQ screener fetch failed at offset %d: %s", offset, exc)
            break

    logger.info("NASDAQ screener: fetched %d securities", len(all_rows))
    return all_rows


def get_full_us_universe(force_refresh: bool = False) -> list[dict]:
    """
    Return a comprehensive list of ALL actively traded US securities.
    Combines: NASDAQ screener (primary) + S&P 500 + Russell 1000 + Russell 2000.

    Each entry: {"symbol": str, "name": str, "market_cap": float|None, "asset_type": str}

    Sources cover:
    - NYSE, NASDAQ, NYSE American/ARCA common stocks
    - ETFs and ETNs
    - ADRs (American Depositary Receipts)
    - Preferred shares
    - Warrants
    - REITs, MLPs, SPACs

    Excludes: delisted securities, test symbols, very low market cap (<$1M).
    Cache TTL: 7 days.
    """
    # Check cache first
    if not force_refresh:
        cached = _load_json_cache(_FULL_US_PATH, _INDEX_TTL)
        if cached:
            return cached.get("tickers", [])

    # Fetch from NASDAQ screener (all traded securities)
    raw_rows = _fetch_nasdaq_screener()

    if not raw_rows:
        # Fallback to stale cache
        stale = _load_stale(_FULL_US_PATH)
        if stale:
            logger.info("Using stale full US universe cache (%d tickers)", len(stale.get("tickers", [])))
            return stale.get("tickers", [])
        # Ultimate fallback: combine what we have
        logger.warning("NASDAQ screener failed, building from index constituents")
        return _build_fallback_universe()

    # Process and classify
    seen: set[str] = set()
    tickers: list[dict] = []

    for row in raw_rows:
        sym = (row.get("symbol") or "").strip().upper()
        if not sym or sym in seen:
            continue
        # Skip test/placeholder symbols
        if sym.startswith("ZZZZZ") or sym.startswith("NTEST"):
            continue

        name = (row.get("name") or sym).strip()

        # Parse market cap
        cap_str = row.get("marketCap", "")
        market_cap = None
        if cap_str and cap_str not in ("NA", "", "0"):
            try:
                market_cap = float(str(cap_str).replace(",", ""))
            except (ValueError, TypeError):
                pass

        # Skip very small / shell companies (< $1M market cap when known)
        if market_cap is not None and market_cap < 1_000_000:
            continue

        # Classify asset type from name
        asset_type = _classify_asset_type(sym, name)

        # yfinance compatibility: replace dots with dashes
        yf_sym = sym.replace(".", "-")

        seen.add(sym)
        tickers.append({
            "symbol": yf_sym,
            "name": name[:60],
            "market_cap": market_cap,
            "asset_type": asset_type,
        })

    # Also merge in index constituents that might not appear in screener
    _merge_index_tickers(tickers, seen)

    # Sort: by market cap descending (None at end)
    tickers.sort(key=lambda t: t.get("market_cap") or 0, reverse=True)

    logger.info("Full US universe: %d tickers (%d from screener, merged with indices)",
                len(tickers), len(raw_rows))

    # Cache
    _save_json_cache(_FULL_US_PATH, {
        "tickers":    tickers,
        "fetched_at": datetime.utcnow().isoformat(),
        "total":      len(tickers),
        "sources":    ["nasdaq_screener", "sp500", "russell1000", "russell2000"],
    })

    return tickers


_KNOWN_ETFS = {
    "SPY","QQQ","IWM","DIA","IVV","VOO","VTI","VEA","VWO","EFA","EEM","AGG","BND","TLT","LQD",
    "HYG","GLD","SLV","USO","UNG","COPX","UUP","FXI","EWJ","EWZ","EWT","EWY","EWH","EWG","EWU",
    "XLF","XLK","XLE","XLV","XLI","XLB","XLRE","XLP","XLU","XLY","XLC","ARKK","ARKW","ARKF",
    "ARKG","ARKQ","SOXX","SMH","IBB","KRE","KBE","XBI","ITB","XHB","IYR","VNQ","SCHD","VIG",
    "DVY","HDV","NOBL","RSP","MTUM","QUAL","VLUE","SIZE","USMV","SPLV","SPHD","VYM","VXUS",
    "IXUS","IEMG","IEFA","GDX","GDXJ","XME","OIH","TAN","ICLN","PBW","QCLN","LIT","REMX",
    "HACK","SKYY","CLOU","WCLD","BOTZ","ROBO","DRIV","IDRV","KWEB","MCHI","CQQQ","ASHR",
    "SHY","IEF","TIP","VTIP","MUB","HYD","JNK","BKLN","VCIT","VCSH","BSV","BIV","BLV",
    "GOVT","SPTL","SPAB","SPTS","SPTM","SPMD","SPSM","MDY","IJH","IJR","IWB","IWF","IWD",
    "IWN","IWO","IWP","IWS","TQQQ","SQQQ","SPXU","SPXS","UPRO","SDS","SSO","QLD","PSQ",
    "SH","DOG","VIXY","VXX","UVXY","SVXY","SOXL","SOXS","LABU","LABD","NUGT","DUST","JNUG","JDST",
}

def _classify_asset_type(symbol: str, name: str) -> str:
    """Classify a security by its name/symbol into an asset type."""
    # Check known ETF symbols first
    if symbol.upper() in _KNOWN_ETFS:
        return "ETF"

    name_lower = name.lower()

    if any(kw in name_lower for kw in ["etf", "trust fund", "index fund", "ishares", "vanguard", "spdr",
                                        "proshares", "invesco", "wisdomtree", "direxion", "vaneck",
                                        "schwab", "fidelity", "global x", "first trust"]):
        return "ETF"
    if any(kw in name_lower for kw in ["etn", "exchange traded note", "velocityshares", "barclays"]):
        return "ETN"
    if any(kw in name_lower for kw in ["adr", "american depositary", "sponsored adr", "ads"]):
        return "ADR"
    if any(kw in name_lower for kw in ["preferred", "pfd", "dep shs repr", "depositary shares"]):
        return "Preferred"
    if any(kw in name_lower for kw in ["warrant", "warrants"]):
        return "Warrant"
    if any(kw in name_lower for kw in ["right", "rights"]):
        return "Right"
    if any(kw in name_lower for kw in ["unit", "units"]):
        return "Unit"
    if any(kw in name_lower for kw in ["reit", "real estate investment trust"]):
        return "REIT"
    if any(kw in name_lower for kw in ["acquisition corp", "spac", "blank check"]):
        return "SPAC"
    if any(kw in name_lower for kw in [" lp", " l.p.", "partners lp", "partnership"]):
        return "MLP"
    return "Equity"


def _merge_index_tickers(tickers: list[dict], seen: set[str]) -> None:
    """Merge S&P 500, Russell 1000, and Russell 2000 tickers not already in list."""
    try:
        from sp500_universe import list_sp500_tickers
        for sym in list_sp500_tickers():
            yf_sym = sym.replace(".", "-")
            if yf_sym not in seen and sym not in seen:
                seen.add(yf_sym)
                tickers.append({"symbol": yf_sym, "name": yf_sym, "market_cap": None, "asset_type": "Equity"})
    except Exception:
        pass

    try:
        for sym in get_russell1000_tickers():
            yf_sym = sym.replace(".", "-")
            if yf_sym not in seen and sym not in seen:
                seen.add(yf_sym)
                tickers.append({"symbol": yf_sym, "name": yf_sym, "market_cap": None, "asset_type": "Equity"})
    except Exception:
        pass

    try:
        for sym in get_russell2000_tickers():
            yf_sym = sym.replace(".", "-")
            if yf_sym not in seen and sym not in seen:
                seen.add(yf_sym)
                tickers.append({"symbol": yf_sym, "name": yf_sym, "market_cap": None, "asset_type": "Equity"})
    except Exception:
        pass


def _build_fallback_universe() -> list[dict]:
    """Fallback: combine index constituents when NASDAQ screener is unavailable."""
    seen: set[str] = set()
    tickers: list[dict] = []
    _merge_index_tickers(tickers, seen)
    return tickers
