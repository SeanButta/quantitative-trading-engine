"""
FRED (Federal Reserve Economic Data) Client & Macro Analysis Engine
====================================================================
Curated catalog of 40+ series across 8 economic categories.
Smart rule-based summary engine provides economic interpretation.

Docs:    https://fred.stlouisfed.org/docs/api/fred/
"""

import math
import os
import time
import logging
from datetime import datetime, timedelta
from typing import Optional

import requests

logger = logging.getLogger(__name__)

FRED_API_KEY  = os.getenv("FRED_API_KEY", "99c952e575b12c86de034414871cf1ba")  # TODO: rotate key and remove default
FRED_BASE     = "https://api.stlouisfed.org/fred"

# ── Curated Series Catalog ─────────────────────────────────────────────────────

FRED_CATALOG: dict[str, list[dict]] = {
    "GDP & Growth": [
        {"id": "GDPC1",           "name": "Real GDP",                       "unit": "Bil. $", "freq": "Q"},
        {"id": "A191RL1Q225SBEA", "name": "Real GDP Growth Rate (QoQ Ann.)","unit": "%",      "freq": "Q"},
        {"id": "INDPRO",          "name": "Industrial Production Index",    "unit": "Index",  "freq": "M"},
        {"id": "TCU",             "name": "Capacity Utilization",           "unit": "%",      "freq": "M"},
        {"id": "ISRATIO",         "name": "Inventory-to-Sales Ratio",       "unit": "Ratio",  "freq": "M"},
    ],
    "Inflation": [
        {"id": "CPIAUCSL",  "name": "CPI All Items",              "unit": "Index", "freq": "M"},
        {"id": "CPILFESL",  "name": "Core CPI (ex Food & Energy)","unit": "Index", "freq": "M"},
        {"id": "PCEPI",     "name": "PCE Price Index",            "unit": "Index", "freq": "M"},
        {"id": "PCEPILFE",  "name": "Core PCE Price Index",       "unit": "Index", "freq": "M"},
        {"id": "T5YIE",     "name": "5-Year Breakeven Inflation", "unit": "%",     "freq": "D"},
        {"id": "T10YIE",    "name": "10-Year Breakeven Inflation","unit": "%",     "freq": "D"},
    ],
    "Labor Market": [
        {"id": "UNRATE",  "name": "Unemployment Rate",      "unit": "%",         "freq": "M"},
        {"id": "PAYEMS",  "name": "Nonfarm Payrolls",        "unit": "Thousands", "freq": "M"},
        {"id": "ICSA",    "name": "Initial Jobless Claims",  "unit": "Thousands", "freq": "W"},
        {"id": "JTSJOL",  "name": "Job Openings (JOLTS)",    "unit": "Thousands", "freq": "M"},
        {"id": "U6RATE",  "name": "U-6 Unemployment Rate",   "unit": "%",         "freq": "M"},
        {"id": "AWHAETP", "name": "Avg Weekly Hours (Priv.)", "unit": "Hours",    "freq": "M"},
    ],
    "Interest Rates": [
        {"id": "FEDFUNDS",     "name": "Federal Funds Rate",     "unit": "%", "freq": "M"},
        {"id": "DGS10",        "name": "10-Year Treasury Yield", "unit": "%", "freq": "D"},
        {"id": "DGS2",         "name": "2-Year Treasury Yield",  "unit": "%", "freq": "D"},
        {"id": "DGS30",        "name": "30-Year Treasury Yield", "unit": "%", "freq": "D"},
        {"id": "T10Y2Y",       "name": "10Y-2Y Spread (Yield Curve)", "unit": "%", "freq": "D"},
        {"id": "T10Y3M",       "name": "10Y-3M Spread (Recession Model)", "unit": "%", "freq": "D"},
        {"id": "MORTGAGE30US", "name": "30-Year Mortgage Rate",  "unit": "%", "freq": "W"},
    ],
    "Money & Credit": [
        {"id": "M2SL",     "name": "M2 Money Supply",             "unit": "Bil. $", "freq": "M"},
        {"id": "WALCL",    "name": "Fed Balance Sheet (Assets)",   "unit": "Mil. $", "freq": "W"},
        {"id": "BOGMBASE", "name": "Monetary Base",               "unit": "Bil. $", "freq": "M"},
        {"id": "BAA10Y",   "name": "BAA Corp Bond Spread",        "unit": "%",      "freq": "D"},
        {"id": "DRTSCILM", "name": "C&I Loan Tightening (% Banks)","unit": "%",     "freq": "Q"},
    ],
    "Consumer": [
        {"id": "PCE",         "name": "Personal Consumption Exp.", "unit": "Bil. $", "freq": "M"},
        {"id": "PSAVERT",     "name": "Personal Savings Rate",     "unit": "%",      "freq": "M"},
        {"id": "DSPIC96",     "name": "Real Disposable Income",    "unit": "Bil. $", "freq": "M"},
        {"id": "UMCSENT",     "name": "Consumer Sentiment (UofM)", "unit": "Index",  "freq": "M"},
        {"id": "RETAILSMNSA", "name": "Retail Sales (NSA)",        "unit": "Mil. $", "freq": "M"},
    ],
    "Housing": [
        {"id": "HOUST",       "name": "Housing Starts",           "unit": "Thousands", "freq": "M"},
        {"id": "PERMIT",      "name": "Building Permits",         "unit": "Thousands", "freq": "M"},
        {"id": "CSUSHPISA",   "name": "Case-Shiller Home Price",  "unit": "Index",     "freq": "M"},
        {"id": "MSPUS",       "name": "Median Home Sale Price",   "unit": "$",         "freq": "Q"},
        {"id": "EXHOSLUSM495S","name": "Existing Home Sales",     "unit": "Thousands", "freq": "M"},
    ],
    "Financial Markets": [
        {"id": "VIXCLS",           "name": "CBOE VIX",              "unit": "Index",   "freq": "D"},
        {"id": "DEXUSEU",          "name": "USD/EUR Exchange Rate", "unit": "USD/EUR", "freq": "D"},
        {"id": "DTWEXBGS",         "name": "USD Trade-Wtd. Index",  "unit": "Index",   "freq": "D"},
        {"id": "GOLDAMGBD228NLBM", "name": "Gold Price (London PM)","unit": "USD/oz",  "freq": "D"},
        {"id": "DCOILWTICO",       "name": "WTI Crude Oil",         "unit": "USD/bbl", "freq": "D"},
    ],
}

