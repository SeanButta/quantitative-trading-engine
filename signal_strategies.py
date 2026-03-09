"""
Signal Strategy Engine
======================
Detects 20 technical analysis strategies from a TA indicator dict produced
by TAEngine.compute() / fetch_and_compute().

Each strategy returns a dict with:
  id, name, direction ("bull"|"bear"), strength (1–5),
  desc, action, triggered (True)

check_all() always returns 20 entries — triggered ones have triggered=True,
the rest have triggered=False and strength=0 (so the frontend can render all
pills in their fixed order, dimming non-triggered ones).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Strategy registry (fixed order → frontend pill order)
# ---------------------------------------------------------------------------

STRATEGY_REGISTRY: list[tuple[str, str, str]] = [
    # (id, display_name, default_direction)
    ("golden_cross",             "Golden Cross",              "bull"),
    ("death_cross",              "Death Cross",               "bear"),
    ("triple_bull",              "Triple Confirm ↑",          "bull"),
    ("triple_bear",              "Triple Confirm ↓",          "bear"),
    ("macd_bull_cross",          "MACD Cross ↑",              "bull"),
    ("macd_bear_cross",          "MACD Cross ↓",              "bear"),
    ("macd_bull_divergence",     "MACD Divergence ↑",         "bull"),
    ("macd_bear_divergence",     "MACD Divergence ↓",         "bear"),
    ("rsi_oversold_bounce",      "RSI Bounce ↑",              "bull"),
    ("rsi_overbought_rollover",  "RSI Rollover ↓",            "bear"),
    ("stoch_rsi_dual_oversold",  "Stoch+RSI Oversold",        "bull"),
    ("stoch_rollover_ob",        "Stoch OB Rollover",         "bear"),
    ("bb_squeeze_up",            "BB Squeeze ↑",              "bull"),
    ("bb_squeeze_down",          "BB Squeeze ↓",              "bear"),
    ("cci_bull_reversal",        "CCI Reversal ↑",            "bull"),
    ("cci_bear_reversal",        "CCI Reversal ↓",            "bear"),
    ("wr_recovery",              "WR Recovery ↑",             "bull"),
    ("wr_rollover",              "WR Rollover ↓",             "bear"),
    ("momentum_reload",          "Momentum Reload",           "bull"),
    ("rsi_bull_divergence",      "RSI Divergence ↑",          "bull"),
]

_PLACEHOLDER_TEMPLATE = {
    "triggered": False,
    "strength":  0,
    "desc":      "",
    "action":    "—",
}


# ---------------------------------------------------------------------------
# StrategyEngine
# ---------------------------------------------------------------------------

class StrategyEngine:
    """Detect all 20 strategies from a full TA indicator dict."""

    def __init__(self, ta: dict[str, Any]):
        self.ta  = ta
        self.n   = ta.get("n_bars", len(ta.get("ohlcv", [])))

    # ── Array helpers ────────────────────────────────────────────────────────

    def _raw(self, key: str, sub: str | None = None) -> list:
        """Return the raw array for a key (optionally nested)."""
        d = self.ta
        v = d.get(key, [])
        if sub is not None:
            if isinstance(v, dict):
                v = v.get(sub, [])
        return v if isinstance(v, list) else []

    def _valid(self, key: str, sub: str | None = None) -> list[float]:
        """Return all non-None values from an array."""
        return [x for x in self._raw(key, sub) if x is not None]

    def _last(self, key: str, sub: str | None = None, n: int = 1) -> float | list[float] | None:
        """Return the last n non-None values. n=1 → scalar, n>1 → list."""
        v = self._valid(key, sub)
        if not v:
            return None if n == 1 else []
        if n == 1:
            return v[-1]
        return v[-n:] if len(v) >= n else v

    def _ohlcv_col(self, col: str) -> list[float]:
        ohlcv = self.ta.get("ohlcv", [])
        return [b[col] for b in ohlcv if b.get(col) is not None]

    # ── Crossover helpers ────────────────────────────────────────────────────

    def _cross_up(
        self,
        a: list[float | None],
        b: list[float | None] | float,
        lookback: int = 5,
    ) -> bool:
        """True if series `a` crossed above scalar/series `b` in last `lookback` bars."""
        a_v = [x for x in a if x is not None]
        if isinstance(b, (int, float)):
            b_v = [b] * len(a_v)
        else:
            b_v = [x for x in b if x is not None]
            min_len = min(len(a_v), len(b_v))
            a_v, b_v = a_v[-min_len:], b_v[-min_len:]

        n = min(len(a_v), len(b_v), lookback + 1)
        if n < 2:
            return False
        a_w, b_w = a_v[-n:], b_v[-n:]
        was_below = a_w[0]  < b_w[0]
        is_above  = a_w[-1] > b_w[-1]
        return bool(was_below and is_above)

    def _cross_dn(
        self,
        a: list[float | None],
        b: list[float | None] | float,
        lookback: int = 5,
    ) -> bool:
        """True if series `a` crossed below scalar/series `b` in last `lookback` bars."""
        a_v = [x for x in a if x is not None]
        if isinstance(b, (int, float)):
            b_v = [b] * len(a_v)
        else:
            b_v = [x for x in b if x is not None]
            min_len = min(len(a_v), len(b_v))
            a_v, b_v = a_v[-min_len:], b_v[-min_len:]

        n = min(len(a_v), len(b_v), lookback + 1)
        if n < 2:
            return False
        a_w, b_w = a_v[-n:], b_v[-n:]
        was_above = a_w[0]  > b_w[0]
        is_below  = a_w[-1] < b_w[-1]
        return bool(was_above and is_below)

    def _local_mins(self, arr: list[float], window: int = 3) -> list[tuple[int, float]]:
        """Find local minimum indices in arr."""
        result = []
        for i in range(window, len(arr) - window):
            if all(arr[i] <= arr[i - j] for j in range(1, window + 1)) and \
               all(arr[i] <= arr[i + j] for j in range(1, window + 1)):
                result.append((i, arr[i]))
        return result

    def _local_maxs(self, arr: list[float], window: int = 3) -> list[tuple[int, float]]:
        """Find local maximum indices in arr."""
        result = []
        for i in range(window, len(arr) - window):
            if all(arr[i] >= arr[i - j] for j in range(1, window + 1)) and \
               all(arr[i] >= arr[i + j] for j in range(1, window + 1)):
                result.append((i, arr[i]))
        return result

    # ── Strategy detectors ───────────────────────────────────────────────────

    def _golden_cross(self) -> dict | None:
        sma50  = self._raw("sma", "50")
        sma200 = self._raw("sma", "200")
        if not sma50 or not sma200:
            return None
        if len([x for x in sma200 if x is not None]) < 5:
            return None
        if self._cross_up(sma50, sma200, lookback=8):
            last50  = self._last("sma", "50")
            last200 = self._last("sma", "200")
            return {
                "id": "golden_cross", "name": "Golden Cross",
                "direction": "bull", "strength": 5, "triggered": True,
                "desc": (
                    f"SMA 50 ({last50:.2f}) crossed above SMA 200 ({last200:.2f}) — "
                    "the single most powerful long-term bullish signal in technical analysis. "
                    "Historically precedes 10–20% rallies over 6–12 months."
                ),
                "action": "BUY",
            }

    def _death_cross(self) -> dict | None:
        sma50  = self._raw("sma", "50")
        sma200 = self._raw("sma", "200")
        if not sma50 or not sma200:
            return None
        if len([x for x in sma200 if x is not None]) < 5:
            return None
        if self._cross_dn(sma50, sma200, lookback=8):
            last50  = self._last("sma", "50")
            last200 = self._last("sma", "200")
            return {
                "id": "death_cross", "name": "Death Cross",
                "direction": "bear", "strength": 5, "triggered": True,
                "desc": (
                    f"SMA 50 ({last50:.2f}) crossed below SMA 200 ({last200:.2f}) — "
                    "major long-term bearish signal. Preceded every major bear market in history. "
                    "Risk of sustained downtrend is elevated."
                ),
                "action": "SELL",
            }

    def _triple_bull(self) -> dict | None:
        rsi    = self._last("rsi")
        macd_h = self._last("macd", "histogram")
        close  = self._ohlcv_col("close")
        bb_low = self._last("bb", "lower")
        bb_mid = self._last("bb", "middle")
        if any(v is None for v in [rsi, macd_h, bb_low, bb_mid]) or not close:
            return None
        c = close[-1]
        rsi_ok  = rsi < 42
        macd_ok = macd_h > 0
        bb_ok   = c <= bb_low * 1.008
        if rsi_ok and macd_ok and bb_ok:
            return {
                "id": "triple_bull", "name": "Triple Confirmation ↑",
                "direction": "bull", "strength": 5, "triggered": True,
                "desc": (
                    f"High-conviction confluence: RSI oversold ({rsi:.1f} < 42) + "
                    f"MACD histogram positive ({macd_h:.4f}) + price at BB lower ({bb_low:.2f}). "
                    "Three independent indicators agree — highest-probability reversal setup."
                ),
                "action": "BUY",
            }

    def _triple_bear(self) -> dict | None:
        rsi    = self._last("rsi")
        macd_h = self._last("macd", "histogram")
        close  = self._ohlcv_col("close")
        bb_up  = self._last("bb", "upper")
        if any(v is None for v in [rsi, macd_h, bb_up]) or not close:
            return None
        c = close[-1]
        if rsi > 63 and macd_h < 0 and c >= bb_up * 0.993:
            return {
                "id": "triple_bear", "name": "Triple Confirmation ↓",
                "direction": "bear", "strength": 5, "triggered": True,
                "desc": (
                    f"Bearish confluence: RSI overbought ({rsi:.1f} > 63) + "
                    f"MACD histogram negative ({macd_h:.4f}) + price at BB upper ({bb_up:.2f}). "
                    "Three signals agree — high-probability reversal or correction imminent."
                ),
                "action": "SELL",
            }

    def _macd_bull_cross(self) -> dict | None:
        ml = self._raw("macd", "macd")
        sl = self._raw("macd", "signal")
        if not ml or not sl:
            return None
        if self._cross_up(ml, sl, lookback=4):
            ml_val = self._last("macd", "macd")
            sub = " (below zero — highest conviction)" if ml_val is not None and ml_val < 0 else ""
            return {
                "id": "macd_bull_cross", "name": "MACD Cross ↑",
                "direction": "bull", "strength": 4, "triggered": True,
                "desc": (
                    f"MACD line crossed above Signal line{sub} — bullish momentum confirmed. "
                    "The stronger the crossing angle, the more sustained the move."
                ),
                "action": "BUY",
            }

    def _macd_bear_cross(self) -> dict | None:
        ml = self._raw("macd", "macd")
        sl = self._raw("macd", "signal")
        if not ml or not sl:
            return None
        if self._cross_dn(ml, sl, lookback=4):
            ml_val = self._last("macd", "macd")
            sub = " (above zero — highest conviction)" if ml_val is not None and ml_val > 0 else ""
            return {
                "id": "macd_bear_cross", "name": "MACD Cross ↓",
                "direction": "bear", "strength": 4, "triggered": True,
                "desc": (
                    f"MACD line crossed below Signal line{sub} — bearish momentum confirmed. "
                    "Hold short until next bullish cross or RSI < 30."
                ),
                "action": "SELL",
            }

    def _macd_bull_divergence(self) -> dict | None:
        close = self._ohlcv_col("close")
        hist  = self._valid("macd", "histogram")
        n = min(len(close), len(hist), 40)
        if n < 16:
            return None
        c_r = close[-n:]
        h_r = hist[-n:]
        c_mins = self._local_mins(c_r, window=2)
        h_mins = self._local_mins(h_r, window=2)
        if len(c_mins) < 2 or len(h_mins) < 2:
            return None
        # Last two troughs
        ci0, cv0 = c_mins[-2]
        ci1, cv1 = c_mins[-1]
        # Align histogram troughs near the same indices
        h0 = min(h_r[max(0, ci0-2):ci0+3]) if ci0 >= 0 else None
        h1 = min(h_r[max(0, ci1-2):ci1+3]) if ci1 >= 0 else None
        if h0 is None or h1 is None:
            return None
        if ci1 - ci0 >= 4 and cv1 < cv0 * 0.998 and h1 > h0 * 1.02:
            return {
                "id": "macd_bull_divergence", "name": "MACD Divergence ↑",
                "direction": "bull", "strength": 5, "triggered": True,
                "desc": (
                    f"Bullish divergence: price making lower lows (${cv0:.2f} → ${cv1:.2f}) "
                    "while MACD histogram makes higher lows — downward price momentum is weakening. "
                    "Often precedes 5–15% reversals."
                ),
                "action": "BUY",
            }

    def _macd_bear_divergence(self) -> dict | None:
        close = self._ohlcv_col("close")
        hist  = self._valid("macd", "histogram")
        n = min(len(close), len(hist), 40)
        if n < 16:
            return None
        c_r = close[-n:]
        h_r = hist[-n:]
        c_maxs = self._local_maxs(c_r, window=2)
        if len(c_maxs) < 2:
            return None
        ci0, cv0 = c_maxs[-2]
        ci1, cv1 = c_maxs[-1]
        h0 = max(h_r[max(0, ci0-2):ci0+3]) if ci0 >= 0 else None
        h1 = max(h_r[max(0, ci1-2):ci1+3]) if ci1 >= 0 else None
        if h0 is None or h1 is None:
            return None
        if ci1 - ci0 >= 4 and cv1 > cv0 * 1.002 and h1 < h0 * 0.98:
            return {
                "id": "macd_bear_divergence", "name": "MACD Divergence ↓",
                "direction": "bear", "strength": 5, "triggered": True,
                "desc": (
                    f"Bearish divergence: price making higher highs (${cv0:.2f} → ${cv1:.2f}) "
                    "while MACD histogram makes lower highs — upward momentum is fading. "
                    "Common topping pattern."
                ),
                "action": "SELL",
            }

    def _rsi_oversold_bounce(self) -> dict | None:
        rsi = self._raw("rsi")
        if not rsi:
            return None
        v = [x for x in rsi if x is not None]
        if len(v) < 6:
            return None
        was_below = any(x < 32 for x in v[-10:-2])
        is_recovering = v[-1] > 30 and v[-1] < 55
        if was_below and is_recovering:
            return {
                "id": "rsi_oversold_bounce", "name": "RSI Bounce ↑",
                "direction": "bull", "strength": 3, "triggered": True,
                "desc": (
                    f"RSI recently dipped below 32 (oversold) and is now recovering at {v[-1]:.1f}. "
                    "Historically marks a tradeable bounce of 3–8%. Stronger if accompanied by volume."
                ),
                "action": "BUY",
            }

    def _rsi_overbought_rollover(self) -> dict | None:
        rsi = self._raw("rsi")
        if not rsi:
            return None
        v = [x for x in rsi if x is not None]
        if len(v) < 6:
            return None
        was_above = any(x > 68 for x in v[-10:-2])
        is_rolling = v[-1] < 70 and v[-1] > 45
        if was_above and is_rolling:
            return {
                "id": "rsi_overbought_rollover", "name": "RSI Rollover ↓",
                "direction": "bear", "strength": 3, "triggered": True,
                "desc": (
                    f"RSI was above 68 (overbought) and has rolled over to {v[-1]:.1f}. "
                    "Bearish momentum shift. RSI 50 is the first target."
                ),
                "action": "SELL",
            }

    def _stoch_rsi_dual_oversold(self) -> dict | None:
        k   = self._last("stoch", "k")
        d   = self._last("stoch", "d")
        rsi = self._last("rsi")
        if any(v is None for v in [k, d, rsi]):
            return None
        if k < 25 and d < 25 and rsi < 38:
            return {
                "id": "stoch_rsi_dual_oversold", "name": "Stoch+RSI Oversold",
                "direction": "bull", "strength": 4, "triggered": True,
                "desc": (
                    f"Dual confirmation: RSI {rsi:.1f} AND Stochastic %K {k:.1f} / %D {d:.1f} "
                    "both deeply oversold. Two independent momentum signals agree — "
                    "high-probability reversal zone."
                ),
                "action": "BUY",
            }

    def _stoch_rollover_ob(self) -> dict | None:
        k_arr = self._raw("stoch", "k")
        d_arr = self._raw("stoch", "d")
        if not k_arr or not d_arr:
            return None
        k = self._last("stoch", "k")
        d = self._last("stoch", "d")
        if k is None or d is None:
            return None
        if k > 72 and d > 72 and self._cross_dn(k_arr, d_arr, lookback=4):
            return {
                "id": "stoch_rollover_ob", "name": "Stoch OB Rollover",
                "direction": "bear", "strength": 3, "triggered": True,
                "desc": (
                    f"Stochastic %K ({k:.1f}) crossed below %D ({d:.1f}) "
                    "from overbought territory (>72). Classic momentum reversal setup. "
                    "Exit longs; consider short with stop above recent swing high."
                ),
                "action": "SELL",
            }

    def _bb_squeeze_up(self) -> dict | None:
        upper = self._valid("bb", "upper")
        lower = self._valid("bb", "lower")
        mid   = self._valid("bb", "middle")
        close = self._ohlcv_col("close")
        if len(upper) < 25 or len(lower) < 25 or len(mid) < 25:
            return None
        n = min(len(upper), len(lower), len(mid))
        widths = [(upper[i] - lower[i]) / (mid[i] or 1) for i in range(n)]
        avg_w  = np.mean(widths[-50:]) if n >= 50 else np.mean(widths)
        cur_w  = widths[-1]
        if cur_w < avg_w * 0.55 and close:
            macd_h = self._last("macd", "histogram")
            if macd_h is not None and macd_h > 0:
                return {
                    "id": "bb_squeeze_up", "name": "BB Squeeze ↑",
                    "direction": "bull", "strength": 4, "triggered": True,
                    "desc": (
                        f"Bollinger Band width ({cur_w:.3f}) is at {cur_w/avg_w*100:.0f}% of its "
                        f"historical average — extreme compression. "
                        "MACD pointing upward signals a bullish breakout is imminent. "
                        "These explosive moves often run 10–20%."
                    ),
                    "action": "BUY",
                }

    def _bb_squeeze_down(self) -> dict | None:
        upper = self._valid("bb", "upper")
        lower = self._valid("bb", "lower")
        mid   = self._valid("bb", "middle")
        if len(upper) < 25 or len(lower) < 25 or len(mid) < 25:
            return None
        n = min(len(upper), len(lower), len(mid))
        widths = [(upper[i] - lower[i]) / (mid[i] or 1) for i in range(n)]
        avg_w  = np.mean(widths[-50:]) if n >= 50 else np.mean(widths)
        cur_w  = widths[-1]
        if cur_w < avg_w * 0.55:
            macd_h = self._last("macd", "histogram")
            if macd_h is not None and macd_h < 0:
                return {
                    "id": "bb_squeeze_down", "name": "BB Squeeze ↓",
                    "direction": "bear", "strength": 4, "triggered": True,
                    "desc": (
                        f"Bollinger Band squeeze ({cur_w:.3f} = {cur_w/avg_w*100:.0f}% of avg) "
                        "with MACD pointing downward — bearish breakdown setup. "
                        "Expect a swift, sharp move lower."
                    ),
                    "action": "SELL",
                }

    def _cci_bull_reversal(self) -> dict | None:
        cci = self._raw("cci")
        if not cci:
            return None
        v = [x for x in cci if x is not None]
        if len(v) < 4:
            return None
        if self._cross_up(cci, -100.0, lookback=4) and v[-1] < 0:
            rsi = self._last("rsi")
            if rsi is not None and rsi > 52:
                return None  # need oversold confirmation
            return {
                "id": "cci_bull_reversal", "name": "CCI Reversal ↑",
                "direction": "bull", "strength": 3, "triggered": True,
                "desc": (
                    f"CCI ({v[-1]:.1f}) crossed back above -100 from oversold. "
                    "The Commodity Channel Index is recovering — buying pressure returning. "
                    "Target: CCI = 0 (neutral), then +100."
                ),
                "action": "BUY",
            }

    def _cci_bear_reversal(self) -> dict | None:
        cci = self._raw("cci")
        if not cci:
            return None
        v = [x for x in cci if x is not None]
        if len(v) < 4:
            return None
        if self._cross_dn(cci, 100.0, lookback=4) and v[-1] > 0:
            return {
                "id": "cci_bear_reversal", "name": "CCI Reversal ↓",
                "direction": "bear", "strength": 3, "triggered": True,
                "desc": (
                    f"CCI ({v[-1]:.1f}) crossed below +100 from overbought. "
                    "Selling pressure increasing. Target: CCI = 0, then -100."
                ),
                "action": "SELL",
            }

    def _wr_recovery(self) -> dict | None:
        wr = self._raw("williams_r")
        if not wr:
            return None
        if self._cross_up(wr, -80.0, lookback=4):
            last = self._last("williams_r")
            return {
                "id": "wr_recovery", "name": "WR Recovery ↑",
                "direction": "bull", "strength": 3, "triggered": True,
                "desc": (
                    f"Williams %R ({last:.1f}) exited oversold zone (crossed above -80). "
                    "Short-term buying pressure returning. "
                    "Target: WR = -50. Best used with RSI confirmation."
                ),
                "action": "BUY",
            }

    def _wr_rollover(self) -> dict | None:
        wr = self._raw("williams_r")
        if not wr:
            return None
        if self._cross_dn(wr, -20.0, lookback=4):
            last = self._last("williams_r")
            return {
                "id": "wr_rollover", "name": "WR Rollover ↓",
                "direction": "bear", "strength": 3, "triggered": True,
                "desc": (
                    f"Williams %R ({last:.1f}) exited overbought zone (crossed below -20). "
                    "Selling pressure increasing. Target: WR = -50."
                ),
                "action": "SELL",
            }

    def _momentum_reload(self) -> dict | None:
        close   = self._ohlcv_col("close")
        volume  = self._ohlcv_col("volume")
        sma200  = self._valid("sma", "200")
        rsi_val = self._last("rsi")
        if not close or not sma200 or rsi_val is None:
            return None
        last_close = close[-1]
        last_sma200 = sma200[-1]
        above_200 = last_close > last_sma200
        rsi_mid   = 40 <= rsi_val <= 58
        vol_declining = False
        if len(volume) >= 6:
            vol_declining = volume[-1] < float(np.mean(volume[-8:-1]))
        if above_200 and rsi_mid and vol_declining:
            return {
                "id": "momentum_reload", "name": "Momentum Reload",
                "direction": "bull", "strength": 3, "triggered": True,
                "desc": (
                    f"Price ({last_close:.2f}) above SMA 200 ({last_sma200:.2f}) — uptrend intact. "
                    f"RSI {rsi_val:.1f} cooling off in neutral zone with declining volume — "
                    "healthy consolidation before next leg higher. "
                    "Classic 'reload' setup in strong uptrends."
                ),
                "action": "BUY",
            }

    def _rsi_bull_divergence(self) -> dict | None:
        close = self._ohlcv_col("close")
        rsi   = self._valid("rsi")
        n = min(len(close), len(rsi), 35)
        if n < 16:
            return None
        c_r  = close[-n:]
        r_r  = rsi[-n:]
        c_mins = self._local_mins(c_r, window=2)
        r_mins = self._local_mins(r_r, window=2)
        if len(c_mins) < 2 or len(r_mins) < 2:
            return None
        ci0, cv0 = c_mins[-2]
        ci1, cv1 = c_mins[-1]
        # Find RSI values near the same index
        ri0 = r_r[max(0, ci0-2):ci0+3]
        ri1 = r_r[max(0, ci1-2):ci1+3]
        if not ri0 or not ri1:
            return None
        rv0, rv1 = min(ri0), min(ri1)
        if ci1 - ci0 >= 4 and cv1 < cv0 * 0.998 and rv1 > rv0 * 1.02:
            return {
                "id": "rsi_bull_divergence", "name": "RSI Divergence ↑",
                "direction": "bull", "strength": 5, "triggered": True,
                "desc": (
                    f"Classic bullish divergence: price making lower lows "
                    f"(${cv0:.2f} → ${cv1:.2f}) while RSI makes higher lows "
                    f"({rv0:.1f} → {rv1:.1f}). Downward momentum is exhausting. "
                    "This pattern precedes the most powerful reversals."
                ),
                "action": "BUY",
            }

    # ── Main entry ───────────────────────────────────────────────────────────

    def check_all(self) -> list[dict]:
        """
        Run all 20 strategy detectors.
        Always returns exactly 20 dicts in STRATEGY_REGISTRY order.
        Triggered signals have triggered=True; others have triggered=False.
        """
        detectors = {
            "golden_cross":             self._golden_cross,
            "death_cross":              self._death_cross,
            "triple_bull":              self._triple_bull,
            "triple_bear":              self._triple_bear,
            "macd_bull_cross":          self._macd_bull_cross,
            "macd_bear_cross":          self._macd_bear_cross,
            "macd_bull_divergence":     self._macd_bull_divergence,
            "macd_bear_divergence":     self._macd_bear_divergence,
            "rsi_oversold_bounce":      self._rsi_oversold_bounce,
            "rsi_overbought_rollover":  self._rsi_overbought_rollover,
            "stoch_rsi_dual_oversold":  self._stoch_rsi_dual_oversold,
            "stoch_rollover_ob":        self._stoch_rollover_ob,
            "bb_squeeze_up":            self._bb_squeeze_up,
            "bb_squeeze_down":          self._bb_squeeze_down,
            "cci_bull_reversal":        self._cci_bull_reversal,
            "cci_bear_reversal":        self._cci_bear_reversal,
            "wr_recovery":              self._wr_recovery,
            "wr_rollover":              self._wr_rollover,
            "momentum_reload":          self._momentum_reload,
            "rsi_bull_divergence":      self._rsi_bull_divergence,
        }

        results: list[dict] = []
        for sid, name, default_dir in STRATEGY_REGISTRY:
            fn = detectors.get(sid)
            try:
                result = fn() if fn else None
            except Exception as exc:
                logger.debug("Strategy %s raised: %s", sid, exc)
                result = None

            if result is not None:
                # Ensure triggered flag is set
                result["triggered"] = True
                results.append(result)
            else:
                results.append({
                    "id":        sid,
                    "name":      name,
                    "direction": default_dir,
                    "triggered": False,
                    "strength":  0,
                    "desc":      f"{name} — not currently triggered for this symbol and timeframe.",
                    "action":    "—",
                })

        return results


# ---------------------------------------------------------------------------
# Fibonacci
# ---------------------------------------------------------------------------

def compute_fibonacci(low: float, high: float) -> dict[str, float]:
    """
    Compute Fibonacci retracement levels using the standard convention:
    percentages represent the fraction of the high→low range that has been
    retraced downward from the swing high.

      "0.0%"   = swing high  (0 % retraced)
      "23.6%"  = high - 0.236 × (high - low)
      "38.2%"  = high - 0.382 × (high - low)   ← golden zone top
      "50.0%"  = midpoint
      "61.8%"  = high - 0.618 × (high - low)   ← golden ratio / golden zone bottom
      "78.6%"  = high - 0.786 × (high - low)
      "100.0%" = swing low  (100 % retraced)

    Extension levels ("127.2%", "161.8%", "261.8%") are measured above the
    swing high using: low + ratio × (high - low).
    """
    diff = high - low
    if diff <= 0:
        return {}

    levels: dict[str, float] = {}
    # Retracements (from high downward — standard convention: % of range retraced)
    for ratio, label in [
        (0.000, "0.0%"),    # swing high  (0% retraced)
        (0.236, "23.6%"),
        (0.382, "38.2%"),
        (0.500, "50.0%"),
        (0.618, "61.8%"),   # golden ratio
        (0.786, "78.6%"),
        (1.000, "100.0%"),  # swing low  (100% retraced)
    ]:
        levels[label] = round(high - diff * ratio, 4)

    # Extensions (above the swing high, using conventional fib extension formula)
    for ratio, label in [
        (1.272, "127.2%"),
        (1.618, "161.8%"),
        (2.618, "261.8%"),
    ]:
        levels[label] = round(low + diff * ratio, 4)

    return levels


# ---------------------------------------------------------------------------
# God Mode synthesis
# ---------------------------------------------------------------------------

def god_mode(signals: list[dict], ta: dict, symbol: str) -> dict:
    """
    Synthesise all triggered signals into a single directional recommendation.

    Returns a dict ready to JSON-serialize and send to the frontend.
    """
    triggered = [s for s in signals if s.get("triggered")]
    bull = [s for s in triggered if s.get("direction") == "bull"]
    bear = [s for s in triggered if s.get("direction") == "bear"]

    bull_score = sum(s.get("strength", 0) for s in bull)
    bear_score = sum(s.get("strength", 0) for s in bear)
    total      = bull_score + bear_score

    # Net bias: +1 = all bull, -1 = all bear
    net = (bull_score - bear_score) / max(total, 1)

    if net >= 0.25:
        direction = "BULLISH"
        action    = "BUY" if net >= 0.55 else "WATCH — lean long"
    elif net <= -0.25:
        direction = "BEARISH"
        action    = "SELL" if net <= -0.55 else "WATCH — lean short"
    else:
        direction = "NEUTRAL"
        action    = "HOLD — wait for clearer signal"

    # Confidence 0–100 (scaled by score spread and number of signals)
    max_possible = len(STRATEGY_REGISTRY) * 5
    raw_conf     = abs(bull_score - bear_score) / max(max_possible, 1)
    confidence   = min(100, round(raw_conf * 300))  # scale so 25% spread ≈ 75% confidence

    # Position sizing
    if confidence >= 70:
        sizing = "Full position — 3–5% of portfolio"
    elif confidence >= 45:
        sizing = "Half position — 1.5–2.5% of portfolio"
    elif confidence >= 25:
        sizing = "Quarter position — 0.5–1% of portfolio"
    else:
        sizing = "No position — insufficient confluence"

    # Primary signals (top 3 by strength)
    primary = sorted(triggered, key=lambda s: s.get("strength", 0), reverse=True)[:3]

    # Fibonacci from full visible price range
    ohlcv  = ta.get("ohlcv", [])
    highs  = [b["high"] for b in ohlcv if b.get("high") is not None]
    lows   = [b["low"]  for b in ohlcv if b.get("low")  is not None]
    swing_h = max(highs) if highs else 0
    swing_l = min(lows)  if lows  else 0
    fib    = compute_fibonacci(swing_l, swing_h) if swing_h > swing_l else {}

    # Nearest fib to current price
    current   = ta.get("current_price") or (ohlcv[-1]["close"] if ohlcv else 0)
    key_fib   = None
    key_label = None
    if fib and current:
        key_label, key_fib = min(
            ((k, v) for k, v in fib.items()),
            key=lambda kv: abs(kv[1] - current),
        )

    # Summary narrative
    if direction == "BULLISH":
        primary_names = ", ".join(s["name"] for s in primary) or "multiple indicators"
        summary = (
            f"{symbol} is exhibiting {len(bull)} bullish signal{'s' if len(bull)!=1 else ''} "
            f"vs {len(bear)} bearish, with a net conviction score of "
            f"+{bull_score - bear_score}. "
            f"Primary drivers: {primary_names}. "
            f"The weight of evidence strongly favors LONG exposure. "
            f"Key Fibonacci support: {key_label} at ${key_fib:.2f}." if key_fib else ""
        )
    elif direction == "BEARISH":
        primary_names = ", ".join(s["name"] for s in primary) or "multiple indicators"
        summary = (
            f"{symbol} is showing {len(bear)} bearish signal{'s' if len(bear)!=1 else ''} "
            f"vs {len(bull)} bullish, net conviction score "
            f"{bear_score - bull_score}. "
            f"Primary drivers: {primary_names}. "
            f"Evidence favors SHORT or defensive positioning. "
            f"Key Fibonacci resistance: {key_label} at ${key_fib:.2f}." if key_fib else ""
        )
    else:
        summary = (
            f"{symbol} has mixed or insufficient signals "
            f"({len(bull)} bullish, {len(bear)} bearish). "
            "No directional edge is present. Remain in cash or use minimal size. "
            "Wait for a clearer setup before committing capital."
        )

    return {
        "direction":      direction,
        "confidence":     confidence,
        "bull_count":     len(bull),
        "bear_count":     len(bear),
        "bull_score":     bull_score,
        "bear_score":     bear_score,
        "net_score":      round(net, 3),
        "summary":        summary,
        "action":         action,
        "position_sizing": sizing,
        "primary_signals": [s["name"] for s in primary],
        "fib_levels":     fib,
        "key_fib_label":  key_label,
        "key_fib_level":  round(key_fib, 4) if key_fib else None,
        "current_price":  current,
        "swing_high":     round(swing_h, 4),
        "swing_low":      round(swing_l, 4),
    }
