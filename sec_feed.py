"""
SEC EDGAR Feed
==============
Free, no API key required. Rate limit: ≤10 req/sec per SEC Fair Access policy.

Data sources:
  1. XBRL Company Facts   data.sec.gov/api/xbrl/companyfacts/CIK{n}.json
     → 10-15 years of standardised annual & quarterly financials (US-GAAP/IFRS)
     → Revenue, net income, EPS, operating income, assets, debt, cash, R&D, shares

  2. Submissions API       data.sec.gov/submissions/CIK{n}.json
     → Recent filing metadata: 8-K, 10-K, 10-Q dates + accession numbers

  3. Full-text search      efts.sec.gov/hits.json
     → Search 8-K / earnings releases by company name or CIK

Cache: runs/sec_cache/{CIK}.json  (24-hour TTL, gzip-compressed)
"""

from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

SEC_BASE    = "https://data.sec.gov"
EDGAR_BASE  = "https://efts.sec.gov"
HEADERS     = {
    "User-Agent":   "QuantEngine research@quantengine.local",
    "Accept":       "application/json",
}
_LAST_REQ   = 0.0          # simple global rate limiter
_MIN_DELAY  = 0.12         # ≥120 ms between requests → ≤8 req/s (under 10 limit)


# ── Rate-limited request helper ───────────────────────────────────────────────

def _get(url: str, timeout: int = 15) -> Optional[dict]:
    global _LAST_REQ
    wait = _MIN_DELAY - (time.monotonic() - _LAST_REQ)
    if wait > 0:
        time.sleep(wait)
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        _LAST_REQ = time.monotonic()
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        logger.debug("SEC HTTP %s for %s", e.response.status_code, url)
        return None
    except Exception as exc:
        logger.debug("SEC request failed %s: %s", url, exc)
        return None


# ── Safe float ────────────────────────────────────────────────────────────────

def _sf(val: Any, divisor: float = 1.0) -> Optional[float]:
    try:
        v = float(val) / divisor
        return None if (math.isnan(v) or math.isinf(v)) else round(v, 4)
    except (TypeError, ValueError):
        return None


# ── SecFeed ───────────────────────────────────────────────────────────────────

