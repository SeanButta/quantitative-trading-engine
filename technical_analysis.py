"""
Technical Analysis Engine
=========================
Computes OHLCV-based technical indicators using pure pandas / numpy.
No external TA-Lib dependency required.

Indicators
----------
Trend overlays  : SMA, EMA, Bollinger Bands, VWAP
Momentum        : RSI, MACD, Stochastic %K/%D, Williams %R, CCI
Volatility      : ATR
Volume          : OBV
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# TAEngine
# ---------------------------------------------------------------------------

class TAEngine:
    """Compute all technical indicators from an OHLCV DataFrame."""

    # ── Moving averages ──────────────────────────────────────────────────────

    @staticmethod
    def sma(close: pd.Series, period: int) -> pd.Series:
        return close.rolling(period, min_periods=1).mean()

    @staticmethod
    def ema(close: pd.Series, period: int) -> pd.Series:
        return close.ewm(span=period, adjust=False).mean()

    # ── Bollinger Bands ──────────────────────────────────────────────────────

    @staticmethod
    def bollinger_bands(close: pd.Series, period: int = 20, n_std: float = 2.0):
        mid = close.rolling(period, min_periods=1).mean()
        std = close.rolling(period, min_periods=1).std()
        return mid + n_std * std, mid, mid - n_std * std

    # ── RSI (Wilder EMA method) ──────────────────────────────────────────────

    @staticmethod
    def rsi(close: pd.Series, period: int = 14) -> pd.Series:
        delta = close.diff()
        gain  = delta.clip(lower=0).ewm(com=period - 1, adjust=False).mean()
        loss  = (-delta.clip(upper=0)).ewm(com=period - 1, adjust=False).mean()
        rs    = gain / loss.replace(0, np.nan)
        return 100.0 - (100.0 / (1.0 + rs))

    # ── MACD ─────────────────────────────────────────────────────────────────

    @staticmethod
    def macd(
        close: pd.Series,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9,
    ):
        fast_ema  = close.ewm(span=fast,   adjust=False).mean()
        slow_ema  = close.ewm(span=slow,   adjust=False).mean()
        macd_line = fast_ema - slow_ema
        sig_line  = macd_line.ewm(span=signal, adjust=False).mean()
        histogram = macd_line - sig_line
        return macd_line, sig_line, histogram

    # ── Stochastic %K / %D ───────────────────────────────────────────────────

    @staticmethod
    def stochastic(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        k_period: int = 14,
        d_period: int = 3,
    ):
        low_k  = low.rolling(k_period,  min_periods=1).min()
        high_k = high.rolling(k_period, min_periods=1).max()
        k = 100.0 * (close - low_k) / (high_k - low_k + 1e-10)
        d = k.rolling(d_period, min_periods=1).mean()
        return k, d

    # ── ATR (Wilder) ──────────────────────────────────────────────────────────

    @staticmethod
    def atr(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 14,
    ) -> pd.Series:
        prev = close.shift(1)
        tr = pd.concat(
            [high - low, (high - prev).abs(), (low - prev).abs()], axis=1
        ).max(axis=1)
        return tr.ewm(com=period - 1, adjust=False).mean()

    # ── OBV ───────────────────────────────────────────────────────────────────

    @staticmethod
    def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
        direction = np.sign(close.diff().fillna(0))
        return (direction * volume).cumsum()

    # ── VWAP (session-cumulative) ─────────────────────────────────────────────

    @staticmethod
    def vwap(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        volume: pd.Series,
    ) -> pd.Series:
        typical = (high + low + close) / 3.0
        num = (typical * volume).cumsum()
        den = volume.cumsum().replace(0, np.nan)
        return num / den

    # ── Williams %R ───────────────────────────────────────────────────────────

    @staticmethod
    def williams_r(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 14,
    ) -> pd.Series:
        hh = high.rolling(period, min_periods=1).max()
        ll = low.rolling(period,  min_periods=1).min()
        return -100.0 * (hh - close) / (hh - ll + 1e-10)

    # ── CCI ───────────────────────────────────────────────────────────────────

    @staticmethod
    def cci(
        high: pd.Series,
        low: pd.Series,
        close: pd.Series,
        period: int = 20,
    ) -> pd.Series:
        typical = (high + low + close) / 3.0
        sma_tp  = typical.rolling(period, min_periods=1).mean()
        mad     = typical.rolling(period, min_periods=1).apply(
            lambda x: np.mean(np.abs(x - x.mean())), raw=True
        )
        return (typical - sma_tp) / (0.015 * mad.replace(0, np.nan))

    # ── Pivot Points (daily classic) ──────────────────────────────────────────

    @staticmethod
    def pivots(high: pd.Series, low: pd.Series, close: pd.Series) -> dict[str, pd.Series]:
        pp = (high.shift(1) + low.shift(1) + close.shift(1)) / 3.0
        r1 = 2 * pp - low.shift(1)
        s1 = 2 * pp - high.shift(1)
        r2 = pp + (high.shift(1) - low.shift(1))
        s2 = pp - (high.shift(1) - low.shift(1))
        return {"pp": pp, "r1": r1, "s1": s1, "r2": r2, "s2": s2}

    # ── Main compute entry point ───────────────────────────────────────────────

    def compute(
        self,
        df: pd.DataFrame,
        sma_periods: list[int] = (20, 50, 200),
        ema_periods: list[int] = (9, 21),
        bb_period:    int   = 20,
        bb_std:       float = 2.0,
        rsi_period:   int   = 14,
        macd_fast:    int   = 12,
        macd_slow:    int   = 26,
        macd_signal:  int   = 9,
        stoch_k:      int   = 14,
        stoch_d:      int   = 3,
        atr_period:   int   = 14,
        cci_period:   int   = 20,
        williams_period: int = 14,
        is_intraday:  bool  = False,
    ) -> dict[str, Any]:
        """
        Compute all indicators.

        df must have columns: open, high, low, close, volume (DatetimeIndex).
        Returns a JSON-serialisable dict with arrays parallel to ohlcv rows.
        is_intraday=True formats dates as "MM/DD HH:MM" instead of "YYYY-MM-DD".
        """
        o, h, l, c, v = df["open"], df["high"], df["low"], df["close"], df["volume"]

        def _ser(s: pd.Series) -> list:
            """Convert Series → list[float | None], round to 4 dp."""
            out = []
            for x in s:
                if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))):
                    out.append(None)
                else:
                    out.append(round(float(x), 4))
            return out

        def _fmt_date(ts) -> str:
            """Format bar timestamp for display."""
            if is_intraday:
                return ts.strftime("%m/%d %H:%M")
            return str(ts.date())

        # OHLCV rows
        ohlcv = []
        for i in range(len(df)):
            vol_i = v.iloc[i]
            ohlcv.append({
                "date":   _fmt_date(df.index[i]),
                "open":   round(float(o.iloc[i]), 4),
                "high":   round(float(h.iloc[i]), 4),
                "low":    round(float(l.iloc[i]), 4),
                "close":  round(float(c.iloc[i]), 4),
                "volume": int(vol_i) if not np.isnan(vol_i) else 0,
            })

        # SMA / EMA
        smas = {str(p): _ser(self.sma(c, p)) for p in sma_periods}
        emas = {str(p): _ser(self.ema(c, p)) for p in ema_periods}

        # Bollinger Bands
        bb_upper, bb_mid, bb_lower = self.bollinger_bands(c, bb_period, bb_std)
        bb = {
            "upper":  _ser(bb_upper),
            "middle": _ser(bb_mid),
            "lower":  _ser(bb_lower),
        }

        # RSI
        rsi_vals = _ser(self.rsi(c, rsi_period))

        # MACD
        ml, sl, hist = self.macd(c, macd_fast, macd_slow, macd_signal)
        macd_out = {
            "macd":      _ser(ml),
            "signal":    _ser(sl),
            "histogram": _ser(hist),
        }

        # Stochastic
        k_vals, d_vals = self.stochastic(h, l, c, stoch_k, stoch_d)
        stoch = {"k": _ser(k_vals), "d": _ser(d_vals)}

        # ATR
        atr_vals = _ser(self.atr(h, l, c, atr_period))

        # OBV
        obv_vals = _ser(self.obv(c, v))

        # VWAP
        vwap_vals = _ser(self.vwap(h, l, c, v))

        # Williams %R
        wr_vals = _ser(self.williams_r(h, l, c, williams_period))

        # CCI
        cci_vals = _ser(self.cci(h, l, c, cci_period))

        # Pivot Points
        piv = self.pivots(h, l, c)
        pivots_out = {k: _ser(s) for k, s in piv.items()}

        return {
            "ohlcv":      ohlcv,
            "sma":        smas,
            "ema":        emas,
            "bb":         bb,
            "rsi":        rsi_vals,
            "macd":       macd_out,
            "stoch":      stoch,
            "atr":        atr_vals,
            "obv":        obv_vals,
            "vwap":       vwap_vals,
            "williams_r": wr_vals,
            "cci":        cci_vals,
            "pivots":     pivots_out,
        }


# ---------------------------------------------------------------------------
# Intraday resampling helpers
# ---------------------------------------------------------------------------

# Synthetic intervals: fetch at base_interval, resample to pandas rule
_SYNTHETIC_INTERVALS: dict[str, tuple[str, str]] = {
    "4h": ("1h", "4h"),
    "8h": ("1h", "8h"),
}

# Intervals that expose sub-day timestamps → use intraday date formatting
_INTRADAY_INTERVALS = {"1h", "4h", "8h", "90m", "60m", "30m", "15m", "5m", "2m", "1m"}


def _resample_ohlcv(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """
    Resample a higher-frequency OHLCV DataFrame to a coarser interval.

    Only keeps bars where both open and close have real values, discarding
    off-market-hours empty slots produced by calendar-based resampling.
    """
    agg = {
        "open":   "first",
        "high":   "max",
        "low":    "min",
        "close":  "last",
        "volume": "sum",
    }
    resampled = (
        df.resample(rule, closed="left", label="left")
          .agg(agg)
    )
    # Drop rows outside market hours (open/close are NaN)
    mask = resampled["open"].notna() & resampled["close"].notna()
    return resampled[mask].copy()


# ---------------------------------------------------------------------------
# Convenience: fetch from yfinance + compute
# ---------------------------------------------------------------------------

def fetch_and_compute(
    symbol: str,
    period: str = "1y",
    interval: str = "1d",
    **indicator_params,
) -> dict:
    """
    Fetch OHLCV from yfinance then compute all indicators.

    Supports native yfinance intervals (1d, 1wk, 1mo, 1h, …) plus synthetic
    intraday intervals 4h and 8h (fetched as 1h, resampled via pandas).

    Returns the full indicator dict plus top-level metadata.
    """
    import yfinance as yf

    # ── Resolve synthetic intervals ──────────────────────────────────────────
    fetch_interval = interval
    resample_rule: str | None = None
    if interval in _SYNTHETIC_INTERVALS:
        fetch_interval, resample_rule = _SYNTHETIC_INTERVALS[interval]

    ticker = yf.Ticker(symbol)
    hist   = ticker.history(period=period, interval=fetch_interval, auto_adjust=True)

    if hist.empty:
        raise ValueError(
            f"No data returned for symbol={symbol!r} period={period} "
            f"interval={fetch_interval}"
        )

    # Normalise index timezone
    if hist.index.tz is not None:
        hist.index = hist.index.tz_localize(None)

    hist.columns = [str(c).lower() for c in hist.columns]

    # ── Resample if synthetic interval ───────────────────────────────────────
    if resample_rule is not None:
        hist = _resample_ohlcv(hist, resample_rule)
        if hist.empty:
            raise ValueError(
                f"Resampling {fetch_interval}→{resample_rule} produced no bars "
                f"for {symbol!r} period={period}"
            )

    # ── Latest price / change ────────────────────────────────────────────────
    try:
        info          = ticker.fast_info
        current_price = float(info.last_price or hist["close"].iloc[-1])
        prev_close    = float(info.previous_close or hist["close"].iloc[-2])
    except Exception:
        current_price = float(hist["close"].iloc[-1])
        prev_close    = float(hist["close"].iloc[-2]) if len(hist) > 1 else current_price

    change     = current_price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    # ── Compute indicators ───────────────────────────────────────────────────
    is_intraday = interval in _INTRADAY_INTERVALS
    engine      = TAEngine()
    indicators  = engine.compute(hist, is_intraday=is_intraday, **indicator_params)

    return {
        "symbol":        symbol.upper(),
        "period":        period,
        "interval":      interval,
        "is_intraday":   is_intraday,
        "current_price": round(current_price, 4),
        "change":        round(change, 4),
        "change_pct":    round(change_pct, 4),
        "n_bars":        len(hist),
        **indicators,
    }
