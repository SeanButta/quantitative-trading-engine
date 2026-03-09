"""
Options Chain Feed
==================
Fetches live options chains from yfinance, enriches every contract with
all 5 Black-Scholes Greeks (Δ, Γ, Θ, ν, ρ), and persists snapshots as
Parquet files.

Not financial advice. Markets involve risk.
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Callable

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# S&P 500 Universe (~500 tickers)
# ---------------------------------------------------------------------------

SP500_UNIVERSE: list[str] = [
    "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB",
    "AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL","GOOG","MO","AMZN",
    "AMCR","AEE","AAL","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN",
    "APH","ADI","ANSS","AON","APA","AAPL","AMAT","APTV","ACGL","ADM","ANET",
    "AJG","AIZ","T","ATO","ADSK","AZO","AVB","AVY","AXON","BKR","BALL","BAC",
    "BBWI","BAX","BDX","BRK.B","BBY","BIO","TECH","BIIB","BLK","BX","BK",
    "BA","BKNG","BWA","BXP","BSX","BMY","AVGO","BR","BRO","BF.B","BLDR","BG",
    "CHRW","CDNS","CZR","CPT","CPB","COF","CAH","CARR","CTLT","CAT","CBOE",
    "CBRE","CDW","CE","CNC","CNP","CF","CHTR","CME","CMS","CB","COO","CTSH",
    "C","CINF","CTAS","CSCO","CFG","CLX","CMG","CLDD","CMI","CCI","CSX",
    "CRL","CEG","CL","CMCSA","CMA","CAG","COP","ED","STZ","CEG","CPAY","CPRT",
    "COR","COST","CTRA","CRWD","CCI","CVS","CVX","DHI","DHR","DRI","DVA",
    "DAY","DECK","DE","DAL","XRAY","DVN","DXCM","FANG","DLR","DFS","DG",
    "DLTR","D","DPZ","DOW","DOC","DTE","DUK","DD","EMN","ETN","EBAY","ECL",
    "EIX","EW","EA","ELV","LLY","EMR","ENPH","ETR","EOG","EPAM","EFX","EQIX",
    "EQR","EQT","ESS","EL","EG","EVRG","ES","EXC","EXPE","EXPD","EXR","FFIV",
    "FDS","FICO","FAST","FRT","FDX","FIS","FITB","FSLR","FE","FI","FMC",
    "F","FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN","IT","GEHC","GEN","GNRC",
    "GD","GE","GIS","GM","GPC","GILD","GPN","GL","GEV","GDDY","GS","HAL",
    "HIG","HAS","HCA","DOC","PEAK","HSIC","HSY","HES","HPE","HLT","HOLX",
    "HD","HON","HRL","HST","HWM","HPQ","HUBB","HUM","HBAN","HII","IBM","IEX",
    "IDXX","ITW","ILMN","INCY","IR","PODD","INTC","ICE","IFF","IP","IPG",
    "INVH","IVZ","IPGP","IQV","IRM","ISRG","J","JBHT","JBL","JCI","JKHY",
    "J","JNJ","JCI","JPM","JNPR","K","KVUE","KDP","KEY","KEYS","KMB","KIM",
    "KMI","KLAC","KHC","KR","LHX","LH","LRCX","LW","LVS","LDOS","LEN","LIN",
    "LYV","LKQ","LMT","L","LOW","LULU","LYB","MTB","MRO","MPC","MKTX","MAR",
    "MMC","MLM","MAS","MA","MKC","MCD","MCK","MDT","MET","META","MGM","MHK",
    "MOH","TAP","MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSFT","MU",
    "NDAQ","NTAP","NFLX","NWS","NWSA","NEE","NKE","NI","NOC","NXPI","NTRS",
    "NOC","NRG","NUE","NVDA","NVR","NOW","O","OXY","ODFL","OMC","ON","OKE",
    "ORCL","OTIS","ORLY","PCAR","PKG","PANW","PARA","PH","PAYX","PAYC","PYPL",
    "PNR","PBCT","PEP","PKI","PFE","PCG","PM","PSX","PNW","PXD","PNC","POOL",
    "PPG","PPL","PFG","PG","PGR","PLD","PRU","PEG","PSA","PHM","QRVO","PWR",
    "QCOM","DGX","RL","RJF","RTX","O","REG","REGN","RF","RSG","RMD","RHI",
    "ROK","ROL","ROP","ROST","RCL","SPGI","CRM","SBAC","SLB","STX","SEE",
    "SRE","NOW","SHW","SPG","SWKS","SJM","SNA","SEDG","SO","LUV","SWK","SBUX",
    "STE","SYK","SMCI","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TRGP",
    "TDY","TEL","TDG","TER","TSLA","TXN","TXT","TMO","TJX","TSCO","TT",
    "TFC","TRV","TYL","TSN","USB","UDR","ULTA","UNP","UAL","UPS","URI","UNH",
    "UHS","VLO","VTR","VRSN","VRSK","VZ","VRTX","VICI","V","VST","VNO","VMC",
    "WRB","GWW","WAB","WBA","WMT","WBD","WDAY","WEC","WFC","WELL","WST","WDC",
    "WM","WY","WMB","WTW","WYNN","XEL","XOM","XYL","YUM","ZBRA","ZBH","ZION",
    "ZTS","SPY","QQQ","IWM","DIA","GLD","TLT","VXX","EEM","EFA","HYG",
    "ARKK","XLF","XLK","XLE","XLV","XLI","XLB","XLRE","XLP","XLU","XLY",
]

# De-duplicate while preserving order
_seen: set[str] = set()
SP500_UNIVERSE = [s for s in SP500_UNIVERSE if not (_seen.add(s) or s in _seen - {s})]


# ---------------------------------------------------------------------------
# Greeks helpers
# ---------------------------------------------------------------------------

def _compute_greeks(
    spot: float,
    strike: float,
    T: float,
    rfr: float,
    iv: float,
    option_type: str,
) -> dict:
    """Compute all 5 BS Greeks. Returns dict with NaN fields on failure."""
    nan = float("nan")
    empty = dict(delta=nan, gamma=nan, theta=nan, vega=nan, rho=nan)
    try:
        from stochastic_finance import BlackScholes
        if T <= 0 or iv <= 0 or spot <= 0 or strike <= 0:
            return empty
        iv = min(iv, 20.0)  # cap extreme IVs
        res = BlackScholes.price(spot, strike, T, rfr, iv, option_type)
        return dict(
            delta=res.delta,
            gamma=res.gamma,
            theta=res.theta,
            vega=res.vega,
            rho=res.rho,
        )
    except Exception as exc:
        logger.debug("Greeks failed for %s/%.1f/%.4f/%s: %s", option_type, strike, iv, T, exc)
        return empty


# ---------------------------------------------------------------------------
# OptionsProvider
# ---------------------------------------------------------------------------

class OptionsProvider:
    """Fetches options chains from yfinance and enriches with BS Greeks."""

    def fetch_chain(self, symbol: str, rfr: float = 0.05) -> pl.DataFrame:
        """
        Fetch the full options chain for one symbol (all expirations, calls+puts).
        Returns an empty DataFrame on any failure — never raises.
        """
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError("yfinance not installed. Run: pip install yfinance")

        try:
            ticker = yf.Ticker(symbol)

            # Spot price
            try:
                spot = float(ticker.fast_info["lastPrice"])
            except Exception:
                hist = ticker.history(period="2d")
                if hist.empty:
                    logger.warning("No price data for %s", symbol)
                    return _empty_chain_df()
                spot = float(hist["Close"].iloc[-1])

            if spot <= 0 or math.isnan(spot):
                return _empty_chain_df()

            expirations = ticker.options
            if not expirations:
                return _empty_chain_df()

            today = date.today()
            snapshot_ts = datetime.utcnow().replace(microsecond=0)
            rows: list[dict] = []

            for exp_str in expirations:
                try:
                    exp_date = date.fromisoformat(exp_str)
                    T = max((exp_date - today).days / 365.0, 0.0)
                    chain = ticker.option_chain(exp_str)

                    for opt_type, df_side in [("call", chain.calls), ("put", chain.puts)]:
                        for _, row in df_side.iterrows():
                            iv = float(row.get("impliedVolatility", 0) or 0)
                            strike = float(row.get("strike", 0) or 0)
                            greeks = _compute_greeks(spot, strike, T, rfr, iv, opt_type)
                            rows.append({
                                "symbol":          symbol,
                                "snapshot_at":     snapshot_ts,
                                "expiration":      exp_str,
                                "option_type":     opt_type,
                                "spot":            spot,
                                "strike":          strike,
                                "bid":             float(row.get("bid", 0) or 0),
                                "ask":             float(row.get("ask", 0) or 0),
                                "last_price":      float(row.get("lastPrice", 0) or 0),
                                "volume":          int(row.get("volume", 0) or 0),
                                "open_interest":   int(row.get("openInterest", 0) or 0),
                                "implied_vol":     iv,
                                "in_the_money":    bool(row.get("inTheMoney", False)),
                                "delta":           greeks["delta"],
                                "gamma":           greeks["gamma"],
                                "theta":           greeks["theta"],
                                "vega":            greeks["vega"],
                                "rho":             greeks["rho"],
                            })
                except Exception as exp_err:
                    logger.debug("Skipping %s expiry %s: %s", symbol, exp_str, exp_err)
                    continue

            if not rows:
                return _empty_chain_df()

            df = pl.DataFrame(rows).with_columns(
                pl.col("snapshot_at").cast(pl.Datetime("us")),
            )
            logger.info("Fetched %d contracts for %s across %d expirations",
                        len(df), symbol, df["expiration"].n_unique())
            return df

        except Exception as exc:
            logger.error("fetch_chain failed for %s: %s", symbol, exc)
            return _empty_chain_df()

    def fetch_universe(
        self,
        symbols: list[str],
        rfr: float = 0.05,
        max_workers: int = 15,
        progress_cb: Callable[[str, bool], None] | None = None,
    ) -> dict:
        """
        Parallel fetch for a list of symbols.
        Returns:
          {
            "data":      {symbol: pl.DataFrame},
            "errors":    {symbol: error_message},
            "completed": int,
            "total":     int,
          }
        """
        results: dict[str, pl.DataFrame] = {}
        errors:  dict[str, str] = {}

        def _fetch_one(sym: str):
            df = self.fetch_chain(sym, rfr=rfr)
            return sym, df

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_fetch_one, s): s for s in symbols}
            for fut in as_completed(futures):
                sym = futures[fut]
                try:
                    _, df = fut.result()
                    if df.is_empty():
                        errors[sym] = "no data returned"
                    else:
                        results[sym] = df
                except Exception as exc:
                    errors[sym] = str(exc)

                if progress_cb:
                    progress_cb(sym, sym not in errors)

        return {
            "data":      results,
            "errors":    errors,
            "completed": len(results),
            "total":     len(symbols),
        }


# ---------------------------------------------------------------------------
# OptionsStore
# ---------------------------------------------------------------------------

class OptionsStore:
    """Stores and loads options chain snapshots as Parquet files."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir) / "options"
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, symbol: str) -> Path:
        return self.data_dir / f"{symbol.upper()}_latest.parquet"

    def _prev_path(self, symbol: str) -> Path:
        return self.data_dir / f"{symbol.upper()}_prev.parquet"

    def save(self, symbol: str, df: pl.DataFrame) -> Path:
        path = self._path(symbol)
        prev_path = self._prev_path(symbol)
        # Rotate: copy current latest → prev before writing new snapshot
        if path.exists():
            import shutil
            shutil.copy2(path, prev_path)
        df.write_parquet(path)
        logger.info("Saved %d rows → %s", len(df), path)
        return path

    def load_prev(self, symbol: str) -> pl.DataFrame:
        """Load the previous (pre-rotation) snapshot for ΔOI computation."""
        path = self._prev_path(symbol)
        if not path.exists():
            return _empty_chain_df()
        return pl.read_parquet(path)

    def load(self, symbol: str) -> pl.DataFrame:
        path = self._path(symbol)
        if not path.exists():
            return _empty_chain_df()
        return pl.read_parquet(path)

    def load_expiration(self, symbol: str, expiration: str) -> pl.DataFrame:
        df = self.load(symbol)
        if df.is_empty():
            return df
        return df.filter(pl.col("expiration") == expiration)

    def list_symbols(self) -> list[str]:
        return sorted(p.stem.replace("_latest", "") for p in self.data_dir.glob("*_latest.parquet"))

    def list_expirations(self, symbol: str) -> list[str]:
        df = self.load(symbol)
        if df.is_empty():
            return []
        return sorted(df["expiration"].unique().to_list())

    def snapshot_time(self, symbol: str) -> str | None:
        df = self.load(symbol)
        if df.is_empty():
            return None
        ts = df["snapshot_at"].max()
        return str(ts) if ts is not None else None

    def greeks_summary(self, symbol: str, expiration: str | None = None) -> dict:
        """Aggregate Greeks across the chain for a symbol (optionally one expiry)."""
        df = self.load(symbol)
        if df.is_empty():
            return {}

        if expiration:
            df = df.filter(pl.col("expiration") == expiration)

        calls = df.filter(pl.col("option_type") == "call")
        puts  = df.filter(pl.col("option_type") == "put")

        def _safe(series) -> float | None:
            vals = series.drop_nulls().to_list()
            vals = [v for v in vals if not math.isnan(v)]
            return float(np.nanmean(vals)) if vals else None

        # Max gamma strike (highest gamma = most sensitive ATM area)
        gamma_col = df.filter(~pl.col("gamma").is_nan())
        max_gamma_strike = None
        if not gamma_col.is_empty():
            idx = gamma_col["gamma"].arg_max()
            if idx is not None:
                max_gamma_strike = float(gamma_col["strike"][idx])

        total_call_oi = int(calls["open_interest"].sum()) if not calls.is_empty() else 0
        total_put_oi  = int(puts["open_interest"].sum())  if not puts.is_empty()  else 0
        pcr = (total_put_oi / total_call_oi) if total_call_oi > 0 else None

        return {
            "symbol":           symbol,
            "expiration":       expiration,
            "snapshot_at":      self.snapshot_time(symbol),
            "total_contracts":  len(df),
            "total_call_oi":    total_call_oi,
            "total_put_oi":     total_put_oi,
            "put_call_ratio":   pcr,
            "max_gamma_strike": max_gamma_strike,
            "avg_call_delta":   _safe(calls["delta"]) if not calls.is_empty() else None,
            "avg_put_delta":    _safe(puts["delta"])  if not puts.is_empty()  else None,
            "avg_iv_call":      _safe(calls["implied_vol"]) if not calls.is_empty() else None,
            "avg_iv_put":       _safe(puts["implied_vol"])  if not puts.is_empty()  else None,
        }


