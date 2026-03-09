"""
Pairs Trading Engine
====================
Engle-Granger cointegration screening, Kalman-filter dynamic hedge
ratio, z-score entry/exit signals, and backtest-compatible signal
generation.

Not financial advice.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np
import polars as pl
from statsmodels.tsa.stattools import adfuller, coint
from statsmodels.regression.linear_model import OLS
from statsmodels.tools.tools import add_constant

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CointegrationResult
# ---------------------------------------------------------------------------

@dataclass
class CointegrationResult:
    symbol_a: str
    symbol_b: str
    adf_stat: float           # ADF test statistic on the spread
    p_value: float            # cointegration p-value
    is_cointegrated: bool     # p_value < 0.05
    hedge_ratio: float        # OLS-estimated static hedge ratio
    half_life: float          # Ornstein-Uhlenbeck half-life (days)
    spread_mean: float
    spread_std: float
    correlation: float        # price-level correlation
    lookback_days: int
    tested_at: datetime


# ---------------------------------------------------------------------------
# KalmanPairsFilter
# ---------------------------------------------------------------------------

class KalmanPairsFilter:
    """
    One-dimensional Kalman filter for estimating a dynamic hedge ratio
    between two price series.

    State model:   beta_t  = beta_{t-1} + w_t,   w_t ~ N(0, Q)
    Observation:   y_t     = beta_t * x_t + v_t,  v_t ~ N(0, Vt)

    Parameters
    ----------
    delta : float
        State transition variance.  Controls how quickly the estimated
        hedge ratio is allowed to change.  Smaller values → slower
        adaptation.  Default 1e-4.
    vt : float
        Observation noise variance.  Default 1e-3.
    """

    def __init__(self, delta: float = 1e-4, vt: float = 1e-3) -> None:
        if delta <= 0:
            raise ValueError("delta must be positive")
        if vt <= 0:
            raise ValueError("vt must be positive")

        self.Q = delta        # state-transition noise variance
        self.Vt = vt          # observation noise variance

        # Filter state
        self.beta: float = 0.0   # current hedge ratio estimate
        self.P: float = 1.0      # current error covariance
        self._initialised: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Reset filter state for use on a new pair."""
        self.beta = 0.0
        self.P = 1.0
        self._initialised = False

    def update(self, x: float, y: float) -> tuple[float, float, float]:
        """
        Process a single observation (x, y) and return the updated
        (beta, spread, kalman_gain).

        Parameters
        ----------
        x : float
            Price of asset A (the "independent" leg).
        y : float
            Price of asset B (the "dependent" leg).

        Returns
        -------
        beta : float
            Updated hedge ratio estimate.
        spread : float
            y - beta * x
        kalman_gain : float
            Kalman gain K used in this step.
        """
        if not math.isfinite(x) or not math.isfinite(y):
            spread = y - self.beta * x if math.isfinite(y) and math.isfinite(x) else 0.0
            return self.beta, spread, 0.0

        # --- Predict ---
        R = self.P + self.Q                    # predicted error covariance

        # --- Update ---
        denom = x * x * R + self.Vt
        if abs(denom) < 1e-15:
            # Degenerate case: observation provides no information
            K = 0.0
        else:
            K = R * x / denom                  # Kalman gain

        innovation = y - x * self.beta
        self.beta = self.beta + K * innovation  # state update
        self.P = (1.0 - K * x) * R             # covariance update

        # Guard against numerical blowup
        if not math.isfinite(self.beta):
            self.beta = 0.0
            self.P = 1.0
        if not math.isfinite(self.P) or self.P < 0:
            self.P = 1.0

        spread = y - self.beta * x
        return self.beta, spread, K

    def fit_series(
        self,
        x_series: np.ndarray,
        y_series: np.ndarray,
    ) -> np.ndarray:
        """
        Run the Kalman filter over full price series.

        Parameters
        ----------
        x_series : np.ndarray
            Price series for asset A.
        y_series : np.ndarray
            Price series for asset B.

        Returns
        -------
        np.ndarray
            Spread array aligned with the input series.
        """
        self.reset()

        n = min(len(x_series), len(y_series))
        if n == 0:
            return np.array([])

        spreads = np.empty(n)
        for i in range(n):
            _, spread, _ = self.update(float(x_series[i]), float(y_series[i]))
            spreads[i] = spread

        return spreads


