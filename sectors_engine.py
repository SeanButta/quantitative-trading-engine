"""
Sectors Engine
==============
GICS sector monitoring: market cap, performance, valuation, fundamentals,
quarterly financials, analyst data — all via yfinance, no API key required.

Universe source: sp500_universe.py (Wikipedia, 7-day cache, ~503 tickers)
Fallback:        hardcoded SECTOR_UNIVERSE below (165 tickers)
"""

from __future__ import annotations

import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any

import yfinance as yf

logger = logging.getLogger(__name__)


def _get_active_universe() -> dict[str, list[str]]:
    """
    Return the best available ticker universe per sector.
    Tries sp500_universe first (Wikipedia, ~503 tickers).
    Falls back to hardcoded SECTOR_UNIVERSE (~165 tickers) if unavailable.
    """
    try:
        from sp500_universe import get_sp500_universe
        data = get_sp500_universe()
        if data and data.get("universe"):
            total = data.get("total", 0)
            logger.info("Using S&P 500 dynamic universe: %d tickers", total)
            return data["universe"]
    except Exception as exc:
        logger.warning("sp500_universe unavailable (%s), using hardcoded fallback", exc)
    return SECTOR_UNIVERSE

# ── GICS Sector Map ───────────────────────────────────────────────────────────

SECTOR_ETF: dict[str, str] = {
    "Energy":                 "XLE",
    "Materials":              "XLB",
    "Industrials":            "XLI",
    "Consumer Discretionary": "XLY",
    "Consumer Staples":       "XLP",
    "Health Care":            "XLV",
    "Financials":             "XLF",
    "Information Technology": "XLK",
    "Communication Services": "XLC",
    "Utilities":              "XLU",
    "Real Estate":            "XLRE",
}

SECTOR_COLOR: dict[str, str] = {
    "Energy":                 "#FF9800",
    "Materials":              "#8D6E63",
    "Industrials":            "#78909C",
    "Consumer Discretionary": "#E91E63",
    "Consumer Staples":       "#4CAF50",
    "Health Care":            "#2196F3",
    "Financials":             "#9C27B0",
    "Information Technology": "#00BCD4",
    "Communication Services": "#FF5722",
    "Utilities":              "#AED581",
    "Real Estate":            "#FFA726",
}

SECTOR_UNIVERSE: dict[str, list[str]] = {
    "Energy": [
        "XOM","CVX","COP","EOG","SLB","MPC","PSX","VLO","OXY","HAL",
        "DVN","BKR","HES","MRO","FANG",
    ],
    "Materials": [
        "LIN","APD","SHW","FCX","NEM","ECL","DD","NUE","CTVA","PPG",
        "ALB","VMC","MLM","CF","MOS",
    ],
    "Industrials": [
        "RTX","HON","UNP","UPS","BA","GE","MMM","LMT","CAT","DE",
        "EMR","ETN","ITW","PH","NSC",
    ],
    "Consumer Discretionary": [
        "AMZN","TSLA","HD","MCD","NKE","LOW","SBUX","TGT","BKNG","TJX",
        "CMG","ROST","DHI","F","GM",
    ],
    "Consumer Staples": [
        "PG","KO","PEP","WMT","COST","PM","MO","MDLZ","CL","KHC",
        "GIS","HSY","SYY","ADM","MKC",
    ],
    "Health Care": [
        "UNH","JNJ","LLY","ABBV","MRK","BMY","AMGN","ABT","TMO","DHR",
        "CVS","CI","HUM","MDT","ISRG",
    ],
    "Financials": [
        "BRK-B","JPM","BAC","WFC","GS","MS","BLK","AXP","C","SCHW",
        "CB","MMC","PGR","ICE","CME",
    ],
    "Information Technology": [
        "AAPL","MSFT","NVDA","AVGO","ORCL","AMD","QCOM","TXN","INTU","IBM",
        "AMAT","MU","NOW","ADBE","ACN",
    ],
    "Communication Services": [
        "META","GOOGL","NFLX","DIS","CMCSA","T","VZ","EA","TTWO","OMC",
        "IPG","FOXA","WBD","PARA","LYV",
    ],
    "Utilities": [
        "NEE","DUK","SO","D","AEP","EXC","SRE","PEG","ED","XEL",
        "ES","DTE","ETR","FE","CMS",
    ],
    "Real Estate": [
        "PLD","AMT","EQIX","PSA","O","CCI","SPG","WELL","AVB","EQR",
        "WY","VTR","DLR","ARE","MAA",
    ],
}

# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class TickerSnapshot:
    symbol:            str
    name:              str
    sector:            str

    # Price & performance
    price:             Optional[float] = None
    prev_close:        Optional[float] = None
    change_1d_pct:     Optional[float] = None
    change_1w_pct:     Optional[float] = None
    change_1m_pct:     Optional[float] = None
    change_3m_pct:     Optional[float] = None
    change_ytd_pct:    Optional[float] = None
    week52_high:       Optional[float] = None
    week52_low:        Optional[float] = None
    pct_from_52h:      Optional[float] = None   # % below 52-wk high (negative = below)
    pct_from_52l:      Optional[float] = None   # % above 52-wk low

    # Market data
    market_cap:        Optional[float] = None   # billions
    volume:            Optional[float] = None
    avg_volume:        Optional[float] = None
    volume_vs_avg:     Optional[float] = None   # ratio vol/avg_vol
    beta:              Optional[float] = None

    # Valuation multiples
    pe_ratio:          Optional[float] = None
    forward_pe:        Optional[float] = None
    pb_ratio:          Optional[float] = None
    ps_ratio:          Optional[float] = None
    ev_ebitda:         Optional[float] = None
    peg_ratio:         Optional[float] = None
    dividend_yield:    Optional[float] = None   # percent

    # Fundamentals (TTM)
    revenue_ttm:       Optional[float] = None   # billions
    revenue_growth:    Optional[float] = None   # % YoY
    eps_ttm:           Optional[float] = None
    eps_growth:        Optional[float] = None   # % YoY
    gross_margin:      Optional[float] = None   # %
    operating_margin:  Optional[float] = None   # %
    net_margin:        Optional[float] = None   # %
    roe:               Optional[float] = None   # %
    roa:               Optional[float] = None   # %
    debt_to_equity:    Optional[float] = None
    current_ratio:     Optional[float] = None
    free_cash_flow:    Optional[float] = None   # billions

    # Technical signals
    rsi_14:            Optional[float] = None
    ma50:              Optional[float] = None
    ma200:             Optional[float] = None
    above_ma50:        bool            = False
    above_ma200:       bool            = False
    ma50_vs_ma200:     Optional[float] = None   # golden/death cross distance %

    # Analyst consensus
    analyst_count:     int             = 0
    strong_buy:        int             = 0
    buy_count:         int             = 0
    hold_count:        int             = 0
    sell_count:        int             = 0
    strong_sell:       int             = 0
    mean_target:       Optional[float] = None
    high_target:       Optional[float] = None
    low_target:        Optional[float] = None
    target_upside:     Optional[float] = None   # % upside to mean target
    recommendation:    str             = ""     # strongBuy/buy/hold/sell/strongSell

    # Short interest
    short_ratio:       Optional[float] = None   # days to cover
    short_pct_float:   Optional[float] = None   # % of float shorted
    shares_short:      Optional[float] = None   # total shares short

    # Earnings
    next_earnings:     Optional[str]   = None   # YYYY-MM-DD
    last_eps_surprise: Optional[float] = None   # % surprise (positive = beat)
    earnings_streak:   int             = 0      # consecutive beats (+) or misses (-)

    # Valuation scoring vs sector peers
    val_score:         Optional[float] = None   # +2 = very cheap, -2 = very expensive
    val_label:         str             = "UNKNOWN"  # UNDERVALUED/FAIR/OVERVALUED

    # Composite signal
    signal_score:      Optional[float] = None   # -3 to +3
    signal_label:      str             = ""

    # GICS sub-industry (from Wikipedia / yfinance)
    sub_industry:      str             = ""

    snapshot_at:       str             = field(default_factory=lambda: datetime.utcnow().isoformat())
    error:             Optional[str]   = None


@dataclass
class SectorSnapshot:
    sector:            str
    etf:               str
    color:             str
    tickers:           list[TickerSnapshot] = field(default_factory=list)

    # Sector-level aggregates
    total_market_cap:  float           = 0.0   # billions
    median_pe:         Optional[float] = None
    median_pb:         Optional[float] = None
    median_ev_ebitda:  Optional[float] = None
    avg_change_1d:     Optional[float] = None
    avg_change_1m:     Optional[float] = None
    avg_change_ytd:    Optional[float] = None
    breadth_up:        int             = 0     # tickers up today
    breadth_down:      int             = 0

    # ETF data
    etf_price:         Optional[float] = None
    etf_change_1d:     Optional[float] = None
    etf_change_1m:     Optional[float] = None
    etf_change_3m:     Optional[float] = None
    etf_change_ytd:    Optional[float] = None

    snapshot_at:       str             = field(default_factory=lambda: datetime.utcnow().isoformat())


# ── Sector Provider ───────────────────────────────────────────────────────────