# ---------------------------------------------------------------------------
# Advanced Analytics
# ---------------------------------------------------------------------------

def compute_analytics(
    symbol: str,
    df: pl.DataFrame,
    df_prev: pl.DataFrame,
    spot: float,
    price_history: list[dict],
) -> dict:
    """
    Compute advanced options analytics:
      - IVR (IV Rank), IVP (IV Percentile) via rolling HV proxy
      - HV20, HV30  (annualised historical volatility)
      - IV/HV spread (volatility risk premium proxy)
      - GEX per strike (Gamma Exposure — dealer positioning)
      - Max Pain strike
      - ΔOI (open-interest change vs previous snapshot)

    All inputs safe to be empty / zero.
    """
    result: dict = {}

    # ── 1. Historical volatility + IVR / IVP ────────────────────────────────
    closes = [p["close"] for p in price_history if p.get("close") is not None]
    if len(closes) >= 21:
        log_rets = np.diff(np.log(np.array(closes, dtype=float)))
        hv20 = float(np.std(log_rets[-20:]) * np.sqrt(252)) if len(log_rets) >= 20 else None
        hv30 = float(np.std(log_rets[-30:]) * np.sqrt(252)) if len(log_rets) >= 30 else None
        result["hv20"] = hv20
        result["hv30"] = hv30

        # Current ATM IV (delta ≈ 0.5)
        current_iv: float | None = None
        if not df.is_empty():
            atm = df.filter(
                (pl.col("delta").abs() >= 0.35) & (pl.col("delta").abs() <= 0.65)
            )
            if not atm.is_empty():
                iv_vals = atm["implied_vol"].drop_nulls().to_list()
                iv_vals = [v for v in iv_vals if not (math.isnan(v) or v <= 0)]
                if iv_vals:
                    current_iv = float(np.median(iv_vals))

        result["current_iv"] = current_iv

        if current_iv and hv30 is not None:
            result["iv_hv_spread"] = current_iv - hv30
        else:
            result["iv_hv_spread"] = None

        # Rolling 30-day HV windows to compute IVR / IVP
        if current_iv and len(log_rets) >= 30:
            hv_windows: list[float] = []
            for i in range(30, len(log_rets) + 1):
                w = log_rets[i - 30 : i]
                hv_windows.append(float(np.std(w) * np.sqrt(252)))
            if hv_windows:
                hv_min = min(hv_windows)
                hv_max = max(hv_windows)
                result["iv_rank"] = (
                    (current_iv - hv_min) / (hv_max - hv_min)
                    if hv_max > hv_min
                    else None
                )
                result["iv_percentile"] = sum(
                    1 for h in hv_windows if h < current_iv
                ) / len(hv_windows)

    # ── 2. Gamma Exposure (GEX) per strike ──────────────────────────────────
    if not df.is_empty() and spot > 0:
        gex_rows: list[dict] = []
        for strike in sorted(df["strike"].unique().to_list()):
            s_df = df.filter(pl.col("strike") == strike)
            calls_s = s_df.filter(pl.col("option_type") == "call")
            puts_s = s_df.filter(pl.col("option_type") == "put")

            call_gex = 0.0
            if not calls_s.is_empty():
                g_vals = [v for v in calls_s["gamma"].to_list() if v is not None and not math.isnan(v)]
                oi = int(calls_s["open_interest"].sum())
                if g_vals and oi > 0:
                    call_gex = float(np.mean(g_vals)) * oi * spot ** 2 * 0.01 * 100

            put_gex = 0.0
            if not puts_s.is_empty():
                g_vals = [v for v in puts_s["gamma"].to_list() if v is not None and not math.isnan(v)]
                oi = int(puts_s["open_interest"].sum())
                if g_vals and oi > 0:
                    put_gex = -(float(np.mean(g_vals)) * oi * spot ** 2 * 0.01 * 100)

            net_gex = call_gex + put_gex
            gex_rows.append(
                {"strike": strike, "call_gex": call_gex, "put_gex": put_gex, "net_gex": net_gex}
            )
        result["gex"] = gex_rows

    # ── 3. Max Pain ──────────────────────────────────────────────────────────
    if not df.is_empty():
        strikes_arr = np.array(sorted(df["strike"].unique().to_list()), dtype=float)
        calls_mp = df.filter(pl.col("option_type") == "call")
        puts_mp  = df.filter(pl.col("option_type") == "put")

        c_strikes = np.array(calls_mp["strike"].to_list(), dtype=float) if not calls_mp.is_empty() else np.array([])
        c_oi      = np.array(calls_mp["open_interest"].to_list(), dtype=float) if not calls_mp.is_empty() else np.array([])
        p_strikes = np.array(puts_mp["strike"].to_list(), dtype=float)  if not puts_mp.is_empty()  else np.array([])
        p_oi      = np.array(puts_mp["open_interest"].to_list(), dtype=float)  if not puts_mp.is_empty()  else np.array([])

        best_k, best_loss = None, float("inf")
        for k in strikes_arr:
            loss = 0.0
            if len(c_strikes):
                loss += float(np.sum(np.maximum(0.0, k - c_strikes) * c_oi)) * 100
            if len(p_strikes):
                loss += float(np.sum(np.maximum(0.0, p_strikes - k) * p_oi)) * 100
            if loss < best_loss:
                best_loss, best_k = loss, k
        result["max_pain"] = float(best_k) if best_k is not None else None

    # ── 4. ΔOI vs previous snapshot ─────────────────────────────────────────
    if not df.is_empty() and not df_prev.is_empty():
        delta_oi: list[dict] = []
        for strike in df["strike"].unique().to_list():
            for opt_type in ("call", "put"):
                cur = df.filter(
                    (pl.col("strike") == strike) & (pl.col("option_type") == opt_type)
                )
                prv = df_prev.filter(
                    (pl.col("strike") == strike) & (pl.col("option_type") == opt_type)
                )
                if not cur.is_empty():
                    cur_oi = int(cur["open_interest"].sum())
                    prv_oi = int(prv["open_interest"].sum()) if not prv.is_empty() else 0
                    d_oi = cur_oi - prv_oi
                    if d_oi != 0:
                        delta_oi.append(
                            {
                                "strike": strike,
                                "option_type": opt_type,
                                "current_oi": cur_oi,
                                "prev_oi": prv_oi,
                                "delta_oi": d_oi,
                            }
                        )
        result["delta_oi"] = sorted(delta_oi, key=lambda x: abs(x["delta_oi"]), reverse=True)[:20]

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _empty_chain_df() -> pl.DataFrame:
    return pl.DataFrame(schema={
        "symbol":        pl.Utf8,
        "snapshot_at":   pl.Datetime("us"),
        "expiration":    pl.Utf8,
        "option_type":   pl.Utf8,
        "spot":          pl.Float64,
        "strike":        pl.Float64,
        "bid":           pl.Float64,
        "ask":           pl.Float64,
        "last_price":    pl.Float64,
        "volume":        pl.Int64,
        "open_interest": pl.Int64,
        "implied_vol":   pl.Float64,
        "in_the_money":  pl.Boolean,
        "delta":         pl.Float64,
        "gamma":         pl.Float64,
        "theta":         pl.Float64,
        "vega":          pl.Float64,
        "rho":           pl.Float64,
    })