class SecFeed:
    """
    Fetches and caches SEC EDGAR data for a given CIK.

    Usage:
        feed = SecFeed()
        facts = feed.company_facts("0000320193")   # Apple
        filings = feed.recent_filings("0000320193")
    """

    def __init__(self, cache_dir: Path = None):
        if cache_dir is None:
            cache_dir = Path(__file__).parent / "runs" / "sec_cache"
        self._dir = cache_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    # ── Cache helpers ─────────────────────────────────────────────────────────

    def _path(self, key: str) -> Path:
        safe = key.replace("/", "_").replace(":", "_")
        return self._dir / f"{safe}.json"

    def _load(self, key: str, ttl_hours: float = 24.0) -> Optional[dict]:
        p = self._path(key)
        if not p.exists():
            return None
        try:
            age_h = (time.time() - p.stat().st_mtime) / 3600
            if age_h > ttl_hours:
                return None
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _save(self, key: str, data: Any) -> None:
        try:
            self._path(key).write_text(json.dumps(data, default=str), encoding="utf-8")
        except Exception as exc:
            logger.debug("SEC cache write failed %s: %s", key, exc)

    # ── Company Facts (XBRL) ──────────────────────────────────────────────────

    def company_facts(self, cik: str) -> Optional[dict]:
        """
        Full historical financials via SEC EDGAR XBRL API.

        Returns parsed dict:
        {
            entity_name, cik,
            revenue_annual, net_income_annual, eps_annual,
            op_income_annual, gross_profit_annual,
            total_assets_annual, lt_debt_annual, cash_annual,
            rd_expense_annual, capex_annual,
            shares_outstanding_annual,
            revenue_quarterly, net_income_quarterly, eps_quarterly,
        }
        Each *_annual list: [{"period": "2023", "value": 394.3}]   ($B or per-share)
        Each *_quarterly list: [{"period": "2023-Q3", "value": 89.5}]
        """
        cik = cik.lstrip("0").zfill(10)
        key = f"facts_{cik}"
        cached = self._load(key, ttl_hours=24)
        if cached:
            return cached

        raw = _get(f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik}.json")
        if not raw:
            return None

        result = self._parse_facts(raw)
        self._save(key, result)
        return result

    def _parse_facts(self, raw: dict) -> dict:
        gaap = raw.get("facts", {}).get("us-gaap", {})
        ifrs = raw.get("facts", {}).get("ifrs-full", {})
        facts = {**gaap, **ifrs}

        # ── helpers ────────────────────────────────────────────────────
        def _units(concept: str, unit: str = "USD") -> list[dict]:
            return facts.get(concept, {}).get("units", {}).get(unit, [])

        def _annual(concept: str, unit: str = "USD") -> list[dict]:
            """Deduplicated 10-K annual entries, most recent 16 years."""
            rows = [r for r in _units(concept, unit)
                    if r.get("form") in ("10-K", "20-F") and r.get("val") is not None
                    and r.get("end", "")]
            seen: dict[str, dict] = {}
            for r in rows:
                yr = r["end"][:4]
                if yr not in seen or r.get("filed", "") > seen[yr].get("filed", ""):
                    seen[yr] = r
            return sorted(seen.values(), key=lambda x: x["end"])[-16:]

        def _quarterly(concept: str, unit: str = "USD") -> list[dict]:
            """10-Q instant/duration quarterly entries, most recent 20 quarters."""
            rows = [r for r in _units(concept, unit)
                    if r.get("form") == "10-Q" and r.get("val") is not None
                    and r.get("end", "")]
            seen: dict[str, dict] = {}
            for r in rows:
                key_ = r["end"][:7]  # YYYY-MM
                if key_ not in seen or r.get("filed", "") > seen[key_].get("filed", ""):
                    seen[key_] = r
            ordered = sorted(seen.values(), key=lambda x: x["end"])[-20:]
            return ordered

        def _bn(entries: list[dict]) -> list[dict]:
            out = []
            for e in entries:
                v = _sf(e.get("val"), 1e9)
                if v is not None:
                    out.append({"period": e["end"][:7], "value": v})
            return out

        def _per_share(entries: list[dict]) -> list[dict]:
            out = []
            for e in entries:
                v = _sf(e.get("val"))
                if v is not None:
                    out.append({"period": e["end"][:7], "value": round(v, 2)})
            return out

        def _millions_shares(entries: list[dict]) -> list[dict]:
            out = []
            for e in entries:
                v = _sf(e.get("val"), 1e6)
                if v is not None:
                    out.append({"period": e["end"][:7], "value": round(v, 1)})
            return out

        def _first(*concepts: str, unit: str = "USD") -> list[dict]:
            """Return first non-empty concept from a priority list."""
            for c in concepts:
                r = _annual(c, unit)
                if r:
                    return r
            return []

        def _first_q(*concepts: str, unit: str = "USD") -> list[dict]:
            for c in concepts:
                r = _quarterly(c, unit)
                if r:
                    return r
            return []

        # ── Annual metrics ─────────────────────────────────────────────
        rev_a  = _first("Revenues",
                        "RevenueFromContractWithCustomerExcludingAssessedTax",
                        "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax")
        ni_a   = _first("NetIncomeLoss", "ProfitLoss", "NetIncome")
        oi_a   = _first("OperatingIncomeLoss", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest")
        gp_a   = _first("GrossProfit")
        ta_a   = _first("Assets")
        ltd_a  = _first("LongTermDebt", "LongTermDebtNoncurrent")
        cash_a = _first("CashAndCashEquivalentsAtCarryingValue",
                        "CashCashEquivalentsAndShortTermInvestments",
                        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")
        rd_a   = _first("ResearchAndDevelopmentExpense")
        capex_a = _first("PaymentsToAcquirePropertyPlantAndEquipment",
                         "CapitalExpenditureDiscontinuedOperations")
        eps_a  = _annual("EarningsPerShareBasic", "USD/shares")
        shr_a  = _annual("CommonStockSharesOutstanding", "shares")

        # ── Quarterly metrics ──────────────────────────────────────────
        rev_q  = _first_q("Revenues",
                           "RevenueFromContractWithCustomerExcludingAssessedTax",
                           "SalesRevenueNet")
        ni_q   = _first_q("NetIncomeLoss", "ProfitLoss")
        eps_q  = _quarterly("EarningsPerShareBasic", "USD/shares")

        return {
            "entity_name":               raw.get("entityName", ""),
            "cik":                       raw.get("cik", ""),
            "fetched_at":                datetime.utcnow().isoformat(),
            # Annual ($B)
            "revenue_annual":            _bn(rev_a),
            "net_income_annual":         _bn(ni_a),
            "op_income_annual":          _bn(oi_a),
            "gross_profit_annual":       _bn(gp_a),
            "total_assets_annual":       _bn(ta_a),
            "lt_debt_annual":            _bn(ltd_a),
            "cash_annual":               _bn(cash_a),
            "rd_expense_annual":         _bn(rd_a),
            "capex_annual":              _bn(capex_a),
            # Annual (per share / shares)
            "eps_annual":                _per_share(eps_a),
            "shares_outstanding_annual": _millions_shares(shr_a),
            # Quarterly ($B)
            "revenue_quarterly":         _bn(rev_q),
            "net_income_quarterly":      _bn(ni_q),
            "eps_quarterly":             _per_share(eps_q),
        }

    # ── Recent Filings (Submissions API) ─────────────────────────────────────

    def recent_filings(self, cik: str,
                       forms: tuple[str, ...] = ("8-K", "10-K", "10-Q"),
                       limit: int = 20) -> list[dict]:
        """
        Returns recent filing metadata for a company.
        Each item: {form, date, description, url, accession}
        """
        cik = cik.lstrip("0").zfill(10)
        key = f"filings_{cik}"
        cached = self._load(key, ttl_hours=6)
        if cached is not None:
            return cached

        data = _get(f"{SEC_BASE}/submissions/CIK{cik}.json")
        if not data:
            return []

        recent = data.get("filings", {}).get("recent", {})
        if not recent:
            return []

        result = []
        form_list = recent.get("form", [])
        dates     = recent.get("filingDate", [])
        docs      = recent.get("primaryDocument", [])
        acc_nums  = recent.get("accessionNumber", [])

        cik_int = int(cik)
        for i, form in enumerate(form_list[:100]):
            if form not in forms:
                continue
            acc  = acc_nums[i].replace("-", "") if i < len(acc_nums) else ""
            doc  = docs[i] if i < len(docs) else ""
            date = dates[i] if i < len(dates) else ""
            url  = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/{doc}" if acc else ""
            result.append({
                "form":        form,
                "date":        date,
                "description": doc,
                "url":         url,
                "accession":   acc_nums[i] if i < len(acc_nums) else "",
            })
            if len(result) >= limit:
                break

        self._save(key, result)
        return result

    # ── Full-text search for earnings 8-K filings ─────────────────────────────

    def earnings_releases(self, cik: str, limit: int = 8) -> list[dict]:
        """
        Search EDGAR full-text search for earnings-related 8-K filings.
        Returns list of {form, date, title, url} sorted newest-first.
        """
        cik = cik.lstrip("0").zfill(10)
        key = f"earnings_8k_{cik}"
        cached = self._load(key, ttl_hours=12)
        if cached is not None:
            return cached

        cik_int = str(int(cik))
        url = (f"{EDGAR_BASE}/hits.json?q=%22earnings%22&dateRange=custom"
               f"&startdt=2020-01-01&forms=8-K&entity={cik_int}")
        data = _get(url, timeout=10)
        if not data:
            return []

        hits = data.get("hits", {}).get("hits", [])
        result = []
        for h in hits[:limit]:
            src = h.get("_source", {})
            result.append({
                "form":  src.get("file_type", "8-K"),
                "date":  src.get("file_date", ""),
                "title": src.get("display_names", [""])[0] if src.get("display_names") else "",
                "url":   f"https://www.sec.gov{src['file_path']}" if src.get("file_path") else "",
            })

        self._save(key, result)
        return result


# ── Module-level convenience ──────────────────────────────────────────────────

_feed = SecFeed()

def get_company_facts(cik: str) -> Optional[dict]:
    return _feed.company_facts(cik)

def get_recent_filings(cik: str, **kwargs) -> list[dict]:
    return _feed.recent_filings(cik, **kwargs)