# ---------------------------------------------------------------------------
# PairsEngine
# ---------------------------------------------------------------------------

class PairsEngine:
    """
    Core engine for pairs trading / statistical arbitrage.

    Parameters
    ----------
    lookback_days : int
        Number of days used for cointegration estimation.  Default 252.
    z_entry : float
        Z-score magnitude required to enter a trade.  Default 2.0.
    z_exit : float
        Z-score magnitude below which a trade is exited.  Default 0.5.
    """

    def __init__(
        self,
        lookback_days: int = 252,
        z_entry: float = 2.0,
        z_exit: float = 0.5,
    ) -> None:
        self.lookback_days = lookback_days
        self.z_entry = z_entry
        self.z_exit = z_exit
        self._kalman = KalmanPairsFilter()

    # ------------------------------------------------------------------
    # Cointegration
    # ------------------------------------------------------------------

    def test_cointegration(
        self,
        prices_a: np.ndarray,
        prices_b: np.ndarray,
        sym_a: str,
        sym_b: str,
    ) -> CointegrationResult:
        """
        Run Engle-Granger cointegration test on a price pair.

        Steps
        -----
        1. OLS regression: prices_b ~ prices_a  →  hedge ratio beta
        2. Compute spread = prices_b - beta * prices_a
        3. ADF test on the spread
        4. Ornstein-Uhlenbeck half-life from AR(1) fit on spread differences

        Parameters
        ----------
        prices_a, prices_b : np.ndarray
            Equal-length price series with no leading NaN values.
        sym_a, sym_b : str
            Ticker symbols.

        Returns
        -------
        CointegrationResult
        """
        fallback = CointegrationResult(
            symbol_a=sym_a,
            symbol_b=sym_b,
            adf_stat=0.0,
            p_value=1.0,
            is_cointegrated=False,
            hedge_ratio=1.0,
            half_life=float("inf"),
            spread_mean=0.0,
            spread_std=1.0,
            correlation=0.0,
            lookback_days=self.lookback_days,
            tested_at=datetime.utcnow(),
        )

        try:
            n = min(len(prices_a), len(prices_b))
            if n < 30:
                logger.debug(
                    "Skipping %s/%s: insufficient data (%d < 30 obs)", sym_a, sym_b, n
                )
                return fallback

            pa = np.asarray(prices_a[:n], dtype=float)
            pb = np.asarray(prices_b[:n], dtype=float)

            # Drop rows where either series is NaN/Inf
            valid = np.isfinite(pa) & np.isfinite(pb)
            pa = pa[valid]
            pb = pb[valid]
            n = len(pa)
            if n < 30:
                return fallback

            # 1. OLS: pb ~ pa → hedge ratio
            X = add_constant(pa)
            try:
                ols_result = OLS(pb, X).fit()
                beta = float(ols_result.params[1])
            except Exception:
                beta = float(np.cov(pa, pb)[0, 1] / np.var(pa)) if np.var(pa) > 0 else 1.0

            # 2. Spread
            spread = pb - beta * pa

            # 3. ADF test on spread
            try:
                adf_out = adfuller(spread, autolag="AIC")
                adf_stat = float(adf_out[0])
                p_value = float(adf_out[1])
            except Exception as exc:
                logger.debug("ADF failed for %s/%s: %s", sym_a, sym_b, exc)
                return fallback

            # 4. Half-life (OU process via AR(1) on spread differences)
            half_life = self._compute_half_life(spread)

            # Price-level correlation
            corr = float(np.corrcoef(pa, pb)[0, 1]) if n >= 2 else 0.0

            return CointegrationResult(
                symbol_a=sym_a,
                symbol_b=sym_b,
                adf_stat=adf_stat,
                p_value=p_value,
                is_cointegrated=p_value < 0.05,
                hedge_ratio=beta,
                half_life=half_life,
                spread_mean=float(np.mean(spread)),
                spread_std=float(np.std(spread, ddof=1)) if n > 1 else 1.0,
                correlation=corr,
                lookback_days=self.lookback_days,
                tested_at=datetime.utcnow(),
            )

        except Exception as exc:
            logger.warning("test_cointegration failed for %s/%s: %s", sym_a, sym_b, exc)
            return fallback

    @staticmethod
    def _compute_half_life(spread: np.ndarray) -> float:
        """
        Estimate Ornstein-Uhlenbeck half-life via AR(1) on spread differences.

        Returns float (days), clipped to [1, 1e6].
        """
        try:
            n = len(spread)
            if n < 4:
                return float("inf")

            spread_lag = spread[:-1]
            spread_diff = np.diff(spread)

            # Guard against constant spread
            if np.std(spread_lag) < 1e-12:
                return float("inf")

            X = add_constant(spread_lag)
            ols = OLS(spread_diff, X).fit()
            lam = float(ols.params[1])   # AR(1) coefficient on lagged spread

            # lam should be negative for mean-reversion; guard against explosive/unit-root
            if lam >= 0 or not math.isfinite(lam):
                return float("inf")

            # Correct discrete OU half-life: hl = log(0.5) / log(1 + λ)
            # 1 + λ must be in (0, 1) for stationary mean-reversion
            persistence = 1.0 + lam
            if persistence <= 0 or persistence >= 1:
                return float("inf")

            half_life = -math.log(2) / math.log(persistence)

            if not math.isfinite(half_life) or half_life <= 0:
                return float("inf")

            return float(np.clip(half_life, 1.0, 1e6))

        except Exception:
            return float("inf")

    # ------------------------------------------------------------------
    # Universe Screening
    # ------------------------------------------------------------------

    def screen_universe(
        self,
        price_data: dict[str, np.ndarray],
        min_correlation: float = 0.7,
    ) -> list[CointegrationResult]:
        """
        Test all pairs whose price-level correlation exceeds
        *min_correlation*, keep those that are cointegrated with a
        sensible half-life, and return sorted by p-value ascending.

        A maximum of 50 pairs is returned.

        Parameters
        ----------
        price_data : dict[str, np.ndarray]
            Mapping of ticker → price array (same-length arrays assumed).
        min_correlation : float
            Minimum absolute correlation to consider a pair.

        Returns
        -------
        list[CointegrationResult]
            Cointegrated pairs sorted by p_value ascending, capped at 50.
        """
        symbols = sorted(price_data.keys())
        n_sym = len(symbols)

        if n_sym < 2:
            return []

        # Align lengths
        min_len = min(len(v) for v in price_data.values())
        arrays = {s: np.asarray(price_data[s][:min_len], dtype=float) for s in symbols}

        # Pre-compute correlation matrix to skip uncorrelated pairs early
        price_matrix = np.column_stack([arrays[s] for s in symbols])
        # Handle NaN columns
        corr_matrix = np.full((n_sym, n_sym), np.nan)
        for i in range(n_sym):
            for j in range(i + 1, n_sym):
                mask = np.isfinite(price_matrix[:, i]) & np.isfinite(price_matrix[:, j])
                if mask.sum() >= 2:
                    try:
                        c = float(np.corrcoef(price_matrix[mask, i], price_matrix[mask, j])[0, 1])
                        corr_matrix[i, j] = c
                        corr_matrix[j, i] = c
                    except Exception:
                        pass

        results: list[CointegrationResult] = []

        for i in range(n_sym):
            for j in range(i + 1, n_sym):
                corr = corr_matrix[i, j]
                if not math.isfinite(corr) or abs(corr) < min_correlation:
                    continue

                sym_a = symbols[i]
                sym_b = symbols[j]

                try:
                    result = self.test_cointegration(
                        arrays[sym_a], arrays[sym_b], sym_a, sym_b
                    )
                except Exception as exc:
                    logger.debug("Skipping pair %s/%s: %s", sym_a, sym_b, exc)
                    continue

                if not result.is_cointegrated:
                    continue

                if not (3.0 <= result.half_life <= 60.0):
                    continue

                results.append(result)

        results.sort(key=lambda r: r.p_value)
        return results[:50]

    # ------------------------------------------------------------------
    # Signal Generation
    # ------------------------------------------------------------------

    def generate_signals(
        self,
        prices_a: np.ndarray,
        prices_b: np.ndarray,
        sym_a: str,
        sym_b: str,
        timestamps: list,
    ) -> pl.DataFrame:
        """
        Generate entry/exit signals for a pair using a dynamic Kalman
        hedge ratio and a 21-day rolling z-score.

        Signal convention
        -----------------
        z_score > z_entry  → SHORT spread  (sell A, buy B):
                              signal_a = -1, signal_b = +1
        z_score < -z_entry → LONG spread   (buy A, sell B):
                              signal_a = +1, signal_b = -1
        |z_score| < z_exit → EXIT:
                              signal_a =  0, signal_b =  0
        Between entry and exit: hold previous signal (no flipping).

        Parameters
        ----------
        prices_a, prices_b : np.ndarray
            Price series.
        sym_a, sym_b : str
            Ticker symbols (used for output column names).
        timestamps : list
            Timestamps aligned with the price arrays.

        Returns
        -------
        pl.DataFrame
            Columns: timestamp, {sym_a}_signal, {sym_b}_signal,
                     spread, z_score, hedge_ratio, position
        """
        n = min(len(prices_a), len(prices_b), len(timestamps))
        if n == 0:
            return pl.DataFrame()

        pa = np.asarray(prices_a[:n], dtype=float)
        pb = np.asarray(prices_b[:n], dtype=float)
        ts = list(timestamps[:n])

        # --- Kalman filter for dynamic spread ---
        kalman = KalmanPairsFilter()
        spreads = np.empty(n)
        betas = np.empty(n)

        for i in range(n):
            beta_i, spread_i, _ = kalman.update(float(pa[i]), float(pb[i]))
            spreads[i] = spread_i
            betas[i] = beta_i

        # --- Rolling z-score (21-day window) ---
        window = 21
        z_scores = np.full(n, np.nan)
        for i in range(window - 1, n):
            window_spread = spreads[i - window + 1: i + 1]
            mu = np.nanmean(window_spread)
            sigma = np.nanstd(window_spread, ddof=1)
            if sigma > 1e-10:
                z_scores[i] = (spreads[i] - mu) / sigma
            else:
                z_scores[i] = 0.0

        # --- Signal state machine ---
        sig_a = np.zeros(n, dtype=int)
        sig_b = np.zeros(n, dtype=int)
        positions = ["flat"] * n

        prev_a = 0
        prev_b = 0

        for i in range(n):
            z = z_scores[i]
            if not math.isfinite(z):
                sig_a[i] = prev_a
                sig_b[i] = prev_b
                positions[i] = _pos_label(prev_a, prev_b)
                continue

            if z > self.z_entry:
                # Short spread: sell A, buy B
                new_a, new_b = -1, 1
            elif z < -self.z_entry:
                # Long spread: buy A, sell B
                new_a, new_b = 1, -1
            elif abs(z) < self.z_exit:
                # Exit condition
                new_a, new_b = 0, 0
            else:
                # In between: hold previous signal
                new_a, new_b = prev_a, prev_b

            sig_a[i] = new_a
            sig_b[i] = new_b
            positions[i] = _pos_label(new_a, new_b)
            prev_a = new_a
            prev_b = new_b

        return pl.DataFrame(
            {
                "timestamp": ts,
                f"{sym_a}_signal": sig_a.tolist(),
                f"{sym_b}_signal": sig_b.tolist(),
                "spread": spreads.tolist(),
                "z_score": z_scores.tolist(),
                "hedge_ratio": betas.tolist(),
                "position": positions,
            }
        )

    # ------------------------------------------------------------------
    # Backtest
    # ------------------------------------------------------------------

    def backtest_pair(
        self,
        prices_a: np.ndarray,
        prices_b: np.ndarray,
        sym_a: str,
        sym_b: str,
        timestamps: list,
        fee_bps: float = 2.0,
    ) -> dict:
        """
        Simple pairs backtest that mirrors the conventions used in
        BacktestEngine (signal at t, trade at t+1).

        Parameters
        ----------
        prices_a, prices_b : np.ndarray
            Price series.
        sym_a, sym_b : str
            Ticker symbols.
        timestamps : list
            Timestamps aligned with the price arrays.
        fee_bps : float
            One-way transaction cost in basis points.

        Returns
        -------
        dict
            Keys: total_return, sharpe_ratio, max_drawdown, n_trades,
                  half_life, equity_curve (list of floats).
        """
        signals_df = self.generate_signals(prices_a, prices_b, sym_a, sym_b, timestamps)

        if len(signals_df) == 0:
            return _empty_backtest_result()

        n = min(len(prices_a), len(prices_b), len(signals_df))
        if n < 2:
            return _empty_backtest_result()

        pa = np.asarray(prices_a[:n], dtype=float)
        pb = np.asarray(prices_b[:n], dtype=float)

        sig_a_col = f"{sym_a}_signal"
        sig_b_col = f"{sym_b}_signal"
        sig_a = np.array(signals_df[sig_a_col].to_list(), dtype=float)
        sig_b = np.array(signals_df[sig_b_col].to_list(), dtype=float)

        fee_mult = fee_bps / 10_000.0

        # Daily log-returns (shift by 1 so signal at t drives return at t+1)
        ret_a = np.diff(np.log(np.where(pa > 0, pa, np.nan)))
        ret_b = np.diff(np.log(np.where(pb > 0, pb, np.nan)))

        # Use signal from t to compute return at t+1
        daily_pnl = np.empty(n - 1)
        n_trades = 0

        for i in range(n - 1):
            if not math.isfinite(ret_a[i]) or not math.isfinite(ret_b[i]):
                daily_pnl[i] = 0.0
                continue

            # Position taken from signal at bar i, return earned at bar i+1
            sa = sig_a[i]
            sb = sig_b[i]

            raw_pnl = sa * ret_a[i] + sb * ret_b[i]

            # Fee: charged when position changes
            prev_sa = sig_a[i - 1] if i > 0 else 0.0
            prev_sb = sig_b[i - 1] if i > 0 else 0.0

            fee_cost = 0.0
            if sa != prev_sa:
                fee_cost += fee_mult
                n_trades += 1
            if sb != prev_sb:
                fee_cost += fee_mult
                n_trades += 1

            daily_pnl[i] = raw_pnl - fee_cost

        # Replace any remaining NaN
        daily_pnl = np.where(np.isfinite(daily_pnl), daily_pnl, 0.0)

        # Equity curve
        equity = np.cumprod(1.0 + daily_pnl)

        total_return = float(equity[-1] - 1.0) if len(equity) > 0 else 0.0

        sharpe = 0.0
        if len(daily_pnl) > 1:
            std_pnl = float(np.std(daily_pnl, ddof=1))
            if std_pnl > 1e-10:
                sharpe = float(np.mean(daily_pnl) / std_pnl * math.sqrt(252))

        peak = np.maximum.accumulate(equity)
        drawdown = (equity - peak) / np.where(peak > 0, peak, 1.0)
        max_drawdown = float(drawdown.min()) if len(drawdown) > 0 else 0.0

        # Half-life from the spread generated by Kalman
        spread_col = signals_df["spread"].to_numpy()
        half_life = self._compute_half_life(spread_col)

        return {
            "total_return": round(total_return, 6),
            "sharpe_ratio": round(sharpe, 6),
            "max_drawdown": round(max_drawdown, 6),
            "n_trades": n_trades,
            "half_life": round(half_life, 2) if math.isfinite(half_life) else None,
            "equity_curve": equity.tolist(),
        }