# ---------------------------------------------------------------------------
# Strategy Recommender additions
# ---------------------------------------------------------------------------
# aliased to avoid collisions if dataclass is already imported elsewhere
from dataclasses import dataclass as _dc, field as _field
import math as _math


# ── Strike rounding helper ────────────────────────────────────────────────────

def _round_strike(price: float) -> float:
    """Round a price to the nearest standard options strike increment."""
    if price < 25:
        return round(price * 2) / 2      # nearest $0.50
    elif price < 200:
        return round(price)               # nearest $1
    elif price < 1000:
        return round(price / 5) * 5      # nearest $5
    else:
        return round(price / 10) * 10    # nearest $10


# ── StrategyRecommendation dataclass ────────────────────────────────────────

@_dc
class StrategyRecommendation:
    rank: int                  # 1 = best fit
    name: str                  # e.g. "Bull Call Spread"
    category: str              # "directional" / "income" / "volatility" / "hedge"
    legs: list                 # e.g. [{"action":"BUY","type":"call","strike_offset":0,"expiry_days":30}]
    iv_environment: str        # "low_iv" / "high_iv" / "neutral_iv"
    directional_bias: str      # "bullish" / "bearish" / "neutral"
    max_profit: str            # descriptive, e.g. "Unlimited" or "Limited to $2.50/share"
    max_loss: str
    breakeven_description: str # e.g. "Above $215 at expiry"
    ideal_conditions: str      # one sentence
    risk_level: str            # "low" / "moderate" / "high"
    greeks_profile: dict       # {"delta": "+", "gamma": "+", "theta": "-", "vega": "+"}
    fit_score: float           # 0-1 how well this fits current conditions
    rationale: str             # 2-3 sentence explanation
    # Concrete contract details (computed when spot + IV are available)
    contract_details: list = _field(default_factory=list)
    net_premium: float | None = None      # net debit (+) or credit (-) per share
    breakeven_price: float | None = None  # computed exact breakeven price