class SectorProvider:
    """Fetches sector and ticker data from yfinance."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _sf(self, val: Any, divisor: float = 1.0, pct: bool = False) -> Optional[float]:
        """Safe float conversion — returns None for NaN/Inf/None."""
        try:
            v = float(val)
            if math.isnan(v) or math.isinf(v):
                return None
            result = v / divisor
            if pct:
                result *= 100
            return round(result, 4)
        except (TypeError, ValueError):
            return None

    def _compute_rsi(self, closes: list[float], period: int = 14) -> Optional[float]:
        if len(closes) < period + 2:
            return None
        gains, losses = [], []
        for i in range(1, len(closes)):
            d = closes[i] - closes[i - 1]
            gains.append(max(d, 0.0))
            losses.append(max(-d, 0.0))
        if len(gains) < period:
            return None
        avg_g = sum(gains[-period:]) / period
        avg_l = sum(losses[-period:]) / period
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return round(100 - 100 / (1 + rs), 2)

    def _pct_change(self, closes: list[float], n: int) -> Optional[float]:
        if len(closes) >= n + 1 and closes[-n - 1] > 0:
            return round((closes[-1] - closes[-n - 1]) / closes[-n - 1] * 100, 2)
        return None

    # ------------------------------------------------------------------
    # Single ticker fetch
    # ------------------------------------------------------------------

    def _read_cached_info(self, symbol: str):
        """Read cached ticker info dict from DB. Returns dict or None."""
        try:
            from sqlalchemy import create_engine, text
            from pathlib import Path
            import json
            db_path = Path(__file__).parent / "quant_engine.db"
            if not db_path.exists():
                return None
            eng = create_engine(f"sqlite:///{db_path}", echo=False)
            with eng.connect() as conn:
                row = conn.execute(
                    text("SELECT value_json, expires_at FROM cache_entries WHERE key = :k"),
                    {"k": f"ticker:info:{symbol.upper()}"},
                ).fetchone()
            if row and row[0]:
                from datetime import datetime
                expires = datetime.fromisoformat(row[1]) if row[1] else None
                if expires and expires > datetime.utcnow():
                    return json.loads(row[0])
            return None
        except Exception:
            return None

    def _write_cached_info(self, symbol: str, info: dict) -> None:
        """Write ticker info dict to DB cache with 24h TTL."""
        try:
            from sqlalchemy import create_engine, text
            from pathlib import Path
            import json
            from datetime import datetime, timedelta
            db_path = Path(__file__).parent / "quant_engine.db"
            eng = create_engine(f"sqlite:///{db_path}", echo=False)
            val = json.dumps(info, default=str)
            expires = (datetime.utcnow() + timedelta(hours=24)).isoformat()
            with eng.connect() as conn:
                conn.execute(
                    text("INSERT OR REPLACE INTO cache_entries (key, value_json, expires_at, created_at, refreshed_at, source, size_bytes) "
                         "VALUES (:k, :v, :e, :now, :now, 'sectors_engine', :sz)"),
                    {"k": f"ticker:info:{symbol.upper()}", "v": val, "e": expires,
                     "now": datetime.utcnow().isoformat(), "sz": len(val)},
                )
                conn.commit()
        except Exception:
            pass

    def fetch_ticker(self, symbol: str, sector: str) -> TickerSnapshot:
        snap = TickerSnapshot(symbol=symbol, name=symbol, sector=sector)
        try:
            # ── Try cached info first ───────────────────────────────────
            info = self._read_cached_info(symbol)
            t = None
            if info is None:
                t   = yf.Ticker(symbol)
                try:
                    info = t.info or {}
                except Exception:
                    info = {}
                # Cache for future reads
                if info:
                    self._write_cached_info(symbol, info)
            else:
                logger.debug("Info cache hit for %s", symbol)

            snap.name = (info.get("shortName") or info.get("longName") or symbol)[:40]

            # ── Price from info ──────────────────────────────────────────
            snap.price      = self._sf(info.get("currentPrice") or info.get("regularMarketPrice"))
            snap.prev_close = self._sf(info.get("regularMarketPreviousClose"))
            snap.market_cap = self._sf(info.get("marketCap"), 1e9)
            snap.week52_high = self._sf(info.get("fiftyTwoWeekHigh"))
            snap.week52_low  = self._sf(info.get("fiftyTwoWeekLow"))
            snap.beta        = self._sf(info.get("beta"))
            snap.avg_volume  = self._sf(info.get("averageVolume"))
            snap.volume      = self._sf(info.get("volume"))

            if snap.price and snap.prev_close and snap.prev_close > 0:
                snap.change_1d_pct = round((snap.price - snap.prev_close) / snap.prev_close * 100, 2)
            if snap.price and snap.week52_high and snap.week52_high > 0:
                snap.pct_from_52h = round((snap.price - snap.week52_high) / snap.week52_high * 100, 2)
            if snap.price and snap.week52_low and snap.week52_low > 0:
                snap.pct_from_52l = round((snap.price - snap.week52_low) / snap.week52_low * 100, 2)
            if snap.volume and snap.avg_volume and snap.avg_volume > 0:
                snap.volume_vs_avg = round(snap.volume / snap.avg_volume, 2)

            # ── Historical returns + technicals (DB-first) ─────────────
            try:
                from technical_analysis import _load_ohlcv_from_db
                hist = _load_ohlcv_from_db(symbol, "1y", "1d")
                if hist is None and t is not None:
                    hist = t.history(period="1y", interval="1d", auto_adjust=True)
                    if hist is not None and not hist.empty:
                        hist.columns = [str(c).lower() for c in hist.columns]
                        from technical_analysis import _write_ohlcv_to_db
                        _write_ohlcv_to_db(symbol, hist)
                elif hist is None:
                    t = yf.Ticker(symbol)
                    hist = t.history(period="1y", interval="1d", auto_adjust=True)
                    if hist is not None and not hist.empty:
                        hist.columns = [str(c).lower() for c in hist.columns]
                        from technical_analysis import _write_ohlcv_to_db
                        _write_ohlcv_to_db(symbol, hist)
                if hist is not None and len(hist) > 5:
                    # Handle both capitalized (yfinance) and lowercase (DB) column names
                    _close_col = "close" if "close" in hist.columns else "Close"
                    closes = hist[_close_col].dropna().tolist()
                    snap.change_1w_pct  = self._pct_change(closes, 5)
                    snap.change_1m_pct  = self._pct_change(closes, 21)
                    snap.change_3m_pct  = self._pct_change(closes, 63)
                    ytd_days = min(datetime.now().timetuple().tm_yday, len(closes) - 1)
                    snap.change_ytd_pct = self._pct_change(closes, ytd_days)

                    if len(closes) >= 50:
                        snap.ma50 = round(sum(closes[-50:]) / 50, 2)
                    if len(closes) >= 200:
                        snap.ma200 = round(sum(closes[-200:]) / 200, 2)
                    if snap.price and snap.ma50:
                        snap.above_ma50 = snap.price > snap.ma50
                    if snap.price and snap.ma200:
                        snap.above_ma200 = snap.price > snap.ma200
                    if snap.ma50 and snap.ma200 and snap.ma200 > 0:
                        snap.ma50_vs_ma200 = round((snap.ma50 - snap.ma200) / snap.ma200 * 100, 2)

                    snap.rsi_14 = self._compute_rsi(closes[-30:] if len(closes) >= 30 else closes)
            except Exception as e:
                logger.debug("History fetch failed for %s: %s", symbol, e)

            # ── Valuation multiples ──────────────────────────────────────
            snap.pe_ratio        = self._sf(info.get("trailingPE"))
            snap.forward_pe      = self._sf(info.get("forwardPE"))
            snap.pb_ratio        = self._sf(info.get("priceToBook"))
            snap.ps_ratio        = self._sf(info.get("priceToSalesTrailing12Months"))
            snap.ev_ebitda       = self._sf(info.get("enterpriseToEbitda"))
            snap.peg_ratio       = self._sf(info.get("pegRatio"))
            snap.dividend_yield  = self._sf(info.get("dividendYield"), pct=True)

            # ── Short interest ──────────────────────────────────────────
            snap.short_ratio     = self._sf(info.get("shortRatio"))
            snap.short_pct_float = self._sf(info.get("shortPercentOfFloat"), pct=True)
            snap.shares_short    = self._sf(info.get("sharesShort"))

            # ── Fundamentals ─────────────────────────────────────────────
            snap.revenue_ttm     = self._sf(info.get("totalRevenue"), 1e9)
            snap.revenue_growth  = self._sf(info.get("revenueGrowth"), pct=True)
            snap.eps_ttm         = self._sf(info.get("trailingEps"))
            snap.eps_growth      = self._sf(info.get("earningsGrowth"), pct=True)
            snap.gross_margin    = self._sf(info.get("grossMargins"), pct=True)
            snap.operating_margin = self._sf(info.get("operatingMargins"), pct=True)
            snap.net_margin      = self._sf(info.get("profitMargins"), pct=True)
            snap.roe             = self._sf(info.get("returnOnEquity"), pct=True)
            snap.roa             = self._sf(info.get("returnOnAssets"), pct=True)
            snap.debt_to_equity  = self._sf(info.get("debtToEquity"))
            snap.current_ratio   = self._sf(info.get("currentRatio"))
            snap.free_cash_flow  = self._sf(info.get("freeCashflow"), 1e9)

            # ── Analyst consensus ─────────────────────────────────────────
            try:
                rec = t.recommendations_summary
                if rec is not None and not rec.empty:
                    row = rec.iloc[0]
                    snap.strong_buy  = int(row.get("strongBuy",  0) or 0)
                    snap.buy_count   = int(row.get("buy",        0) or 0)
                    snap.hold_count  = int(row.get("hold",       0) or 0)
                    snap.sell_count  = int(row.get("sell",       0) or 0)
                    snap.strong_sell = int(row.get("strongSell", 0) or 0)
                    snap.analyst_count = (snap.strong_buy + snap.buy_count +
                                          snap.hold_count + snap.sell_count + snap.strong_sell)
            except Exception:
                pass

            try:
                apt = t.analyst_price_targets
                if apt is not None:
                    if hasattr(apt, "to_dict"):
                        apt = apt.to_dict()
                    snap.mean_target = self._sf(apt.get("mean") or apt.get("current"))
                    snap.high_target = self._sf(apt.get("high"))
                    snap.low_target  = self._sf(apt.get("low"))
                    if snap.price and snap.mean_target and snap.price > 0:
                        snap.target_upside = round((snap.mean_target - snap.price) / snap.price * 100, 1)
            except Exception:
                pass

            snap.recommendation = info.get("recommendationKey", "") or ""

            # ── Next earnings ──────────────────────────────────────────
            try:
                cal = t.calendar
                if cal is not None:
                    if hasattr(cal, "to_dict"):
                        cal_dict = cal.T.to_dict() if hasattr(cal, "T") else {}
                    else:
                        cal_dict = cal
                    # yfinance calendar can return various shapes
                    for key in ["Earnings Date", "earningsDate"]:
                        if key in cal_dict:
                            ed = cal_dict[key]
                            if isinstance(ed, (list, tuple)):
                                ed = ed[0]
                            snap.next_earnings = str(ed)[:10]
                            break
            except Exception:
                pass

            # ── Earnings surprise streak ──────────────────────────────
            try:
                eh = t.earnings_history
                if eh is not None and not eh.empty and "surprisePercent" in eh.columns:
                    recent = eh["surprisePercent"].dropna().tail(4).tolist()
                    streak = 0
                    for sp in reversed(recent):
                        if sp > 0:
                            streak += 1
                        else:
                            break
                    miss_streak = 0
                    for sp in reversed(recent):
                        if sp < 0:
                            miss_streak += 1
                        else:
                            break
                    snap.earnings_streak = streak if streak > 0 else -miss_streak
                    if recent:
                        snap.last_eps_surprise = round(float(recent[-1]) * 100, 1)
            except Exception:
                pass

        except Exception as exc:
            snap.error = str(exc)[:200]
            logger.warning("Ticker fetch failed for %s: %s", symbol, exc)

        return snap

    # ------------------------------------------------------------------
    # Sector fetch
    # ------------------------------------------------------------------

    def fetch_sector(self, sector: str, max_workers: int = 20,
                     progress_cb=None,
                     symbol_list: Optional[list[str]] = None) -> SectorSnapshot:
        """
        Fetch all tickers for a sector.

        Args:
            symbol_list: Override the universe for this sector. If None, uses
                         the dynamic S&P 500 universe (or hardcoded fallback).
            max_workers: Thread pool size. 20 is safe for S&P 500-scale fetches.
        """
        if symbol_list is None:
            symbol_list = _get_active_universe().get(sector, [])
        etf   = SECTOR_ETF.get(sector, "")
        color = SECTOR_COLOR.get(sector, "#607D8B")

        # Pre-load ticker metadata (name, sub-industry) from sp500_universe cache
        ticker_meta: dict[str, dict] = {}
        try:
            from sp500_universe import get_sp500_universe
            univ = get_sp500_universe()
            if univ:
                ticker_meta = univ.get("ticker_info", {})
        except Exception:
            pass

        tickers: list[TickerSnapshot] = []
        done = 0

        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = {ex.submit(self.fetch_ticker, sym, sector): sym for sym in symbol_list}
            for fut in as_completed(futures):
                sym = futures[fut]
                try:
                    snap = fut.result()
                    # Enrich name + sub_industry from Wikipedia metadata if yfinance returned generic value
                    meta = ticker_meta.get(sym, {})
                    if meta.get("name") and (snap.name == sym or not snap.name):
                        snap.name = meta["name"]
                    if not hasattr(snap, "sub_industry"):
                        object.__setattr__(snap, "sub_industry", meta.get("sub_industry", ""))
                    tickers.append(snap)
                except Exception as exc:
                    tickers.append(TickerSnapshot(symbol=sym, name=sym, sector=sector,
                                                   error=str(exc)))
                done += 1
                if progress_cb:
                    progress_cb(done, len(symbol_list))

        tickers.sort(key=lambda t: t.market_cap or 0, reverse=True)

        snap = SectorSnapshot(sector=sector, etf=etf, color=color, tickers=tickers)

        # Aggregates
        caps = [t.market_cap for t in tickers if t.market_cap]
        snap.total_market_cap = round(sum(caps), 1) if caps else 0.0

        def _median(vals):
            s = sorted(v for v in vals if v is not None and not math.isnan(v))
            return s[len(s) // 2] if s else None

        snap.median_pe       = _median(t.pe_ratio   for t in tickers
                                       if t.pe_ratio and 0 < t.pe_ratio < 200)
        snap.median_pb       = _median(t.pb_ratio   for t in tickers
                                       if t.pb_ratio and 0 < t.pb_ratio < 50)
        snap.median_ev_ebitda = _median(t.ev_ebitda for t in tickers
                                        if t.ev_ebitda and 0 < t.ev_ebitda < 100)

        ch1d = [t.change_1d_pct  for t in tickers if t.change_1d_pct  is not None]
        ch1m = [t.change_1m_pct  for t in tickers if t.change_1m_pct  is not None]
        chytd= [t.change_ytd_pct for t in tickers if t.change_ytd_pct is not None]
        if ch1d:
            snap.avg_change_1d = round(sum(ch1d)  / len(ch1d),  2)
        if ch1m:
            snap.avg_change_1m = round(sum(ch1m)  / len(ch1m),  2)
        if chytd:
            snap.avg_change_ytd= round(sum(chytd) / len(chytd), 2)

        snap.breadth_up   = sum(1 for t in tickers if (t.change_1d_pct or 0) > 0)
        snap.breadth_down = sum(1 for t in tickers if (t.change_1d_pct or 0) < 0)

        # ETF data
        try:
            etf_t = yf.Ticker(etf)
            etf_hist = etf_t.history(period="1y", interval="1d", auto_adjust=True)
            if etf_hist is not None and len(etf_hist) > 5:
                c = etf_hist["Close"].dropna().tolist()
                snap.etf_price      = round(c[-1], 2)
                snap.etf_change_1d  = self._pct_change(c, 1)
                snap.etf_change_1m  = self._pct_change(c, 21)
                snap.etf_change_3m  = self._pct_change(c, 63)
                ytd_n = min(datetime.now().timetuple().tm_yday, len(c) - 1)
                snap.etf_change_ytd = self._pct_change(c, ytd_n)
        except Exception:
            pass

        # Valuation scoring (peer-relative percentile)
        self._score_valuations(snap)
        # Composite signal
        self._score_signals(snap)

        return snap

    def _score_valuations(self, snap: SectorSnapshot) -> None:
        """Rank each ticker's valuation vs sector peers. val_score: +2=cheapest, -2=most expensive."""
        def percentile_rank(value, pool):
            if value is None or not pool:
                return None
            below = sum(1 for v in pool if v < value)
            return below / len(pool)

        pe_pool  = [t.pe_ratio   for t in snap.tickers if t.pe_ratio   and 0 < t.pe_ratio   < 200]
        pb_pool  = [t.pb_ratio   for t in snap.tickers if t.pb_ratio   and 0 < t.pb_ratio   < 50]
        ps_pool  = [t.ps_ratio   for t in snap.tickers if t.ps_ratio   and 0 < t.ps_ratio   < 100]
        ev_pool  = [t.ev_ebitda  for t in snap.tickers if t.ev_ebitda  and 0 < t.ev_ebitda  < 100]
        fpe_pool = [t.forward_pe for t in snap.tickers if t.forward_pe and 0 < t.forward_pe < 150]

        for ticker in snap.tickers:
            ranks = []
            for val, pool in [
                (ticker.pe_ratio,   pe_pool),
                (ticker.pb_ratio,   pb_pool),
                (ticker.ps_ratio,   ps_pool),
                (ticker.ev_ebitda,  ev_pool),
                (ticker.forward_pe, fpe_pool),
            ]:
                r = percentile_rank(val, pool)
                if r is not None:
                    ranks.append(r)

            if not ranks:
                ticker.val_score = None
                ticker.val_label = "UNKNOWN"
                continue

            avg_rank = sum(ranks) / len(ranks)  # 0 = cheapest, 1 = most expensive
            ticker.val_score = round(2.0 - avg_rank * 4.0, 2)  # +2 to -2

            if ticker.val_score >= 0.75:
                ticker.val_label = "UNDERVALUED"
            elif ticker.val_score <= -0.75:
                ticker.val_label = "OVERVALUED"
            else:
                ticker.val_label = "FAIR"

    def _score_signals(self, snap: SectorSnapshot) -> None:
        """
        Composite signal score combining valuation, momentum, RSI, analyst, earnings.
        signal_score: +3 = very strong buy signal, -3 = very strong sell signal
        """
        for t in snap.tickers:
            score = 0.0
            count = 0

            # Valuation component (+1 to -1)
            if t.val_score is not None:
                score += max(-1.0, min(1.0, t.val_score / 2.0))
                count += 1

            # Momentum component: 1M return vs sector median
            if t.change_1m_pct is not None and snap.avg_change_1m is not None:
                rel = t.change_1m_pct - snap.avg_change_1m
                score += max(-1.0, min(1.0, rel / 10.0))
                count += 1

            # RSI component: oversold = +1, overbought = -1
            if t.rsi_14 is not None:
                if t.rsi_14 < 30:
                    score += 1.0
                elif t.rsi_14 < 40:
                    score += 0.5
                elif t.rsi_14 > 70:
                    score -= 1.0
                elif t.rsi_14 > 60:
                    score -= 0.5
                count += 1

            # Analyst component: buy% - sell% scaled
            if t.analyst_count > 0:
                bull_frac = (t.strong_buy + t.buy_count) / t.analyst_count
                bear_frac = (t.sell_count + t.strong_sell) / t.analyst_count
                score += max(-1.0, min(1.0, (bull_frac - bear_frac) * 2.0))
                count += 1

            # Price target upside
            if t.target_upside is not None:
                score += max(-1.0, min(1.0, t.target_upside / 25.0))
                count += 1

            # Earnings streak
            if t.earnings_streak != 0:
                score += max(-1.0, min(1.0, t.earnings_streak / 3.0))
                count += 1

            if count > 0:
                raw = score / count * 3.0  # scale to ±3
                t.signal_score = round(max(-3.0, min(3.0, raw)), 2)
                if t.signal_score >= 1.5:
                    t.signal_label = "STRONG BUY"
                elif t.signal_score >= 0.5:
                    t.signal_label = "BUY"
                elif t.signal_score <= -1.5:
                    t.signal_label = "STRONG SELL"
                elif t.signal_score <= -0.5:
                    t.signal_label = "SELL"
                else:
                    t.signal_label = "NEUTRAL"
            else:
                t.signal_score = None
                t.signal_label = "NO DATA"