# ---------------------------------------------------------------------------
# PairSignalReading
# ---------------------------------------------------------------------------

@dataclass
class PairSignalReading:
    symbol_a: str
    symbol_b: str
    current_zscore: float
    spread: float
    hedge_ratio: float         # dynamic Kalman beta
    signal_a: int              # -1, 0, +1
    signal_b: int              # -1, 0, +1
    position: str              # "long_spread" / "short_spread" / "flat"
    p_value: float
    half_life: float
    entry_zscore: float        # z_entry threshold
    exit_zscore: float         # z_exit threshold
    blurb: str


# ---------------------------------------------------------------------------
# PairsScreener
# ---------------------------------------------------------------------------

class PairsScreener:
    """
    High-level screener for the API endpoint.

    Usage
    -----
    screener = PairsScreener()
    results  = screener.find_best_pairs(symbol_prices, timestamps)
    """

    def __init__(self) -> None:
        self.engine = PairsEngine()

    def find_best_pairs(
        self,
        symbol_prices: dict[str, list[float]],
        timestamps: list[str],
        min_correlation: float = 0.7,
    ) -> list[dict]:
        """
        Screen all pairs and return the top 10 cointegrated pairs with
        live signals and backtest statistics.

        Parameters
        ----------
        symbol_prices : dict[str, list[float]]
            Mapping of ticker → list of closing prices.
        timestamps : list[str]
            Timestamps aligned with the price lists.

        Returns
        -------
        list[dict]
            Up to 10 dicts suitable for JSON serialisation.
            Keys per dict: symbol_a, symbol_b, p_value, hedge_ratio,
            half_life, correlation, current_zscore, signal_a, signal_b,
            recent_return, sharpe.
        """
        if not symbol_prices:
            return []

        # Convert to numpy arrays, clip to common length
        min_len = min(len(v) for v in symbol_prices.values())
        min_len = min(min_len, len(timestamps))

        np_prices: dict[str, np.ndarray] = {
            sym: np.asarray(prices[:min_len], dtype=float)
            for sym, prices in symbol_prices.items()
        }
        ts = list(timestamps[:min_len])

        # Screen universe
        try:
            cointegrated = self.engine.screen_universe(np_prices, min_correlation=min_correlation)
        except Exception as exc:
            logger.error("screen_universe failed: %s", exc)
            return []

        output: list[dict] = []

        for coint_result in cointegrated[:10]:
            sym_a = coint_result.symbol_a
            sym_b = coint_result.symbol_b

            pa = np_prices.get(sym_a)
            pb = np_prices.get(sym_b)
            if pa is None or pb is None:
                continue

            # Generate signals
            try:
                signals_df = self.engine.generate_signals(pa, pb, sym_a, sym_b, ts)
            except Exception as exc:
                logger.warning("generate_signals failed for %s/%s: %s", sym_a, sym_b, exc)
                continue

            if len(signals_df) == 0:
                continue

            # Backtest
            try:
                bt = self.engine.backtest_pair(pa, pb, sym_a, sym_b, ts)
            except Exception as exc:
                logger.warning("backtest_pair failed for %s/%s: %s", sym_a, sym_b, exc)
                bt = _empty_backtest_result()

            # Most recent row
            last_row = signals_df.tail(1)
            current_zscore = _safe_float(last_row["z_score"][0])
            current_spread = _safe_float(last_row["spread"][0])
            current_hr = _safe_float(last_row["hedge_ratio"][0])
            sig_a_col = f"{sym_a}_signal"
            sig_b_col = f"{sym_b}_signal"
            current_sig_a = int(last_row[sig_a_col][0]) if sig_a_col in last_row.columns else 0
            current_sig_b = int(last_row[sig_b_col][0]) if sig_b_col in last_row.columns else 0

            half_life_val = (
                coint_result.half_life
                if math.isfinite(coint_result.half_life)
                else bt.get("half_life") or 0.0
            )

            # Build spread series for chart (last 90 rows)
            spread_cols = ["timestamp", "spread", "z_score"]
            available_cols = [c for c in spread_cols if c in signals_df.columns]
            spread_series = (
                signals_df.select(available_cols).tail(90).to_dicts()
                if available_cols
                else []
            )

            output.append(
                {
                    "symbol_a": sym_a,
                    "symbol_b": sym_b,
                    "p_value": round(coint_result.p_value, 6),
                    "hedge_ratio": round(current_hr, 6),
                    "half_life": round(float(half_life_val), 2) if half_life_val else None,
                    "correlation": round(coint_result.correlation, 4),
                    "current_zscore": round(current_zscore, 4),
                    "signal_a": current_sig_a,
                    "signal_b": current_sig_b,
                    "position": _pos_label(current_sig_a, current_sig_b),
                    "spread_series": spread_series,
                    "recent_return": bt.get("total_return", 0.0),
                    "sharpe": bt.get("sharpe_ratio", 0.0),
                }
            )

        return output


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pos_label(sig_a: int, sig_b: int) -> str:
    """Map (signal_a, signal_b) to a human-readable position label."""
    if sig_a == 1 and sig_b == -1:
        return "long_spread"
    if sig_a == -1 and sig_b == 1:
        return "short_spread"
    return "flat"


def _empty_backtest_result() -> dict:
    return {
        "total_return": 0.0,
        "sharpe_ratio": 0.0,
        "max_drawdown": 0.0,
        "n_trades": 0,
        "half_life": None,
        "equity_curve": [],
    }


def _safe_float(value, default: float = 0.0) -> float:
    """Return a finite float, substituting *default* for NaN/Inf/None."""
    try:
        v = float(value)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default