# ── Strategy library (12 strategies) ────────────────────────────────────────

STRATEGY_LIBRARY: list[dict] = [
    {
        "name": "Long Call",
        "category": "directional",
        "iv_condition": "low",   # best when IV is low (cheap to buy)
        "direction": "bullish",
        "risk_level": "high",
        "legs": [{"action": "BUY", "type": "call", "strike_offset": 0, "expiry_days": 30}],
        "max_profit": "Unlimited",
        "max_loss": "Premium paid",
        "greeks": {"delta": "+", "gamma": "+", "theta": "-", "vega": "+"},
        "ideal": "Strong bullish conviction, low IV environment (cheap premium)",
    },
    {
        "name": "Bull Call Spread",
        "category": "directional",
        "iv_condition": "any",
        "direction": "bullish",
        "risk_level": "moderate",
        "legs": [
            {"action": "BUY",  "type": "call", "strike_offset": 0, "expiry_days": 30},
            {"action": "SELL", "type": "call", "strike_offset": 5, "expiry_days": 30},
        ],
        "max_profit": "Spread width minus debit",
        "max_loss": "Debit paid",
        "greeks": {"delta": "+", "gamma": "+/-", "theta": "-", "vega": "+/-"},
        "ideal": "Moderate bullish bias, defined risk, cost-reduced vs long call",
    },
    {
        "name": "Cash-Secured Put",
        "category": "income",
        "iv_condition": "high",
        "direction": "neutral-bullish",
        "risk_level": "moderate",
        "legs": [{"action": "SELL", "type": "put", "strike_offset": -5, "expiry_days": 30}],
        "max_profit": "Premium received",
        "max_loss": "Strike price minus premium",
        "greeks": {"delta": "+", "gamma": "-", "theta": "+", "vega": "-"},
        "ideal": "Bullish-to-neutral view, high IV (collect rich premium), willing to own stock",
    },
    {
        "name": "Covered Call",
        "category": "income",
        "iv_condition": "high",
        "direction": "neutral",
        "risk_level": "low",
        "legs": [{"action": "SELL", "type": "call", "strike_offset": 5, "expiry_days": 30}],
        "max_profit": "Premium + (strike - current price)",
        "max_loss": "Own stock loss minus premium",
        "greeks": {"delta": "+/-", "gamma": "-", "theta": "+", "vega": "-"},
        "ideal": "Already long stock, neutral-to-slightly-bullish, want income, high IV",
    },
    {
        "name": "Iron Condor",
        "category": "income",
        "iv_condition": "high",
        "direction": "neutral",
        "risk_level": "moderate",
        "legs": [
            {"action": "SELL", "type": "put",  "strike_offset": -5,  "expiry_days": 30},
            {"action": "BUY",  "type": "put",  "strike_offset": -10, "expiry_days": 30},
            {"action": "SELL", "type": "call", "strike_offset":  5,  "expiry_days": 30},
            {"action": "BUY",  "type": "call", "strike_offset":  10, "expiry_days": 30},
        ],
        "max_profit": "Net premium received",
        "max_loss": "Wing width minus premium",
        "greeks": {"delta": "~0", "gamma": "-", "theta": "+", "vega": "-"},
        "ideal": "Strong neutral view, stock expected to stay in range, high IV to sell",
    },
    {
        "name": "Long Straddle",
        "category": "volatility",
        "iv_condition": "low",
        "direction": "neutral",
        "risk_level": "high",
        "legs": [
            {"action": "BUY", "type": "call", "strike_offset": 0, "expiry_days": 30},
            {"action": "BUY", "type": "put",  "strike_offset": 0, "expiry_days": 30},
        ],
        "max_profit": "Unlimited",
        "max_loss": "Total premium paid",
        "greeks": {"delta": "~0", "gamma": "+", "theta": "-", "vega": "+"},
        "ideal": "Expecting big move (earnings, catalyst) but unsure of direction, low IV",
    },
    {
        "name": "Long Strangle",
        "category": "volatility",
        "iv_condition": "low",
        "direction": "neutral",
        "risk_level": "high",
        "legs": [
            {"action": "BUY", "type": "call", "strike_offset":  5, "expiry_days": 30},
            {"action": "BUY", "type": "put",  "strike_offset": -5, "expiry_days": 30},
        ],
        "max_profit": "Unlimited",
        "max_loss": "Total premium paid (cheaper than straddle)",
        "greeks": {"delta": "~0", "gamma": "+", "theta": "-", "vega": "+"},
        "ideal": "Cheap vol play before catalyst, need larger move than straddle to profit",
    },
    {
        "name": "Bear Put Spread",
        "category": "directional",
        "iv_condition": "any",
        "direction": "bearish",
        "risk_level": "moderate",
        "legs": [
            {"action": "BUY",  "type": "put", "strike_offset":  0, "expiry_days": 30},
            {"action": "SELL", "type": "put", "strike_offset": -5, "expiry_days": 30},
        ],
        "max_profit": "Spread width minus debit",
        "max_loss": "Debit paid",
        "greeks": {"delta": "-", "gamma": "+/-", "theta": "-", "vega": "+/-"},
        "ideal": "Moderate bearish bias, defined risk, less expensive than long put",
    },
    {
        "name": "Long Put",
        "category": "directional",
        "iv_condition": "low",
        "direction": "bearish",
        "risk_level": "high",
        "legs": [{"action": "BUY", "type": "put", "strike_offset": 0, "expiry_days": 30}],
        "max_profit": "Strike minus premium",
        "max_loss": "Premium paid",
        "greeks": {"delta": "-", "gamma": "+", "theta": "-", "vega": "+"},
        "ideal": "Strong bearish conviction, low IV (cheap downside protection)",
    },
    {
        "name": "Protective Put",
        "category": "hedge",
        "iv_condition": "any",
        "direction": "bearish",
        "risk_level": "low",
        "legs": [{"action": "BUY", "type": "put", "strike_offset": -5, "expiry_days": 60}],
        "max_profit": "Unlimited (stock appreciation minus cost)",
        "max_loss": "Distance to put strike + premium",
        "greeks": {"delta": "+/-", "gamma": "+", "theta": "-", "vega": "+"},
        "ideal": "Long stock, want downside protection, bearish macro concern",
    },
    {
        "name": "Butterfly Spread",
        "category": "income",
        "iv_condition": "high",
        "direction": "neutral",
        "risk_level": "low",
        "legs": [
            {"action": "BUY",  "type": "call", "strike_offset": -5, "expiry_days": 30},
            {"action": "SELL", "type": "call", "strike_offset":  0, "expiry_days": 30},
            {"action": "SELL", "type": "call", "strike_offset":  0, "expiry_days": 30},
            {"action": "BUY",  "type": "call", "strike_offset":  5, "expiry_days": 30},
        ],
        "max_profit": "Wing width minus debit, max at center strike",
        "max_loss": "Debit paid",
        "greeks": {"delta": "~0", "gamma": "-", "theta": "+", "vega": "-"},
        "ideal": "Stock pinning near center strike, high IV, defined risk income play",
    },
    {
        "name": "Collar",
        "category": "hedge",
        "iv_condition": "high",
        "direction": "neutral",
        "risk_level": "low",
        "legs": [
            {"action": "SELL", "type": "call", "strike_offset":  5, "expiry_days": 30},
            {"action": "BUY",  "type": "put",  "strike_offset": -5, "expiry_days": 30},
        ],
        "max_profit": "Call strike minus current price + premium net",
        "max_loss": "Current price minus put strike - premium net",
        "greeks": {"delta": "limited", "gamma": "-", "theta": "+/-", "vega": "+/-"},
        "ideal": "Long stock, want protection while reducing cost via call sale, high IV",
    },
]