# Flat lookup: series_id → metadata + category
_CATALOG_FLAT: dict[str, dict] = {}
for _cat, _series_list in FRED_CATALOG.items():
    for _s in _series_list:
        _CATALOG_FLAT[_s["id"]] = {**_s, "category": _cat}


# ── Context knowledge for the summary engine ───────────────────────────────────

SERIES_CONTEXT: dict[str, dict] = {
    "UNRATE":   {"label":"Unemployment Rate","rising_bad":True,  "warn_hi":5.5, "ok_hi":4.5, "notes":"Fed target ~4–4.5%. Sustained readings above 6% signal recession territory."},
    "CPIAUCSL": {"label":"CPI Inflation",    "rising_bad":True,  "warn_hi":4.0, "ok_hi":2.5, "notes":"Fed 2% target (PCE-based). CPI > 4% historically prompts significant tightening."},
    "CPILFESL": {"label":"Core CPI",         "rising_bad":True,  "warn_hi":3.5, "ok_hi":2.5, "notes":"Excludes food & energy. The Fed watches this to gauge underlying price stickiness."},
    "PCEPI":    {"label":"PCE Inflation",    "rising_bad":True,  "warn_hi":3.5, "ok_hi":2.0, "notes":"The Federal Reserve's primary inflation gauge. Official 2% target."},
    "PCEPILFE": {"label":"Core PCE",         "rising_bad":True,  "warn_hi":3.0, "ok_hi":2.0, "notes":"Removes volatile food & energy. The cleanest read on underlying inflation for the FOMC."},
    "FEDFUNDS": {"label":"Fed Funds Rate",   "rising_bad":None,  "warn_hi":5.5, "ok_hi":None,"notes":"Above 5% is historically restrictive, compressing credit and equity valuations."},
    "T10Y2Y":   {"label":"Yield Curve (10Y-2Y)","rising_bad":False,"warn_lo":-0.5,"ok_lo":0.1,"notes":"Inversion below 0% has preceded every US recession since 1978 with a typical 12–24 month lag."},
    "T10Y3M":   {"label":"Yield Curve (10Y-3M)","rising_bad":False,"warn_lo":-0.5,"ok_lo":0.1,"notes":"NY Fed's preferred recession probability model input. Inversion most reliable predictor."},
    "BAA10Y":   {"label":"Credit Spread (BAA-10Y)","rising_bad":True,"warn_hi":3.0,"ok_hi":2.0,"notes":"Spread > 3% signals credit stress. Historically spikes 100–300bps during recessions."},
    "VIXCLS":   {"label":"VIX Volatility",   "rising_bad":True,  "warn_hi":25,  "ok_hi":18,  "notes":"Below 15 = complacency. 20–25 = concern. 30–40 = fear. Above 40 = panic/crisis."},
    "ICSA":     {"label":"Initial Jobless Claims","rising_bad":True,"warn_hi":300,"ok_hi":230,"notes":"4-week average > 300K points to significant labor market deterioration."},
    "PSAVERT":  {"label":"Savings Rate",     "rising_bad":False, "warn_lo":3.0, "ok_lo":5.0, "notes":"Very low savings (<3%) = consumer is financially stretched. Limits future spending capacity."},
    "UMCSENT":  {"label":"Consumer Sentiment","rising_bad":False,"warn_lo":60,  "ok_lo":75,  "notes":"Below 60 signals consumer recession fears. Long-run avg ~86; bottoms near 55–60 in recessions."},
    "WALCL":    {"label":"Fed Balance Sheet","rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"QE (expansion) = risk-on liquidity injection. QT (contraction) = tightening financial conditions."},
    "M2SL":     {"label":"M2 Money Supply",  "rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"Rapid M2 growth > 10%/yr has historically preceded inflation spikes by 12–18 months."},
    "MORTGAGE30US":{"label":"30-Year Mortgage","rising_bad":True,"warn_hi":7.0,"ok_hi":5.5, "notes":"Above 7% severely constrains home affordability. Each 1% = ~$150/mo on median home loan."},
    "HOUST":    {"label":"Housing Starts",   "rising_bad":False, "warn_lo":900, "ok_lo":1200,"notes":"Below 1M = housing downturn. Historical expansion avg ~1.5M. Leads GDP by ~6 months."},
    "DGS10":    {"label":"10-Year Treasury", "rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"Benchmark rate for mortgages, corporate bond pricing, and equity discount rates."},
    "GDPC1":    {"label":"Real GDP",         "rising_bad":False, "warn_lo":None,"ok_lo":None,"notes":"Two consecutive negative quarters = technical recession. Long-run US potential ~2–2.5%/yr."},
    "BOGMBASE": {"label":"Monetary Base",    "rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"M0 + bank reserves. Expands via QE / emergency credit facilities. Contracts via QT."},
    "PAYEMS":   {"label":"Nonfarm Payrolls", "rising_bad":False, "warn_lo":None,"ok_lo":None,"notes":"100K–150K/mo = trend growth (keeps pace with labor force). < 0 = contraction."},
    "DRTSCILM": {"label":"C&I Loan Tightening","rising_bad":True,"warn_hi":30, "ok_hi":5,   "notes":"Senior loan officer survey. Above 30% net tightening historically precedes credit crunches."},
    "DCOILWTICO":{"label":"WTI Crude Oil",   "rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"Oil price shocks pass through to CPI. Sharp drops can signal recession/demand destruction."},
    "T5YIE":    {"label":"5-Year Breakeven", "rising_bad":True,  "warn_hi":3.0, "ok_hi":2.5, "notes":"Market-implied 5-yr inflation expectation. Fed monitors this to assess credibility."},
    "T10YIE":   {"label":"10-Year Breakeven","rising_bad":True,  "warn_hi":3.0, "ok_hi":2.5, "notes":"Market-implied 10-yr inflation expectation. Long-run inflation anchoring signal."},
    "DEXUSEU":  {"label":"USD/EUR Rate",     "rising_bad":None,  "warn_hi":None,"ok_hi":None,"notes":"Stronger USD (higher value) tightens global dollar liquidity, pressures EM debt."},
    "PCE":      {"label":"Personal Consumption","rising_bad":False,"warn_lo":None,"ok_lo":None,"notes":"~70% of US GDP. The single most important growth driver to monitor."},
    "JTSJOL":   {"label":"JOLTS Job Openings","rising_bad":False,"warn_lo":None,"ok_lo":None,"notes":"Ratio of openings to unemployed > 1.5 = very tight labor market."},
}


# ── FREDClient ─────────────────────────────────────────────────────────────────

class FREDClient:
    """Thin, cached wrapper around the FRED REST API."""

    def __init__(self, api_key: str = FRED_API_KEY):
        self.api_key = api_key
        self._cache: dict = {}
        self._ttl = 3600  # 1-hour cache

    def _cache_get(self, key: str):
        entry = self._cache.get(key)
        if entry and (time.time() - entry[1]) < self._ttl:
            return entry[0]
        return None

    def _cache_set(self, key: str, val):
        self._cache[key] = (val, time.time())

    def _get(self, endpoint: str, params: dict) -> dict:
        cache_key = f"{endpoint}|{tuple(sorted(params.items()))}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached
        url = f"{FRED_BASE}/{endpoint}"
        r = requests.get(url, params={**params, "api_key": self.api_key, "file_type": "json"}, timeout=15)
        r.raise_for_status()
        data = r.json()
        self._cache_set(cache_key, data)
        return data

    def get_observations(
        self,
        series_id: str,
        observation_start: Optional[str] = None,
        frequency: Optional[str] = None,
        units: str = "lin",
    ) -> list[dict]:
        """Return [{date, value}] list. Strips missing '.' values."""
        params: dict = {"series_id": series_id, "sort_order": "asc"}
        if observation_start:
            params["observation_start"] = observation_start
        if frequency and frequency not in ("default", ""):
            params["frequency"] = frequency.lower()
        if units and units != "lin":
            params["units"] = units
        data = self._get("series/observations", params)
        result = []
        for o in data.get("observations", []):
            if o["value"] != ".":
                try:
                    result.append({"date": o["date"], "value": float(o["value"])})
                except (ValueError, TypeError):
                    pass
        return result

    def get_series_info(self, series_id: str) -> dict:
        data = self._get("series", {"series_id": series_id})
        s = data.get("seriess", [{}])[0]
        return {
            "id":                        s.get("id", series_id),
            "title":                     s.get("title", ""),
            "frequency":                 s.get("frequency", ""),
            "frequency_short":           s.get("frequency_short", ""),
            "units":                     s.get("units", ""),
            "units_short":               s.get("units_short", ""),
            "seasonal_adjustment_short": s.get("seasonal_adjustment_short", ""),
            "last_updated":              s.get("last_updated", ""),
            "observation_start":         s.get("observation_start", ""),
            "observation_end":           s.get("observation_end", ""),
            "notes":                     (s.get("notes") or "")[:500],
        }

    def search_series(self, search_text: str, limit: int = 20) -> list[dict]:
        data = self._get("series/search", {
            "search_text": search_text, "limit": limit,
            "order_by": "popularity", "sort_order": "desc",
        })
        return [{
            "id":              s["id"],
            "title":           s["title"],
            "frequency_short": s.get("frequency_short", ""),
            "units_short":     s.get("units_short", ""),
            "observation_end": s.get("observation_end", ""),
            "popularity":      s.get("popularity", 0),
        } for s in data.get("seriess", [])]


# Singleton instance
_fred = FREDClient()


# ── Period helper ───────────────────────────────────────────────────────────────

def period_to_start_date(period: str) -> str:
    today = datetime.today()
    p = period.lower()
    offsets: dict[str, timedelta] = {
        "1y": timedelta(days=366),
        "2y": timedelta(days=732),
        "5y": timedelta(days=5 * 366),
        "10y": timedelta(days=10 * 366),
        "20y": timedelta(days=20 * 366),
    }
    if p in offsets:
        return (today - offsets[p]).strftime("%Y-%m-%d")
    # "max" or anything else → fetch from 1950
    return "1950-01-01"


# ── Formatting helpers ──────────────────────────────────────────────────────────

def _fmt_val(v: float, units_short: str) -> str:
    us = (units_short or "").lower()
    if "percent" in us or "rate" in us or "%" in us:
        return f"{v:.2f}%"
    if "billion" in us or "bil." in us:
        return f"${v:,.1f}B"
    if "million" in us or "mil." in us:
        return f"${v:,.0f}M"
    if "thousand" in us:
        return f"{v:,.0f}K"
    if v >= 1_000_000:
        return f"{v / 1_000_000:.2f}M"
    if v >= 1_000:
        return f"{v:,.1f}"
    return f"{v:.4g}"


def _trend_label(pct: float) -> str:
    if   pct >  10: return "surging higher"
    elif pct >   4: return "rising sharply"
    elif pct >   1: return "rising"
    elif pct > 0.2: return "edging higher"
    elif pct < -10: return "collapsing"
    elif pct <  -4: return "falling sharply"
    elif pct <  -1: return "declining"
    elif pct < -0.2: return "edging lower"
    return "broadly flat"


# ── Smart Summary Engine ───────────────────────────────────────────────────────

def generate_macro_summary(
    series_id: str,
    observations: list[dict],
    info: dict,
) -> dict:
    """
    Rule-based economic interpretation of any FRED series.

    Returns a structured dict with:
      trend_label, current_value, current_formatted,
      change_1m / change_3m / change_1y (% change),
      percentile_5y (0-100), regime,
      headline, body (list[str]), causes (list[str]), watch (str)
    """
    if not observations:
        return {
            "trend_label": "unknown", "current_value": None,
            "current_formatted": "—", "change_1m": None,
            "change_3m": None, "change_1y": None, "percentile_5y": None,
            "regime": None, "headline": "No data available for this series.",
            "body": [], "causes": [], "watch": "",
        }

    vals  = [o["value"] for o in observations]
    n     = len(vals)
    cur   = vals[-1]
    ctx   = SERIES_CONTEXT.get(series_id, {})
    label = ctx.get("label") or info.get("title", series_id)
    units_short = info.get("units_short", "")
    cur_fmt = _fmt_val(cur, units_short)

    # ── Observations-per-period estimate ────────────────────────────────
    freq = (info.get("frequency_short") or "M")[0].upper()
    opm: dict[str, float] = {"D": 22, "W": 4.3, "M": 1, "Q": 0.33, "A": 0.083}
    obs_m = opm.get(freq, 1)
    n_1m  = max(1, round(obs_m))
    n_3m  = max(1, round(obs_m * 3))
    n_12m = max(1, round(obs_m * 12))
    n_5y  = max(1, round(obs_m * 60))

    def pct_ago(k: int) -> Optional[float]:
        if n <= k:
            return None
        prev = vals[-(k + 1)]
        return None if prev == 0 else (cur - prev) / abs(prev) * 100

    c1m  = pct_ago(n_1m)
    c3m  = pct_ago(n_3m)
    c1y  = pct_ago(n_12m)
    trend_pct = c3m if c3m is not None else c1y
    trend = _trend_label(trend_pct) if trend_pct is not None else "moving"

    # ── Historical percentile (last 5 years) ────────────────────────────
    window = vals[-n_5y:]
    pct_rank: Optional[float] = (
        sum(1 for v in window if v <= cur) / len(window) * 100 if window else None
    )

    # ── Regime ──────────────────────────────────────────────────────────
    regime: Optional[str] = None
    if ctx.get("warn_hi") is not None and cur >= ctx["warn_hi"]:
        regime = "elevated"
    elif ctx.get("ok_hi") is not None and cur <= ctx["ok_hi"]:
        regime = "normal"
    elif ctx.get("warn_lo") is not None and cur <= ctx["warn_lo"]:
        lbl_lower = label.lower()
        regime = "inverted" if ("spread" in lbl_lower or "curve" in lbl_lower) else "low"
    elif ctx.get("ok_lo") is not None and cur >= ctx["ok_lo"]:
        regime = "normal"

    # ── Headline ────────────────────────────────────────────────────────
    chg_str = ""
    if c1y is not None:
        dir_word = "up" if c1y > 0 else "down"
        chg_str  = f", {dir_word} {abs(c1y):.1f}% year-over-year"
    headline = f"{label} currently reads {cur_fmt}{chg_str}."
    if   regime == "elevated":   headline += " This is in elevated territory."
    elif regime == "inverted":   headline += " The curve is inverted — a historically reliable recession warning signal."
    elif regime == "low":        headline += " This reading is below historically normal ranges."

    # ── Body bullets ────────────────────────────────────────────────────
    def _ordinal(n: int) -> str:
        if 11 <= (n % 100) <= 13:
            return f"{n}th"
        return f"{n}{['th','st','nd','rd','th'][min(n%10, 4)]}"

    body: list[str] = []
    if pct_rank is not None:
        q = "near the top" if pct_rank > 75 else ("near the bottom" if pct_rank < 25 else "in the middle range")
        body.append(
            f"The current reading sits at the {_ordinal(round(pct_rank))} percentile of its 5-year history — {q} of recent values."
        )
    if c3m is not None:
        d = "risen" if c3m > 0 else "fallen"
        body.append(
            f"Over the past 3 months the series has {d} {abs(c3m):.2f}%, "
            f"reflecting a {'building' if abs(c3m) > 3 else 'modest'} {trend} trend."
        )
    if c1y is not None and abs(c1y) > 0.5:
        body.append(
            f"On a 12-month basis the change is {c1y:+.1f}%, "
            f"placing this in a {'sustained' if abs(c1y) > 5 else 'gradual'} {'upward' if c1y > 0 else 'downward'} trajectory."
        )
    if ctx.get("notes"):
        body.append(ctx["notes"])

    # ── Causes (series-specific rule base) ──────────────────────────────
    causes: list[str] = _derive_causes(series_id, cur, c1y, c3m, label)

    # ── What to watch ────────────────────────────────────────────────────
    _watch: dict[str, str] = {
        "UNRATE":       "The next NFP report and the JOLTS job openings-to-unemployed ratio.",
        "CPIAUCSL":     "Core PCE (Fed's primary gauge) and the shelter sub-index.",
        "CPILFESL":     "Shelter/rent inflation (typically lags 12 months) and wage growth.",
        "PCEPI":        "PCE services ex-housing ('supercore') — Chair Powell's key metric.",
        "PCEPILFE":     "Monthly MoM prints to confirm or deny disinflation trajectory.",
        "FEDFUNDS":     "FOMC dot-plot, meeting statements, and terminal rate pricing in fed funds futures.",
        "T10Y2Y":       "Whether the curve re-steepens: bull-steepening = risk-off; bear-steepening = inflation.",
        "T10Y3M":       "NY Fed recession probability model (derived from this spread). Historically 85%+ = high risk.",
        "BAA10Y":       "High-yield (HY) spreads and senior loan officer tightening survey.",
        "VIXCLS":       "VIX term structure: backwardation signals near-term fear; contango signals calm.",
        "M2SL":         "M2 YoY growth rate — negative or flat historically precedes economic slowdowns.",
        "WALCL":        "FOMC minutes for balance sheet guidance and any emergency facility activation.",
        "MORTGAGE30US": "Housing starts and existing home sales as lagged indicators of affordability impact.",
        "HOUST":        "Building permits (leading indicator) and mortgage application volume.",
        "ICSA":         "4-week moving average of initial claims and continuing claims (CCSA).",
        "UMCSENT":      "Long-term expectations sub-component and inflation expectations within the survey.",
        "GDPC1":        "Private final demand (ex-government) as the cleanest organic growth signal.",
        "PAYEMS":       "Wage growth (AHE) alongside payroll growth to assess inflationary pressure.",
        "BOGMBASE":     "Reserve balance levels and Fed reverse-repo volume for interbank liquidity.",
        "DRTSCILM":     "Charge-off rates and commercial loan growth as coincident credit health indicators.",
        "T5YIE":        "Whether breakeven inflation drifts above 3% — would signal de-anchoring of expectations.",
        "T10YIE":       "Long-end real yields (TIPS) to separate inflation expectation from growth premium.",
        "DCOILWTICO":   "Geopolitical supply risk, OPEC production decisions, and rig count as supply proxy.",
    }
    watch = _watch.get(series_id, f"The next scheduled release of {label} from FRED.")

    return {
        "trend_label":        trend,
        "current_value":      cur,
        "current_formatted":  cur_fmt,
        "change_1m":          round(c1m,  3) if c1m  is not None else None,
        "change_3m":          round(c3m,  3) if c3m  is not None else None,
        "change_1y":          round(c1y,  3) if c1y  is not None else None,
        "percentile_5y":      round(pct_rank, 1) if pct_rank is not None else None,
        "regime":             regime,
        "headline":           headline,
        "body":               body,
        "causes":             causes,
        "watch":              watch,
    }


def _derive_causes(
    sid: str, cur: float, c1y: Optional[float], c3m: Optional[float], label: str
) -> list[str]:
    """Return 2–3 contextual bullet points about what may be driving the series."""
    rising = (c3m or c1y or 0) > 0

    _lookup: dict[str, tuple[list[str], list[str]]] = {
        "CPIAUCSL":   (
            ["Energy and commodity price pass-through into consumer goods.",
             "Shelter costs — the largest CPI component — remain stubbornly elevated.",
             "Services inflation driven by still-resilient wage growth."],
            ["Easing supply chains and commodity normalization pulling headline lower.",
             "Lagged impact of prior Fed rate hikes reducing demand.",
             "Consumer spending moderation as excess pandemic savings are depleted."],
        ),
        "CPILFESL":   (
            ["Shelter inflation (lags spot rent by ~12 months) keeping core sticky.",
             "Services sector pricing power from tight labor markets.",
             "Goods prices recovering after post-pandemic deflation."],
            ["Rent growth cooling as new apartment supply hits market.",
             "Goods deflation extending into broader core basket.",
             "Fed policy lagged transmission compressing demand."],
        ),
        "PCEPI":      (
            ["Service-sector prices driven by wage-price dynamics.",
             "Energy price base effects amplifying headline PCE.",
             "Strong consumer balance sheets sustaining demand above capacity."],
            ["Goods deflation and commodity normalization leading the way down.",
             "Shelter services beginning to cool after lagging CPI by 6–12 months.",
             "Restrictive monetary policy reducing aggregate demand."],
        ),
        "PCEPILFE":   (
            ["Non-housing services inflation — 'supercore' — elevated from wage growth.",
             "Healthcare services and financial services components rising.",
             "Strong employment maintaining purchasing power above supply capacity."],
            ["Supercore PCE trending lower as labor market normalizes.",
             "Fed credibility anchoring long-run expectations below 2.5%.",
             "Goods disinflation broadening into services with a lag."],
        ),
        "UNRATE":     (
            ["Rapid Fed rate hikes cooling rate-sensitive hiring (housing, autos, banking).",
             "Corporate cost-cutting cycles following margin compression.",
             "Cyclical slowdown reducing demand for temporary and contract labor."],
            ["Resilient consumer spending supporting service-sector employment.",
             "Secular reshoring and infrastructure investment adding manufacturing jobs.",
             "Labor supply still constrained by demographic trends keeping unemployment low."],
        ),
        "PAYEMS":     (
            ["Services sector recovery — especially healthcare and leisure — adding jobs.",
             "Infrastructure and construction hiring supported by fiscal investment.",
             "Strong consumer balance sheets sustaining spending and employment."],
            ["Rate-sensitive sectors (housing, tech, finance) entering hiring freezes.",
             "Companies managing margins through efficiency rather than headcount growth.",
             "Tighter credit reducing small-business job creation capacity."],
        ),
        "T10Y2Y":     (
            ["Bond market pricing future rate cuts as growth slows.",
             "Fed maintaining high short-term rates while long-end anchors on inflation expectations.",
             "Flight-to-safety demand into long Treasuries compressing long yields."],
            ["Fed beginning easing cycle reduces short-term rate premium.",
             "Long-end yields rising on fiscal deficit / term premium concerns.",
             "Improving growth outlook reduces recession hedge demand."],
        ),
        "T10Y3M":     (
            ["Fed Funds rate elevated above long-term neutral while growth slows.",
             "Recession insurance demand compresses long-end yields.",
             "Credit conditions tightening as banks price in default risk."],
            ["Short-term rates declining as Fed eases; long-end stays anchored.",
             "Steepening reflects improving economic outlook reducing inversion.",
             "Inflation expectations rising at the long end."],
        ),
        "FEDFUNDS":   (
            ["Above-target inflation forcing Fed to maintain restrictive stance.",
             "Strong labor market giving FOMC room to hold rates higher for longer.",
             "Core PCE stickiness preventing an earlier pivot."],
            ["Inflation approaching 2% target clearing path for rate cuts.",
             "Labor market softening triggering Fed pivot to support growth.",
             "Financial conditions tightening on their own, reducing need for further hikes."],
        ),
        "BAA10Y":     (
            ["Credit markets pricing higher default probability amid tighter conditions.",
             "Leveraged companies facing costly refinancing at elevated rates.",
             "Risk-off rotation reducing demand for corporate bonds."],
            ["Strong corporate earnings supporting balance sheet health.",
             "Search for yield compressing spreads in low-vol environment.",
             "Fed easing reducing refinancing risk for leveraged issuers."],
        ),
        "M2SL":       (
            ["Fed QE programs and emergency liquidity injections expanding reserves.",
             "Broad bank credit creation (lending) directly flows into M2.",
             "Government deficit spending partially monetized through Treasury purchases."],
            ["Fed QT (balance sheet run-off) contracting reserve base.",
             "Weak loan demand from businesses and consumers reducing credit creation.",
             "Higher rates attracting money out of M2 deposits into money-market funds."],
        ),
        "WALCL":      (
            ["FOMC conducting QE — purchasing Treasuries and/or MBS.",
             "Emergency lending facilities activated (BTFP, repo, discount window)."],
            ["Fed conducting QT — allowing bonds to mature without reinvestment.",
             "Normalization and wind-down of post-crisis emergency facilities."],
        ),
        "VIXCLS":     (
            ["Macro uncertainty (Fed policy path, geopolitics, earnings risk) elevating option premium.",
             "Institutional demand for downside protection spiking ahead of event risk.",
             "Realized volatility picking up, forcing market-makers to charge more."],
            ["Equity markets pricing in soft-landing / Goldilocks scenario.",
             "Low near-term macro catalysts reducing hedging demand.",
             "Central bank policy clarity reducing uncertainty premium."],
        ),
        "ICSA":       (
            ["Rate-sensitive employers (mortgage, construction, tech) laying off workers.",
             "Cyclical slowdown reducing employer demand for existing headcount.",
             "Post-holiday or seasonal hiring freezes accelerating layoffs."],
            ["Resilient labor demand from services (healthcare, education) absorbing workers.",
             "Low layoff rates historically consistent with tight labor markets.",
             "Employers reluctant to shed workers given post-pandemic hiring difficulty."],
        ),
        "PSAVERT":    (
            ["Consumer spending outpacing income growth as excess savings are depleted.",
             "Low-rate environment reducing incentive to save vs. spend.",
             "Wealth effect from asset appreciation reducing perceived need to save."],
            ["Economic uncertainty increasing precautionary saving.",
             "Higher rates making savings accounts and money-market funds attractive.",
             "Consumer confidence declining, triggering belt-tightening."],
        ),
        "MORTGAGE30US":(
            ["10-Year Treasury yield rising on growth/inflation expectations.",
             "Fed rate hikes flowing through to mortgage markets with a short lag.",
             "Term premium in Treasuries rising on fiscal deficit concerns."],
            ["Fed easing lowering short-term rates, dragging mortgage rates down.",
             "Inflation expectations declining reducing long-end Treasury yields.",
             "Strong MBS demand compressing spread over Treasuries."],
        ),
        "HOUST":      (
            ["Declining mortgage rates improving affordability and buyer demand.",
             "Low existing-home inventory driving builders to fill the gap.",
             "Demographics: millennial household formation supporting structural demand."],
            ["7%+ mortgage rates pricing many buyers out of new construction.",
             "Construction cost inflation and labor shortages delaying projects.",
             "Builder confidence declining amid rate uncertainty."],
        ),
        "DCOILWTICO": (
            ["OPEC+ production cuts tightening global supply.",
             "Geopolitical tensions in oil-producing regions creating supply risk premium.",
             "Demand resilience in emerging markets and travel recovery."],
            ["Demand destruction from slowing global growth.",
             "OPEC compliance breakdown increasing non-OPEC supply.",
             "Dollar strength reducing purchasing power of oil-importing nations."],
        ),
        "UMCSENT":    (
            ["Labor market resilience and real income gains boosting confidence.",
             "Declining inflation improving consumer purchasing power.",
             "Asset price appreciation creating positive wealth effects."],
            ["High interest rates weighing on big-ticket purchase plans.",
             "Elevated uncertainty about economic outlook and employment security.",
             "Inflation eroding real wages and consumer purchasing power."],
        ),
    }

    pair = _lookup.get(sid)
    if pair:
        return pair[0] if rising else pair[1]

    # Generic fallback
    if rising:
        return [
            "Cyclical expansion and strong domestic demand driving the increase.",
            "Accommodative monetary or fiscal policy conditions supporting growth.",
            "Positive base effects from a prior year's weakness.",
        ]
    return [
        "Cyclical slowdown or restrictive financial conditions weighing on the reading.",
        "Tighter monetary policy reducing demand in rate-sensitive sectors.",
        "Supply-side structural pressures or sector-specific headwinds.",
    ]