# ── Sector Store ──────────────────────────────────────────────────────────────

class SectorStore:
    """JSON-based persistence for sector snapshots."""

    def __init__(self, data_dir: Path):
        self._dir = data_dir / "sectors"
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, sector: str) -> Path:
        safe = sector.replace(" ", "_").replace("/", "_")
        return self._dir / f"{safe}_latest.json"

    def save(self, sector: str, snap: SectorSnapshot) -> Path:
        path = self._path(sector)
        path.write_text(json.dumps(asdict(snap), default=str), encoding="utf-8")
        return path

    def load(self, sector: str) -> Optional[SectorSnapshot]:
        path = self._path(sector)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            tickers = [TickerSnapshot(**tk) for tk in data.pop("tickers", [])]
            return SectorSnapshot(tickers=tickers, **data)
        except Exception as exc:
            logger.warning("Failed to load sector %s: %s", sector, exc)
            return None

    def all_summaries(self) -> list[dict]:
        """Lightweight summaries of all cached sectors for the overview grid."""
        summaries = []
        for sector in SECTOR_UNIVERSE:
            snap = self.load(sector)
            if not snap:
                summaries.append({
                    "sector": sector, "etf": SECTOR_ETF.get(sector, ""),
                    "color": SECTOR_COLOR.get(sector, "#607D8B"), "cached": False,
                })
                continue
            tickers = snap.tickers
            leaders  = sorted([t for t in tickers if t.change_1d_pct is not None],
                               key=lambda t: t.change_1d_pct, reverse=True)[:3]
            laggards = sorted([t for t in tickers if t.change_1d_pct is not None],
                               key=lambda t: t.change_1d_pct)[:3]
            under = [t.symbol for t in tickers if t.val_label == "UNDERVALUED"][:4]
            over  = [t.symbol for t in tickers if t.val_label == "OVERVALUED"][:4]
            summaries.append({
                "sector":           sector,
                "etf":              snap.etf,
                "color":            snap.color,
                "cached":           True,
                "total_market_cap": snap.total_market_cap,
                "ticker_count":     len(tickers),
                "avg_change_1d":    snap.avg_change_1d,
                "avg_change_1m":    snap.avg_change_1m,
                "avg_change_ytd":   snap.avg_change_ytd,
                "etf_price":        snap.etf_price,
                "etf_change_1d":    snap.etf_change_1d,
                "etf_change_ytd":   snap.etf_change_ytd,
                "median_pe":        snap.median_pe,
                "breadth_up":       snap.breadth_up,
                "breadth_down":     snap.breadth_down,
                "leaders":          [{"symbol": t.symbol, "chg": t.change_1d_pct} for t in leaders],
                "laggards":         [{"symbol": t.symbol, "chg": t.change_1d_pct} for t in laggards],
                "undervalued":      under,
                "overvalued":       over,
                "snapshot_at":      snap.snapshot_at,
            })
        return summaries

    def list_sectors(self) -> list[str]:
        return [s for s in SECTOR_UNIVERSE if self._path(s).exists()]


