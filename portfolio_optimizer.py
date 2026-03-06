"""
Portfolio Optimizer
===================
Markowitz mean-variance optimization.

Objectives:
- min_variance: Global minimum variance portfolio
- max_sharpe:   Maximum Sharpe ratio portfolio
- target_return: Minimum variance for a given return target

Also computes the efficient frontier.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import polars as pl
from scipy.optimize import minimize

logger = logging.getLogger(__name__)


@dataclass
class OptimizationResult:
    weights: dict[str, float]
    portfolio_return: float
    portfolio_volatility: float
    sharpe_ratio: float
    objective: str

    def to_dict(self) -> dict:
        return {
            "weights": self.weights,
            "portfolio_return": round(self.portfolio_return, 6),
            "portfolio_volatility": round(self.portfolio_volatility, 6),
            "sharpe_ratio": round(self.sharpe_ratio, 6),
            "objective": self.objective,
        }


class MarkowitzOptimizer:
    def __init__(self, risk_free_rate: float = 0.03):
        self.risk_free_rate = risk_free_rate

    def _prepare(self, returns_df: pl.DataFrame) -> tuple[np.ndarray, np.ndarray, list[str]]:
        """
        Build annualized mean return vector and covariance matrix.
        returns_df: polars DataFrame with columns [timestamp, symbol, returns]
        """
        pivot = (
            returns_df.pivot(index="timestamp", columns="symbol", values="returns")
            .sort("timestamp")
        )
        symbols = [c for c in pivot.columns if c != "timestamp"]
        mat = pivot.select(symbols).to_numpy().astype(float)

        # Drop rows with any NaN
        valid = ~np.isnan(mat).any(axis=1)
        mat = mat[valid]

        if len(mat) < 10:
            raise ValueError("Too few observations for optimization.")

        mu = np.mean(mat, axis=0) * 252
        cov = np.cov(mat.T) * 252

        return mu, cov, symbols

    def optimize(
        self,
        returns_df: pl.DataFrame,
        objective: str = "min_variance",
        weight_bounds: tuple[float, float] = (0.0, 1.0),
        target_return: float = None,
    ) -> OptimizationResult:
        mu, cov, symbols = self._prepare(returns_df)
        n = len(symbols)

        bounds = [weight_bounds] * n
        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]

        if objective == "target_return" and target_return is not None:
            constraints.append({
                "type": "eq",
                "fun": lambda w: float(w @ mu) - target_return,
            })

        w0 = np.ones(n) / n

        if objective == "min_variance":
            def obj_fn(w):
                return float(w @ cov @ w)
        elif objective == "max_sharpe":
            def obj_fn(w):
                port_ret = float(w @ mu)
                port_vol = float(np.sqrt(w @ cov @ w))
                if port_vol <= 0:
                    return 1e9
                return -(port_ret - self.risk_free_rate) / port_vol
        elif objective == "target_return":
            def obj_fn(w):
                return float(w @ cov @ w)
        else:
            raise ValueError(f"Unknown objective: {objective}")

        result = minimize(
            obj_fn,
            w0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000, "ftol": 1e-9},
        )

        if not result.success:
            logger.warning(f"Optimizer did not converge: {result.message}")

        w_opt = result.x
        w_opt = np.maximum(w_opt, 0)
        w_opt /= w_opt.sum()

        port_ret = float(w_opt @ mu)
        port_vol = float(np.sqrt(w_opt @ cov @ w_opt))
        sr = (port_ret - self.risk_free_rate) / port_vol if port_vol > 0 else 0.0

        return OptimizationResult(
            weights={sym: round(float(w), 6) for sym, w in zip(symbols, w_opt)},
            portfolio_return=port_ret,
            portfolio_volatility=port_vol,
            sharpe_ratio=sr,
            objective=objective,
        )

    def efficient_frontier(
        self,
        returns_df: pl.DataFrame,
        n_points: int = 20,
        weight_bounds: tuple[float, float] = (0.0, 1.0),
    ) -> list[dict]:
        mu, cov, symbols = self._prepare(returns_df)
        n = len(symbols)

        # Find min and max feasible returns
        bounds = [weight_bounds] * n
        constraints_base = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        w0 = np.ones(n) / n

        # Min variance point
        min_var_res = minimize(
            lambda w: float(w @ cov @ w),
            w0, method="SLSQP", bounds=bounds, constraints=constraints_base,
            options={"maxiter": 500},
        )
        w_min = np.maximum(min_var_res.x, 0)
        w_min /= w_min.sum()
        ret_min = float(w_min @ mu)

        # Max return = max weight in highest return asset
        ret_max = float(mu.max())

        target_returns = np.linspace(ret_min, ret_max * 0.99, n_points)
        frontier = []

        for tr in target_returns:
            constraints = constraints_base + [{
                "type": "eq",
                "fun": lambda w, r=tr: float(w @ mu) - r,
            }]
            res = minimize(
                lambda w: float(w @ cov @ w),
                w0, method="SLSQP", bounds=bounds, constraints=constraints,
                options={"maxiter": 500},
            )
            if not res.success:
                continue
            w = np.maximum(res.x, 0)
            if w.sum() > 0:
                w /= w.sum()
            port_vol = float(np.sqrt(w @ cov @ w))
            port_ret = float(w @ mu)
            sr = (port_ret - self.risk_free_rate) / port_vol if port_vol > 0 else 0.0
            frontier.append({
                "return": round(port_ret, 6),
                "volatility": round(port_vol, 6),
                "sharpe": round(sr, 6),
                "weights": {sym: round(float(wi), 4) for sym, wi in zip(symbols, w)},
            })

        return frontier