def recommend_strategies(
    symbol: str,
    spot: float,
    iv_rank: float | None,
    composite_signal: float,  # -1 to +1 directional signal
    max_pain: float | None,
    current_iv: float | None,
    days_to_expiry: int = 30,
    risk_tolerance: str = "moderate",  # "conservative" / "moderate" / "aggressive"
    hv20: float | None = None,         # historical vol fallback for BS pricing
) -> list[StrategyRecommendation]:
    """
    Synthesize IV environment + directional bias into concrete options strategy
    recommendations ranked by how well they fit the current market conditions.

    Parameters
    ----------
    symbol           : ticker symbol (informational only)
    spot             : current underlying price
    iv_rank          : 0-100 IV Rank; None treated as neutral (50)
    composite_signal : directional signal in [-1, +1]; positive = bullish
    max_pain         : max-pain strike computed from OI; None if unavailable
    current_iv       : current ATM implied volatility (decimal); None if unavailable
    days_to_expiry   : target DTE for leg construction
    risk_tolerance   : "conservative" / "moderate" / "aggressive"

    Returns
    -------
    Top-5 StrategyRecommendation objects sorted by fit_score descending.
    """
    # ── Guard inputs ──────────────────────────────────────────────────────────
    spot = float(spot) if spot and not _math.isnan(float(spot)) else 0.0
    composite_signal = float(composite_signal) if composite_signal is not None else 0.0
    composite_signal = max(-1.0, min(1.0, composite_signal))
    days_to_expiry = int(days_to_expiry) if days_to_expiry and days_to_expiry > 0 else 30
    risk_tolerance = risk_tolerance if risk_tolerance in ("conservative", "moderate", "aggressive") else "moderate"

    # ── 1. Classify IV environment ────────────────────────────────────────────
    if iv_rank is None:
        iv_env = "neutral_iv"
    elif float(iv_rank) < 0.25:    # iv_rank is a 0-1 proportion from compute_analytics
        iv_env = "low_iv"
    elif float(iv_rank) > 0.75:
        iv_env = "high_iv"
    else:
        iv_env = "neutral_iv"

    iv_rank_val: float = float(iv_rank) * 100 if iv_rank is not None else 50.0  # convert to 0-100 for display

    # ── 2. Classify directional bias ──────────────────────────────────────────
    if composite_signal > 0.25:
        dir_bias = "bullish"
    elif composite_signal < -0.25:
        dir_bias = "bearish"
    else:
        dir_bias = "neutral"

    # ── 3. Score each strategy ────────────────────────────────────────────────
    # Map iv_env string → the library's iv_condition keyword
    _iv_env_to_cond = {"low_iv": "low", "high_iv": "high", "neutral_iv": "neutral"}
    current_iv_cond = _iv_env_to_cond[iv_env]

    scored: list[tuple[float, dict]] = []
    for strat in STRATEGY_LIBRARY:
        # IV match score
        strat_iv = strat["iv_condition"]
        if strat_iv == "any":
            iv_match = 1.0
        elif strat_iv == current_iv_cond:
            iv_match = 1.0
        elif current_iv_cond == "neutral":
            # neutral IV slightly discounts strategies that really want high/low
            iv_match = 0.7
        else:
            iv_match = 0.4

        # Direction match score
        strat_dir = strat["direction"]
        if strat_dir == dir_bias:
            dir_match = 1.0
        elif strat_dir == "neutral-bullish":
            # matches both neutral and bullish
            dir_match = 1.0 if dir_bias in ("neutral", "bullish") else 0.0
        elif strat_dir == "neutral" and dir_bias in ("bullish", "bearish"):
            dir_match = 0.6
        elif dir_bias == "neutral" and strat_dir in ("bullish", "bearish"):
            dir_match = 0.6
        else:
            # opposite direction
            dir_match = 0.0

        # Risk tolerance filter
        strat_risk = strat["risk_level"]
        if risk_tolerance == "conservative" and strat_risk == "high":
            risk_factor = 0.5
        elif risk_tolerance == "aggressive" and strat_risk == "low":
            # aggressive traders may find low-risk strategies unattractive; mild penalty
            risk_factor = 0.85
        else:
            risk_factor = 1.0

        fit = (iv_match * 0.5 + dir_match * 0.5) * risk_factor
        scored.append((fit, strat))

    # ── 4. Max Pain context adjustments ──────────────────────────────────────
    if max_pain is not None and spot > 0:
        mp_pct_diff = abs(max_pain - spot) / spot
        adjusted: list[tuple[float, dict]] = []
        for fit, strat in scored:
            bonus = 0.0
            strat_dir = strat["direction"]
            if mp_pct_diff <= 0.02:
                # Max pain very close to spot — neutral strategies get a boost
                if strat_dir in ("neutral", "neutral-bullish"):
                    bonus = 0.15
            elif max_pain > spot:
                # Max pain above spot — gentle bullish tilt
                if strat_dir in ("bullish", "neutral-bullish"):
                    bonus = 0.05
            adjusted.append((min(fit + bonus, 1.0), strat))
        scored = adjusted

    # ── 5. Sort by fit_score descending ──────────────────────────────────────
    scored.sort(key=lambda t: t[0], reverse=True)

    # ── 6. Build StrategyRecommendation objects for top 5 ────────────────────
    iv_rank_str = f"{iv_rank_val:.0f}" if iv_rank is not None else "N/A"
    iv_label = {"low_iv": "low", "high_iv": "elevated", "neutral_iv": "moderate"}[iv_env]
    signal_str = f"{composite_signal:+.2f}"

    max_pain_str: str
    if max_pain is not None and spot > 0:
        mp_diff_pct = (max_pain - spot) / spot * 100
        max_pain_str = f"${max_pain:.2f} ({mp_diff_pct:+.1f}% vs spot)"
    else:
        max_pain_str = "N/A"

    recommendations: list[StrategyRecommendation] = []
    for rank_idx, (fit, strat) in enumerate(scored[:5], start=1):
        # Build breakeven description heuristically
        first_leg = strat["legs"][0] if strat["legs"] else {}
        leg_offset = first_leg.get("strike_offset", 0) if first_leg else 0
        approx_strike = spot + leg_offset if spot > 0 else leg_offset
        leg_action = first_leg.get("action", "BUY") if first_leg else "BUY"
        leg_type = first_leg.get("type", "call") if first_leg else "call"

        if strat["category"] in ("income",):
            breakeven_desc = (
                f"Profit as long as underlying stays near ${approx_strike:.2f} at expiry"
            )
        elif leg_action == "BUY" and leg_type == "call":
            breakeven_desc = f"Above ${approx_strike:.2f} + premium at expiry"
        elif leg_action == "BUY" and leg_type == "put":
            breakeven_desc = f"Below ${approx_strike:.2f} - premium at expiry"
        else:
            breakeven_desc = f"Near ${approx_strike:.2f} at expiry"

        # Build rationale
        iv_sentence = (
            f"With IV Rank at {iv_rank_str} ({iv_label}), "
            + ("selling premium is favored." if iv_env == "high_iv"
               else "buying premium is relatively affordable." if iv_env == "low_iv"
               else "the IV environment is neutral.")
        )
        dir_sentence = (
            f"The composite signal of {signal_str} indicates a {dir_bias} directional bias."
        )
        mp_sentence = (
            f"Max pain sits at {max_pain_str}, "
            + ("reinforcing a neutral/range-bound outlook." if max_pain is not None and abs(max_pain - spot) / max(spot, 1) <= 0.02
               else "suggesting a possible drift toward that level by expiry." if max_pain is not None
               else "with no max pain data available.")
        )
        rationale = f"{iv_sentence} {dir_sentence} {mp_sentence}"

        # Scale legs to use actual days_to_expiry
        scaled_legs = []
        for leg in strat["legs"]:
            scaled_leg = dict(leg)
            scaled_leg["expiry_days"] = days_to_expiry
            scaled_legs.append(scaled_leg)

        # ── Compute concrete contract details ─────────────────────────────────
        # Resolve IV to use for Black-Scholes pricing
        _iv = None
        if current_iv and not _math.isnan(float(current_iv)) and float(current_iv) > 0.001:
            _iv = float(current_iv)
        elif hv20 and not _math.isnan(float(hv20)) and float(hv20) > 0.001:
            _iv = float(hv20)
        else:
            _iv = 0.25  # conservative fallback: 25% vol
        _iv = min(_iv, 5.0)   # cap at 500% (handles extreme values gracefully)
        _RFR = 0.05            # risk-free rate

        from stochastic_finance import BlackScholes as _BS
        from datetime import timedelta as _td

        _contract_details: list[dict] = []
        _net_premium: float = 0.0
        for _leg in scaled_legs:
            _dte  = int(_leg.get("expiry_days", 30))
            _T    = _dte / 365.0
            # Strike offset is treated as % of spot (5 → 5% OTM) for realistic strikes
            _off_pct  = _leg.get("strike_offset", 0)
            _raw_k    = spot * (1.0 + _off_pct / 100.0) if spot > 0 else max(spot + _off_pct, 0.01)
            _strike   = _round_strike(max(_raw_k, 0.01))
            _opt_type = _leg.get("type", "call")
            _action   = _leg.get("action", "BUY")
            _expiry_label = (date.today() + _td(days=_dte)).strftime("%b %d, %Y")

            _prem = _delta = _gamma = _theta = _vega = None
            try:
                _bs = _BS.price(spot, _strike, _T, _RFR, _iv, _opt_type)
                _prem  = round(float(_bs.price),  2)
                _delta = round(float(_bs.delta),  3)
                _gamma = round(float(_bs.gamma),  4)
                _theta = round(float(_bs.theta),  4)
                _vega  = round(float(_bs.vega),   4)
            except Exception:
                pass

            if _prem is not None:
                _net_premium += _prem if _action == "BUY" else -_prem

            _contract_details.append({
                "action":              _action,
                "option_type":         _opt_type,
                "strike":              _strike,
                "expiry_days":         _dte,
                "expiry_label":        _expiry_label,
                "est_premium":         _prem,
                "est_premium_contract": round(_prem * 100, 0) if _prem is not None else None,
                "delta":  _delta,
                "gamma":  _gamma,
                "theta":  _theta,
                "vega":   _vega,
            })

        # Compute breakeven price from contract details
        _be_price: float | None = None
        if _contract_details and all(cd["est_premium"] is not None for cd in _contract_details):
            _first = _contract_details[0]
            if strat["category"] == "income":
                # income = selling premium; breakeven = short strike ± net credit
                _short = next((cd for cd in _contract_details if cd["action"] == "SELL"), _first)
                if _short["option_type"] == "put":
                    _be_price = round(_short["strike"] + _net_premium, 2)   # strike - credit
                else:
                    _be_price = round(_short["strike"] + _net_premium, 2)   # strike + credit
            elif _first["option_type"] == "call":
                _be_price = round(_first["strike"] + abs(_net_premium), 2)
            else:
                _be_price = round(_first["strike"] - abs(_net_premium), 2)

        recommendations.append(
            StrategyRecommendation(
                rank=rank_idx,
                name=strat["name"],
                category=strat["category"],
                legs=scaled_legs,
                iv_environment=iv_env,
                directional_bias=dir_bias,
                max_profit=strat["max_profit"],
                max_loss=strat["max_loss"],
                breakeven_description=breakeven_desc,
                ideal_conditions=strat["ideal"],
                risk_level=strat["risk_level"],
                greeks_profile=dict(strat["greeks"]),
                fit_score=round(fit, 4),
                rationale=rationale,
                contract_details=_contract_details,
                net_premium=round(_net_premium, 2) if _contract_details else None,
                breakeven_price=_be_price,
            )
        )

    return recommendations