# ── Ticker Deep-Dive ──────────────────────────────────────────────────────────

def get_ticker_deep_dive(symbol: str) -> dict:
    """
    Full quarterly financials, earnings history, analyst upgrades/downgrades,
    and management context for a single ticker.
    """
    result: dict = {"symbol": symbol, "fetched_at": datetime.utcnow().isoformat()}
    t = yf.Ticker(symbol)

    # ── Quarterly income statement ────────────────────────────────────
    try:
        qf = t.quarterly_financials
        if qf is not None and not qf.empty:
            quarters = []
            for col in list(qf.columns)[:8]:
                q = {"period": str(col)[:10]}
                for row_key, fname in [
                    ("Total Revenue",    "revenue"),
                    ("Net Income",       "net_income"),
                    ("Gross Profit",     "gross_profit"),
                    ("Operating Income", "operating_income"),
                    ("EBITDA",           "ebitda"),
                    ("Basic EPS",        "eps"),
                ]:
                    if row_key in qf.index:
                        val = qf.loc[row_key, col]
                        try:
                            fv = float(val)
                            q[fname] = None if (math.isnan(fv) or math.isinf(fv)) else (
                                round(fv / 1e9, 3) if fname in ("revenue","net_income","gross_profit",
                                                                  "operating_income","ebitda")
                                else round(fv, 3)
                            )
                        except (TypeError, ValueError):
                            q[fname] = None
                quarters.append(q)
            result["quarterly_income"] = quarters
    except Exception as exc:
        result["quarterly_income"] = []
        logger.debug("quarterly_financials failed for %s: %s", symbol, exc)

    # ── Quarterly balance sheet ───────────────────────────────────────
    try:
        qbs = t.quarterly_balance_sheet
        if qbs is not None and not qbs.empty:
            quarters = []
            for col in list(qbs.columns)[:8]:
                q = {"period": str(col)[:10]}
                for row_key, fname in [
                    ("Total Assets",                              "total_assets"),
                    ("Total Liabilities Net Minority Interest",   "total_liabilities"),
                    ("Total Equity Gross Minority Interest",      "total_equity"),
                    ("Cash And Cash Equivalents",                 "cash"),
                    ("Long Term Debt",                            "long_term_debt"),
                ]:
                    if row_key in qbs.index:
                        val = qbs.loc[row_key, col]
                        try:
                            fv = float(val)
                            q[fname] = None if (math.isnan(fv) or math.isinf(fv)) else round(fv / 1e9, 3)
                        except (TypeError, ValueError):
                            q[fname] = None
                quarters.append(q)
            result["quarterly_balance"] = quarters
    except Exception as exc:
        result["quarterly_balance"] = []
        logger.debug("quarterly_balance_sheet failed for %s: %s", symbol, exc)

    # ── Quarterly cash flow ───────────────────────────────────────────
    try:
        qcf = t.quarterly_cashflow
        if qcf is not None and not qcf.empty:
            quarters = []
            for col in list(qcf.columns)[:8]:
                q = {"period": str(col)[:10]}
                for row_key, fname in [
                    ("Operating Cash Flow",        "operating_cf"),
                    ("Free Cash Flow",             "free_cf"),
                    ("Capital Expenditure",        "capex"),
                    ("Repurchase Of Capital Stock","buybacks"),
                    ("Cash Dividends Paid",        "dividends_paid"),
                ]:
                    if row_key in qcf.index:
                        val = qcf.loc[row_key, col]
                        try:
                            fv = float(val)
                            q[fname] = None if (math.isnan(fv) or math.isinf(fv)) else round(fv / 1e9, 3)
                        except (TypeError, ValueError):
                            q[fname] = None
                quarters.append(q)
            result["quarterly_cashflow"] = quarters
    except Exception:
        result["quarterly_cashflow"] = []

    # ── Earnings history (EPS actual vs estimate + surprise) ─────────
    try:
        eh = t.earnings_history
        if eh is not None and not eh.empty:
            rows = []
            for idx, row in eh.tail(8).iterrows():
                def sf(k):
                    v = row.get(k)
                    try:
                        fv = float(v)
                        return None if (math.isnan(fv) or math.isinf(fv)) else round(fv, 3)
                    except (TypeError, ValueError):
                        return None
                rows.append({
                    "period":       str(idx)[:10],
                    "eps_actual":   sf("epsActual"),
                    "eps_estimate": sf("epsEstimate"),
                    "surprise_pct": round(float(row["surprisePercent"]) * 100, 1)
                                    if "surprisePercent" in row and row["surprisePercent"] is not None
                                    else None,
                })
            result["earnings_history"] = rows
    except Exception:
        result["earnings_history"] = []

    # ── Analyst upgrades / downgrades (last 15) ───────────────────────
    try:
        ud = t.upgrades_downgrades
        if ud is not None and not ud.empty:
            result["upgrades_downgrades"] = [
                {
                    "date":       str(idx)[:10],
                    "firm":       str(row.get("Firm",      "")),
                    "to_grade":   str(row.get("ToGrade",   "")),
                    "from_grade": str(row.get("FromGrade", "")),
                    "action":     str(row.get("Action",    "")),
                }
                for idx, row in ud.head(15).iterrows()
            ]
    except Exception:
        result["upgrades_downgrades"] = []

    # ── Analyst price targets ─────────────────────────────────────────
    try:
        apt = t.analyst_price_targets
        if apt is not None:
            if hasattr(apt, "to_dict"):
                apt = apt.to_dict()
            result["price_targets"] = {
                k: (None if v is None or (isinstance(v, float) and math.isnan(v))
                    else round(float(v), 2))
                for k, v in apt.items()
                if k in ("current", "low", "mean", "high", "numberOfAnalysts")
            }
    except Exception:
        result["price_targets"] = {}

    # ── Calendar: next earnings, ex-dividend ─────────────────────────
    try:
        cal = t.calendar
        if cal is not None:
            if hasattr(cal, "to_dict"):
                # yfinance returns a DataFrame — transpose to get a usable dict
                try:
                    cal_dict = {str(k): str(v) for k, v in cal.items()}
                except Exception:
                    cal_dict = {}
            else:
                cal_dict = {str(k): str(v) for k, v in cal.items()}
            result["calendar"] = cal_dict
    except Exception:
        result["calendar"] = {}

    # ── Recent news (for management commentary / headline context) ────
    try:
        news = t.news or []
        result["recent_news"] = [
            {
                "title":     n.get("title", ""),
                "publisher": n.get("publisher", ""),
                "link":      n.get("link", ""),
                "published": datetime.fromtimestamp(
                    n["providerPublishTime"], tz=timezone.utc
                ).strftime("%Y-%m-%d %H:%M") if n.get("providerPublishTime") else "",
            }
            for n in news[:10]
        ]
    except Exception:
        result["recent_news"] = []

    # ── SEC EDGAR: 10-15 year annual financials + recent filings ─────
    try:
        from sp500_universe import get_cik
        from sec_feed import SecFeed
        cik = get_cik(symbol)
        if cik:
            feed = SecFeed()
            # Annual historical financials (non-blocking — cache hit is fast)
            sec_facts = feed.company_facts(cik)
            if sec_facts:
                result["sec_annual"] = {
                    "entity_name":               sec_facts.get("entity_name", ""),
                    "fetched_at":                sec_facts.get("fetched_at", ""),
                    "revenue_annual":            sec_facts.get("revenue_annual", []),
                    "net_income_annual":         sec_facts.get("net_income_annual", []),
                    "eps_annual":                sec_facts.get("eps_annual", []),
                    "op_income_annual":          sec_facts.get("op_income_annual", []),
                    "gross_profit_annual":       sec_facts.get("gross_profit_annual", []),
                    "total_assets_annual":       sec_facts.get("total_assets_annual", []),
                    "lt_debt_annual":            sec_facts.get("lt_debt_annual", []),
                    "cash_annual":               sec_facts.get("cash_annual", []),
                    "rd_expense_annual":         sec_facts.get("rd_expense_annual", []),
                    "capex_annual":              sec_facts.get("capex_annual", []),
                    "eps_quarterly":             sec_facts.get("eps_quarterly", []),
                    "revenue_quarterly":         sec_facts.get("revenue_quarterly", []),
                    "net_income_quarterly":      sec_facts.get("net_income_quarterly", []),
                    "shares_outstanding_annual": sec_facts.get("shares_outstanding_annual", []),
                }
            # Recent SEC filings (8-K, 10-K, 10-Q)
            filings = feed.recent_filings(cik, limit=15)
            result["sec_filings"] = filings
            result["cik"] = cik
    except Exception as exc:
        logger.debug("SEC EDGAR integration failed for %s: %s", symbol, exc)
        result["sec_annual"]  = None
        result["sec_filings"] = []

    return result
