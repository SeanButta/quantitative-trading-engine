"""
Backtest Engine
===============
Event-driven backtesting with strict no-lookahead-bias guarantee.

Signal at t → Trade at open of t+1.

Includes:
- Fees (bps)
- Slippage (bps)
- Turnover tracking
- Full metric suite: CAGR, vol, Sharpe, Sortino, max drawdown, alpha
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
import polars as pl
from scipy import stats

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Backtest Config
# ---------------------------------------------------------------------------

@dataclass
class BacktestConfig:
    fee_bps: float = 1.0          # one-way fee in basis points
    slippage_bps: float = 2.0     # one-way slippage in basis points
    risk_free_rate: float = 0.03  # annualized
    execution: str = "next_open"  # "next_open" | "next_close"
    initial_capital: float = 1_000_000.0
    max_position: float = 0.25    # max weight per asset


# ---------------------------------------------------------------------------
# Trade Log
# ---------------------------------------------------------------------------

@dataclass
class Trade:
    timestamp: object
    symbol: str
    direction: int   # +1 buy, -1 sell
    quantity: float
    price: float
    fee: float
    slippage: float
    net_value: float


# ---------------------------------------------------------------------------
# Backtest Result
# ---------------------------------------------------------------------------

@dataclass
class BacktestResult:
    equity_curve: np.ndarray
    timestamps: list
    daily_returns: np.ndarray
    trades: list[Trade]
    weights_history: list[dict]
    metrics: dict
    run_id: str = ""

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "metrics": self.metrics,
            "equity_curve": self.equity_curve.tolist(),
            "timestamps": [str(t) for t in self.timestamps],
            "daily_returns": self.daily_returns.tolist(),
            "n_trades": len(self.trades),
        }


# ---------------------------------------------------------------------------
# Backtest Engine
# ---------------------------------------------------------------------------

class BacktestEngine:
    def __init__(self, config: BacktestConfig = None):
        self.config = config or BacktestConfig()

    def run(
        self,
        prices: pl.DataFrame,
        signals: pl.DataFrame,
        weights_fn: Callable[[dict, dict], dict] = None,
    ) -> BacktestResult:
        """
        Run backtest.

        prices: DataFrame with (timestamp, symbol, open, close)
        signals: DataFrame with (timestamp, symbol, signal columns...)
        weights_fn: optional function(signal_row, prev_weights) → target_weights

        Default weight function: equal weight among assets with signal > 0.
        """
        if weights_fn is None:
            weights_fn = self._default_weights_fn

        symbols = prices["symbol"].unique().sort().to_list()
        timestamps = prices["timestamp"].unique().sort().to_list()

        # Build price lookup
        price_lookup = {}
        for row in prices.iter_rows(named=True):
            price_lookup[(row["timestamp"], row["symbol"])] = row

        # Build signal lookup
        sig_cols = [c for c in signals.columns if c not in ("timestamp", "symbol")]
        signal_lookup = {}
        for row in signals.iter_rows(named=True):
            signal_lookup[(row["timestamp"], row["symbol"])] = {
                c: row[c] for c in sig_cols
            }

        # Portfolio state
        capital = self.config.initial_capital
        positions = {sym: 0.0 for sym in symbols}  # shares held
        prev_weights = {sym: 0.0 for sym in symbols}

        equity_curve = []
        daily_returns = []
        trades = []
        weights_history = []

        fee_mult = self.config.fee_bps / 10_000
        slip_mult = self.config.slippage_bps / 10_000

        for i, ts in enumerate(timestamps):
            # Portfolio value at this timestamp (using close prices)
            portfolio_value = capital
            for sym in symbols:
                price_row = price_lookup.get((ts, sym))
                if price_row and positions[sym] != 0:
                    portfolio_value += positions[sym] * price_row["close"]

            equity_curve.append(portfolio_value)

            if i == 0:
                daily_returns.append(0.0)
                weights_history.append(prev_weights.copy())
                continue

            prev_val = equity_curve[i - 1]
            daily_ret = (portfolio_value - prev_val) / prev_val if prev_val > 0 else 0.0
            daily_returns.append(daily_ret)

            # --- Signal → Target Weights (using CURRENT bar signals, trade NEXT bar) ---
            if i < len(timestamps) - 1:
                next_ts = timestamps[i + 1]

                # Get signals for current timestamp
                current_signals = {}
                for sym in symbols:
                    current_signals[sym] = signal_lookup.get((ts, sym), {})

                # Compute target weights
                target_weights = weights_fn(current_signals, prev_weights, symbols)

                # Execute trades at next open
                for sym in symbols:
                    target_w = target_weights.get(sym, 0.0)
                    current_w = prev_weights.get(sym, 0.0)

                    if abs(target_w - current_w) < 1e-4:
                        continue

                    next_price_row = price_lookup.get((next_ts, sym))
                    if next_price_row is None:
                        continue

                    exec_price = next_price_row["open"]
                    trade_value = (target_w - current_w) * portfolio_value

                    # Apply slippage (adverse)
                    direction = 1 if trade_value > 0 else -1
                    slippage = abs(trade_value) * slip_mult * direction
                    fee = abs(trade_value) * fee_mult

                    net_cost = trade_value + slippage + fee * direction

                    # Update positions
                    shares_delta = trade_value / exec_price if exec_price > 0 else 0
                    positions[sym] += shares_delta
                    capital -= net_cost

                    trades.append(Trade(
                        timestamp=next_ts,
                        symbol=sym,
                        direction=direction,
                        quantity=abs(shares_delta),
                        price=exec_price,
                        fee=fee,
                        slippage=abs(slippage),
                        net_value=trade_value,
                    ))

                prev_weights = target_weights.copy()

            weights_history.append(prev_weights.copy())

        # --- Compute Metrics ---
        equity = np.array(equity_curve)
        rets = np.array(daily_returns)
        metrics = self._compute_metrics(equity, rets, trades)

        return BacktestResult(
            equity_curve=equity,
            timestamps=timestamps,
            daily_returns=rets,
            trades=trades,
            weights_history=weights_history,
            metrics=metrics,
        )

    def _default_weights_fn(
        self,
        signals: dict[str, dict],
        prev_weights: dict[str, float],
        symbols: list[str],
    ) -> dict[str, float]:
        """
        Equal-weight among symbols with positive combined signal.
        Uses first available signal column.
        """
        eligible = []
        for sym in symbols:
            sig = signals.get(sym, {})
            if not sig:
                continue
            # Take first signal value
            vals = [v for v in sig.values() if v is not None and not np.isnan(v)]
            if vals and vals[0] > 0:
                eligible.append(sym)

        if not eligible:
            return {sym: 0.0 for sym in symbols}

        w = 1.0 / len(eligible)
        weights = {}
        for sym in symbols:
            weights[sym] = w if sym in eligible else 0.0

        # Apply max position cap
        for sym in weights:
            weights[sym] = min(weights[sym], self.config.max_position)

        # Re-normalize
        total = sum(weights.values())
        if total > 0:
            weights = {sym: w / total for sym, w in weights.items()}

        return weights

    def _compute_metrics(
        self,
        equity: np.ndarray,
        returns: np.ndarray,
        trades: list[Trade],
    ) -> dict:
        n = len(returns)
        if n < 2:
            return {}

        valid = returns[~np.isnan(returns)]
        if len(valid) == 0:
            return {}

        # CAGR
        total_return = (equity[-1] / equity[0]) - 1 if equity[0] > 0 else 0
        years = n / 252
        cagr = (1 + total_return) ** (1 / years) - 1 if years > 0 else 0

        # Volatility (annualized)
        vol = float(np.std(valid, ddof=1) * np.sqrt(252))

        # Sharpe
        daily_rf = self.config.risk_free_rate / 252
        excess = valid - daily_rf
        sharpe = float(np.mean(excess) / np.std(excess, ddof=1) * np.sqrt(252)) if np.std(excess) > 0 else 0

        # Sortino
        downside = excess[excess < 0]
        sortino_denom = float(np.std(downside, ddof=1) * np.sqrt(252)) if len(downside) > 1 else 1.0
        sortino = float(np.mean(excess) * 252 / sortino_denom) if sortino_denom > 0 else 0.0

        # Max Drawdown
        peak = np.maximum.accumulate(equity)
        drawdown = (equity - peak) / peak
        max_dd = float(drawdown.min())

        # Calmar
        calmar = cagr / abs(max_dd) if max_dd != 0 else 0.0

        # Turnover
        total_traded = sum(abs(t.net_value) for t in trades)
        avg_equity = float(np.mean(equity))
        annual_turnover = total_traded / avg_equity / years if years > 0 and avg_equity > 0 else 0

        # Alpha regression (vs SPY-like market, we use returns[0] as proxy)
        # Simple OLS: strategy = alpha + beta * market
        market_ret = valid  # placeholder if no benchmark provided
        alpha_reg = self._alpha_regression(valid)

        return {
            "cagr": round(cagr, 6),
            "total_return": round(total_return, 6),
            "volatility": round(vol, 6),
            "sharpe_ratio": round(sharpe, 6),
            "sortino_ratio": round(sortino, 6),
            "max_drawdown": round(max_dd, 6),
            "calmar_ratio": round(calmar, 6),
            "annual_turnover": round(annual_turnover, 4),
            "n_trades": len(trades),
            "total_fees": round(sum(t.fee for t in trades), 2),
            "total_slippage": round(sum(t.slippage for t in trades), 2),
            "alpha_annualized": alpha_reg.get("alpha", 0),
            "alpha_t_stat": alpha_reg.get("t_stat", 0),
            "alpha_p_value": alpha_reg.get("p_value", 1),
            "n_days": n,
        }

    @staticmethod
    def _alpha_regression(returns: np.ndarray) -> dict:
        """OLS of returns ~ constant (intercept = alpha)."""
        import statsmodels.api as sm
        if len(returns) < 30:
            return {"alpha": 0, "t_stat": 0, "p_value": 1}
        X = np.ones(len(returns))
        try:
            model = sm.OLS(returns, X)
            result = model.fit(cov_type="HAC", cov_kwds={"maxlags": 5})
            alpha = float(result.params[0]) * 252
            t_stat = float(result.tvalues[0])
            p_value = float(result.pvalues[0])
            return {"alpha": round(alpha, 6), "t_stat": round(t_stat, 4), "p_value": round(p_value, 6)}
        except Exception:
            return {"alpha": 0, "t_stat": 0, "p_value": 1}


# ---------------------------------------------------------------------------
# Walk-Forward Backtest
# ---------------------------------------------------------------------------

class WalkForwardEngine:
    """
    Walk-forward backtest: train on past data, test on next window.
    Prevents in-sample optimization.
    """

    def __init__(
        self,
        config: BacktestConfig = None,
        train_periods: int = 504,  # 2 years
        test_periods: int = 126,   # 6 months
    ):
        self.config = config or BacktestConfig()
        self.engine = BacktestEngine(self.config)
        self.train_periods = train_periods
        self.test_periods = test_periods

    def run(
        self,
        prices: pl.DataFrame,
        signals: pl.DataFrame,
        weights_fn=None,
    ) -> dict:
        timestamps = prices["timestamp"].unique().sort().to_list()
        n = len(timestamps)

        all_returns = []
        all_timestamps = []
        splits = []

        i = self.train_periods
        while i + self.test_periods <= n:
            test_start = timestamps[i]
            test_end = timestamps[min(i + self.test_periods - 1, n - 1)]

            # Filter to train + test window
            prices_window = prices.filter(
                pl.col("timestamp") <= timestamps[i + self.test_periods - 1]
            )
            signals_window = signals.filter(
                pl.col("timestamp") <= timestamps[i + self.test_periods - 1]
            )

            # Run on test period only
            prices_test = prices.filter(
                (pl.col("timestamp") >= timestamps[i]) &
                (pl.col("timestamp") <= timestamps[i + self.test_periods - 1])
            )
            signals_test = signals.filter(
                (pl.col("timestamp") >= timestamps[i]) &
                (pl.col("timestamp") <= timestamps[i + self.test_periods - 1])
            )

            if len(prices_test) == 0:
                i += self.test_periods
                continue

            try:
                result = self.engine.run(prices_test, signals_test, weights_fn)
                all_returns.extend(result.daily_returns.tolist())
                all_timestamps.extend([str(t) for t in result.timestamps])

                splits.append({
                    "train_end": str(timestamps[i - 1]),
                    "test_start": str(test_start),
                    "test_end": str(test_end),
                    "metrics": result.metrics,
                })
            except Exception as e:
                logger.error(f"Walk-forward split failed: {e}")

            i += self.test_periods

        combined_rets = np.array(all_returns)
        engine_tmp = BacktestEngine(self.config)
        combined_equity = (1 + combined_rets).cumprod() * self.config.initial_capital

        return {
            "splits": splits,
            "combined_metrics": engine_tmp._compute_metrics(combined_equity, combined_rets, []),
            "n_splits": len(splits),
            "combined_returns": combined_rets.tolist(),
            "combined_timestamps": all_timestamps,
        }