# ---------------------------------------------------------------------------
# P&L Payoff Diagram
# ---------------------------------------------------------------------------

def build_plpayoff_diagram(
    strategy_name: str,
    spot: float,
    strikes: list[float],
    premiums: list[float],
) -> list[dict]:
    """
    Compute P&L at expiry for a strategy across a range of underlying prices.
    Returns list of {price, pnl} for charting.
    Used by frontend P&L diagram.

    Parameters
    ----------
    strategy_name : one of the names in STRATEGY_LIBRARY
    spot          : current underlying price
    strikes       : ordered list of strikes for each leg (same length as legs)
    premiums      : premium per share for each leg (positive = cost, negative = credit)

    Returns
    -------
    List of {"price": float, "pnl": float} dicts over spot*0.85 .. spot*1.15 (50 points).
    """
    spot = float(spot) if spot and not _math.isnan(float(spot)) else 100.0
    price_low  = spot * 0.85
    price_high = spot * 1.15
    step = (price_high - price_low) / 49  # 50 points

    prices: list[float] = [price_low + i * step for i in range(50)]

    # Resolve strategy legs from library (for action/type reference)
    strat_def: dict | None = next(
        (s for s in STRATEGY_LIBRARY if s["name"] == strategy_name), None
    )

    def _call_payoff(price: float, strike: float) -> float:
        return max(0.0, price - strike)

    def _put_payoff(price: float, strike: float) -> float:
        return max(0.0, strike - price)

    results: list[dict] = []

    # ── Analytic payoff by strategy name ─────────────────────────────────────

    if strategy_name == "Long Call":
        # Single BUY call: pnl = max(0, price - K) - premium
        k = strikes[0] if strikes else spot
        prem = premiums[0] if premiums else 0.0
        for p in prices:
            results.append({"price": round(p, 4), "pnl": round(_call_payoff(p, k) - prem, 4)})

    elif strategy_name == "Long Put":
        k = strikes[0] if strikes else spot
        prem = premiums[0] if premiums else 0.0
        for p in prices:
            results.append({"price": round(p, 4), "pnl": round(_put_payoff(p, k) - prem, 4)})

    elif strategy_name == "Bull Call Spread":
        # BUY call K1, SELL call K2 (K2 > K1)
        k1 = strikes[0] if len(strikes) > 0 else spot
        k2 = strikes[1] if len(strikes) > 1 else spot + 5
        net_debit = premiums[0] - premiums[1] if len(premiums) > 1 else (premiums[0] if premiums else 0.0)
        for p in prices:
            pnl = _call_payoff(p, k1) - _call_payoff(p, k2) - net_debit
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Bear Put Spread":
        # BUY put K1, SELL put K2 (K2 < K1)
        k1 = strikes[0] if len(strikes) > 0 else spot
        k2 = strikes[1] if len(strikes) > 1 else spot - 5
        net_debit = premiums[0] - premiums[1] if len(premiums) > 1 else (premiums[0] if premiums else 0.0)
        for p in prices:
            pnl = _put_payoff(p, k1) - _put_payoff(p, k2) - net_debit
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Cash-Secured Put":
        # SELL put: pnl = premium - max(0, K - price)
        k = strikes[0] if strikes else spot
        credit = premiums[0] if premiums else 0.0
        for p in prices:
            results.append({"price": round(p, 4), "pnl": round(credit - _put_payoff(p, k), 4)})

    elif strategy_name == "Covered Call":
        # Long stock + SELL call: pnl = (price - spot) + credit - max(0, price - K)
        k = strikes[0] if strikes else spot
        credit = premiums[0] if premiums else 0.0
        for p in prices:
            stock_pnl = p - spot
            call_pnl  = credit - _call_payoff(p, k)
            results.append({"price": round(p, 4), "pnl": round(stock_pnl + call_pnl, 4)})

    elif strategy_name == "Iron Condor":
        # SELL put K1, BUY put K2 (K2 < K1), SELL call K3, BUY call K4 (K4 > K3)
        k1 = strikes[0] if len(strikes) > 0 else spot - 5   # short put
        k2 = strikes[1] if len(strikes) > 1 else spot - 10  # long put
        k3 = strikes[2] if len(strikes) > 2 else spot + 5   # short call
        k4 = strikes[3] if len(strikes) > 3 else spot + 10  # long call
        # net credit = sell_put_prem + sell_call_prem - buy_put_prem - buy_call_prem
        if len(premiums) >= 4:
            net_credit = premiums[0] - premiums[1] + premiums[2] - premiums[3]
        elif premiums:
            net_credit = sum(premiums)
        else:
            net_credit = 0.0
        for p in prices:
            put_spread  = _put_payoff(p, k2) - _put_payoff(p, k1)   # long - short (negative = loss)
            call_spread = _call_payoff(p, k4) - _call_payoff(p, k3)
            pnl = net_credit + put_spread + call_spread
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Long Straddle":
        # BUY call + BUY put at same strike
        k = strikes[0] if strikes else spot
        total_prem = sum(premiums) if premiums else 0.0
        for p in prices:
            pnl = _call_payoff(p, k) + _put_payoff(p, k) - total_prem
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Long Strangle":
        # BUY OTM call K2, BUY OTM put K1 (K1 < spot < K2)
        k_put  = strikes[0] if len(strikes) > 0 else spot - 5
        k_call = strikes[1] if len(strikes) > 1 else spot + 5
        total_prem = sum(premiums) if premiums else 0.0
        for p in prices:
            pnl = _call_payoff(p, k_call) + _put_payoff(p, k_put) - total_prem
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Protective Put":
        # Long stock + BUY put
        k = strikes[0] if strikes else spot
        prem = premiums[0] if premiums else 0.0
        for p in prices:
            stock_pnl = p - spot
            put_pnl   = _put_payoff(p, k) - prem
            results.append({"price": round(p, 4), "pnl": round(stock_pnl + put_pnl, 4)})

    elif strategy_name == "Butterfly Spread":
        # BUY call K1, SELL 2x call K2, BUY call K3  (K1 < K2 < K3)
        k1 = strikes[0] if len(strikes) > 0 else spot - 5
        k2 = strikes[1] if len(strikes) > 1 else spot
        k3 = strikes[2] if len(strikes) > 2 else spot + 5
        net_debit = (premiums[0] + (premiums[3] if len(premiums) > 3 else premiums[-1] if premiums else 0.0)
                     - 2 * (premiums[1] if len(premiums) > 1 else 0.0))
        for p in prices:
            pnl = _call_payoff(p, k1) - 2 * _call_payoff(p, k2) + _call_payoff(p, k3) - net_debit
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    elif strategy_name == "Collar":
        # Long stock + SELL call K2 + BUY put K1 (K1 < spot < K2)
        k_put  = strikes[0] if len(strikes) > 0 else spot - 5
        k_call = strikes[1] if len(strikes) > 1 else spot + 5
        # net cost = put premium - call credit (may be near zero for zero-cost collar)
        net_cost = (premiums[0] - premiums[1]) if len(premiums) > 1 else (premiums[0] if premiums else 0.0)
        for p in prices:
            stock_pnl = p - spot
            put_pnl   = _put_payoff(p, k_put)
            call_pnl  = -_call_payoff(p, k_call)  # short call
            pnl = stock_pnl + put_pnl + call_pnl - net_cost
            results.append({"price": round(p, 4), "pnl": round(pnl, 4)})

    else:
        # Generic fallback: combine legs using strat_def if found, else flat zero line
        if strat_def:
            legs_def = strat_def["legs"]
            for p in prices:
                pnl = 0.0
                for i, leg in enumerate(legs_def):
                    k = strikes[i] if i < len(strikes) else spot
                    prem = premiums[i] if i < len(premiums) else 0.0
                    if leg["action"] == "BUY":
                        if leg["type"] == "call":
                            pnl += _call_payoff(p, k) - prem
                        else:
                            pnl += _put_payoff(p, k) - prem
                    else:  # SELL
                        if leg["type"] == "call":
                            pnl += prem - _call_payoff(p, k)
                        else:
                            pnl += prem - _put_payoff(p, k)
                results.append({"price": round(p, 4), "pnl": round(pnl, 4)})
        else:
            results = [{"price": round(p, 4), "pnl": 0.0} for p in prices]

    return results
