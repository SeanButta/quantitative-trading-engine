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
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
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


# ---------------------------------------------------------------------------
# Black-Litterman Optimizer
# ---------------------------------------------------------------------------

@dataclass
class BLResult:
    weights: dict[str, float]
    equilibrium_returns: dict[str, float]
    posterior_returns: dict[str, float]
    portfolio_return: float
    portfolio_vol: float
    portfolio_sharpe: float
    n_views: int
    symbols: list[str]

    def to_dict(self) -> dict:
        return {
            "weights": self.weights,
            "equilibrium_returns": self.equilibrium_returns,
            "posterior_returns": self.posterior_returns,
            "portfolio_return": round(self.portfolio_return, 6),
            "portfolio_vol": round(self.portfolio_vol, 6),
            "portfolio_sharpe": round(self.portfolio_sharpe, 6),
            "n_views": self.n_views,
            "symbols": self.symbols,
        }


class BlackLittermanOptimizer:
    """
    Black-Litterman Portfolio Optimizer

    Combines market equilibrium returns (from CAPM) with
    investor views (from signal scores) via Bayesian updating.

    Reference: Black & Litterman (1992), He & Litterman (1999)
    """

    def __init__(self, risk_aversion: float = 2.5, tau: float = 0.05):
        """
        risk_aversion: lambda in CAPM (typically 2-4)
        tau: uncertainty scaling on equilibrium (typically 0.01-0.05)
        """
        self.risk_aversion = risk_aversion
        self.tau = tau
        self.risk_free_rate = 0.03

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _returns_to_matrix(
        self, returns_df: pd.DataFrame
    ) -> tuple[np.ndarray, np.ndarray, list[str]]:
        """
        Accept a pandas DataFrame with columns [timestamp, symbol, returns]
        OR a wide-format DataFrame (columns = symbols, index = dates).
        Returns (mu_annual, cov_annual, symbols).
        """
        if isinstance(returns_df, pd.DataFrame):
            if "symbol" in returns_df.columns and "returns" in returns_df.columns:
                # Long format
                if "timestamp" in returns_df.columns:
                    pivot = returns_df.pivot(
                        index="timestamp", columns="symbol", values="returns"
                    ).sort_index()
                else:
                    pivot = returns_df.pivot_table(
                        index=returns_df.index, columns="symbol", values="returns"
                    ).sort_index()
            else:
                # Assume wide format already
                pivot = returns_df.select_dtypes(include=[np.number])
        else:
            raise TypeError("returns_df must be a pandas DataFrame")

        symbols = list(pivot.columns)
        mat = pivot.to_numpy(dtype=float)

        # Drop rows with any NaN
        valid = ~np.isnan(mat).any(axis=1)
        mat = mat[valid]

        if len(mat) < 5:
            raise ValueError("Too few valid observations for Black-Litterman optimization.")

        mu = np.mean(mat, axis=0) * 252
        cov = np.cov(mat.T) * 252
        if cov.ndim == 0:
            # Single asset — make it a 1x1 matrix
            cov = np.array([[float(cov)]])

        return mu, cov, symbols

    def _markowitz_from_bl(
        self,
        mu_bl: np.ndarray,
        cov_bl: np.ndarray,
        symbols: list[str],
        weight_bounds: tuple[float, float] = (0.0, 1.0),
    ) -> tuple[np.ndarray, float, float, float]:
        """Run max-Sharpe Markowitz using BL posterior mu and cov."""
        n = len(symbols)
        if n == 1:
            w = np.array([1.0])
            port_ret = float(mu_bl[0])
            port_vol = float(np.sqrt(cov_bl[0, 0]))
            sharpe = (port_ret - self.risk_free_rate) / port_vol if port_vol > 0 else 0.0
            return w, port_ret, port_vol, sharpe

        bounds = [weight_bounds] * n
        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        w0 = np.ones(n) / n

        def neg_sharpe(w: np.ndarray) -> float:
            pr = float(w @ mu_bl)
            pv = float(np.sqrt(w @ cov_bl @ w))
            if pv <= 0:
                return 1e9
            return -(pr - self.risk_free_rate) / pv

        result = minimize(
            neg_sharpe,
            w0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000, "ftol": 1e-9},
        )

        if not result.success:
            logger.warning(f"BL Markowitz did not converge: {result.message}")

        w_opt = np.maximum(result.x, 0.0)
        total = w_opt.sum()
        if total <= 0:
            w_opt = np.ones(n) / n
        else:
            w_opt /= total

        port_ret = float(w_opt @ mu_bl)
        port_vol = float(np.sqrt(w_opt @ cov_bl @ w_opt))
        sharpe = (port_ret - self.risk_free_rate) / port_vol if port_vol > 0 else 0.0
        return w_opt, port_ret, port_vol, sharpe

    # ------------------------------------------------------------------
    # Public methods
    # ------------------------------------------------------------------

    def compute_equilibrium_returns(
        self,
        returns_df: pd.DataFrame,
        market_weights: Optional[dict[str, float]] = None,
    ) -> np.ndarray:
        """
        Compute CAPM-implied equilibrium returns.

        π = λ * Σ * w_mkt

        Parameters
        ----------
        returns_df : pd.DataFrame
            Long-format or wide-format returns data.
        market_weights : dict[str, float] or None
            Market capitalisation weights.  If None, equal weights are used.

        Returns
        -------
        np.ndarray
            Annualised equilibrium return vector π of shape (n,).
        """
        _mu, cov, symbols = self._returns_to_matrix(returns_df)
        n = len(symbols)

        if market_weights is not None:
            w_mkt = np.array(
                [market_weights.get(s, 1.0 / n) for s in symbols], dtype=float
            )
            total = w_mkt.sum()
            if total <= 0:
                w_mkt = np.ones(n) / n
            else:
                w_mkt /= total
        else:
            w_mkt = np.ones(n) / n

        pi = self.risk_aversion * cov @ w_mkt
        return pi

    def incorporate_views(
        self,
        returns_df: pd.DataFrame,
        views: list[dict],
        equilibrium_returns: Optional[np.ndarray] = None,
    ) -> BLResult:
        """
        Apply Black-Litterman Bayesian update.

        Parameters
        ----------
        returns_df : pd.DataFrame
            Return data (long or wide format).
        views : list[dict]
            Each view dict supports:
              - Absolute: {"assets": ["AAPL"], "view_return": 0.12, "confidence": 0.7}
              - Relative: {"assets": ["AAPL", "MSFT"], "weights": [1, -1],
                           "view_return": 0.05, "confidence": 0.6}
        equilibrium_returns : np.ndarray or None
            Pre-computed π.  Computed internally if None.

        Returns
        -------
        BLResult
        """
        _mu, cov, symbols = self._returns_to_matrix(returns_df)
        n = len(symbols)
        sym_idx = {s: i for i, s in enumerate(symbols)}

        # Equilibrium returns π
        if equilibrium_returns is not None and len(equilibrium_returns) == n:
            pi = np.asarray(equilibrium_returns, dtype=float)
        else:
            pi = self.compute_equilibrium_returns(returns_df)

        # Filter views to those that reference known symbols
        valid_views: list[dict] = []
        for v in views:
            assets = v.get("assets", [])
            if all(a in sym_idx for a in assets):
                valid_views.append(v)
            else:
                unknown = [a for a in assets if a not in sym_idx]
                logger.warning(
                    f"BL view skipped — unknown symbols: {unknown}"
                )

        k = len(valid_views)

        if k == 0:
            # No valid views — return equilibrium-optimised portfolio
            logger.warning("No valid BL views; falling back to equilibrium returns.")
            w_opt, port_ret, port_vol, sharpe = self._markowitz_from_bl(pi, cov, symbols)
            return BLResult(
                weights={s: round(float(w), 6) for s, w in zip(symbols, w_opt)},
                equilibrium_returns={s: round(float(p), 6) for s, p in zip(symbols, pi)},
                posterior_returns={s: round(float(p), 6) for s, p in zip(symbols, pi)},
                portfolio_return=port_ret,
                portfolio_vol=port_vol,
                portfolio_sharpe=sharpe,
                n_views=0,
                symbols=symbols,
            )

        # Build P (k x n), q (k,), Omega (k x k diagonal)
        P = np.zeros((k, n), dtype=float)
        q = np.zeros(k, dtype=float)
        omega_diag = np.zeros(k, dtype=float)

        for i, v in enumerate(valid_views):
            assets = v["assets"]
            view_return = float(v.get("view_return", 0.0))
            confidence = float(np.clip(v.get("confidence", 0.5), 1e-6, 1.0 - 1e-6))

            if "weights" in v:
                raw_w = np.array(v["weights"], dtype=float)
                total_abs = np.abs(raw_w).sum()
                if total_abs > 0:
                    raw_w /= total_abs
                for j, asset in enumerate(assets):
                    P[i, sym_idx[asset]] = raw_w[j]
            else:
                # Absolute view: single asset row
                for asset in assets:
                    P[i, sym_idx[asset]] = 1.0 / len(assets)

            q[i] = view_return

            # Ω_ii = (1 - c) / c * (P_i Σ P_i')
            p_i = P[i]
            variance_of_view = float(p_i @ cov @ p_i)
            omega_diag[i] = max((1.0 - confidence) / confidence * variance_of_view, 1e-10)

        tau_cov = self.tau * cov
        try:
            tau_cov_inv = np.linalg.inv(tau_cov)
        except np.linalg.LinAlgError:
            tau_cov_inv = np.linalg.pinv(tau_cov)

        Omega_inv = np.diag(1.0 / omega_diag)

        # M = (τΣ)^{-1} + P'Ω^{-1}P
        M = tau_cov_inv + P.T @ Omega_inv @ P
        try:
            M_inv = np.linalg.inv(M)
        except np.linalg.LinAlgError:
            M_inv = np.linalg.pinv(M)

        # Posterior mean
        mu_bl = M_inv @ (tau_cov_inv @ pi + P.T @ Omega_inv @ q)

        # Posterior covariance
        cov_bl = cov + M_inv

        # Markowitz on posterior
        w_opt, port_ret, port_vol, sharpe = self._markowitz_from_bl(mu_bl, cov_bl, symbols)

        return BLResult(
            weights={s: round(float(w), 6) for s, w in zip(symbols, w_opt)},
            equilibrium_returns={s: round(float(p), 6) for s, p in zip(symbols, pi)},
            posterior_returns={s: round(float(m), 6) for s, m in zip(symbols, mu_bl)},
            portfolio_return=port_ret,
            portfolio_vol=port_vol,
            portfolio_sharpe=sharpe,
            n_views=k,
            symbols=symbols,
        )

    def from_signal_scores(
        self,
        returns_df: pd.DataFrame,
        signal_scores: dict[str, float],
    ) -> BLResult:
        """
        Convert signal scores ∈ [-1, +1] to BL views and optimise.

        For each symbol where |score| > 0.15:
          - view_return  = equilibrium_return + score * 0.15
          - confidence   = min(0.9, |score| * 0.8 + 0.1)

        Parameters
        ----------
        returns_df : pd.DataFrame
            Return data.
        signal_scores : dict[str, float]
            Mapping of symbol → score in [-1, +1].

        Returns
        -------
        BLResult
        """
        pi = self.compute_equilibrium_returns(returns_df)
        _mu, _cov, symbols = self._returns_to_matrix(returns_df)
        sym_idx = {s: i for i, s in enumerate(symbols)}
        pi_by_sym = {s: float(pi[i]) for s, i in sym_idx.items()}

        views: list[dict] = []
        for sym, score in signal_scores.items():
            if abs(score) <= 0.15:
                continue
            if sym not in sym_idx:
                logger.warning(f"from_signal_scores: symbol {sym!r} not in returns_df — skipped.")
                continue
            eq_ret = pi_by_sym[sym]
            view_return = eq_ret + float(score) * 0.15
            confidence = min(0.9, abs(float(score)) * 0.8 + 0.1)
            views.append(
                {
                    "assets": [sym],
                    "view_return": view_return,
                    "confidence": confidence,
                }
            )

        return self.incorporate_views(returns_df, views, equilibrium_returns=pi)


# ---------------------------------------------------------------------------
# Risk Analyzer
# ---------------------------------------------------------------------------

@dataclass
class PortfolioRisk:
    portfolio_return_ann: float
    portfolio_vol_ann: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    calmar_ratio: float
    var_95: float
    cvar_95: float
    var_99: float
    cvar_99: float
    beta: float
    correlation_matrix: dict
    drawdown_series: list[dict]
    monthly_returns: list[dict]

    def to_dict(self) -> dict:
        return {
            "portfolio_return_ann": round(self.portfolio_return_ann, 6),
            "portfolio_vol_ann": round(self.portfolio_vol_ann, 6),
            "sharpe_ratio": round(self.sharpe_ratio, 6),
            "sortino_ratio": round(self.sortino_ratio, 6),
            "max_drawdown": round(self.max_drawdown, 6),
            "calmar_ratio": round(self.calmar_ratio, 6),
            "var_95": round(self.var_95, 6),
            "cvar_95": round(self.cvar_95, 6),
            "var_99": round(self.var_99, 6),
            "cvar_99": round(self.cvar_99, 6),
            "beta": round(self.beta, 6),
            "correlation_matrix": self.correlation_matrix,
            "drawdown_series": self.drawdown_series,
            "monthly_returns": self.monthly_returns,
        }


@dataclass
class StressScenario:
    name: str
    description: str
    portfolio_impact: float
    worst_symbol: str
    worst_impact: float
    scenario_returns: dict[str, float]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "portfolio_impact": round(self.portfolio_impact, 6),
            "worst_symbol": self.worst_symbol,
            "worst_impact": round(self.worst_impact, 6),
            "scenario_returns": {k: round(v, 6) for k, v in self.scenario_returns.items()},
        }


# Historical shock vectors (approximate cumulative returns over crisis period)
STRESS_SCENARIOS: dict[str, dict[str, float]] = {
    "2008 GFC": {
        "SPY": -0.37, "QQQ": -0.42, "IWM": -0.34, "GLD": 0.05, "TLT": 0.26,
        "_default_equity": -0.40, "_default_bond": 0.15,
    },
    "2020 COVID Crash": {
        "SPY": -0.34, "QQQ": -0.28, "IWM": -0.43, "GLD": 0.06, "TLT": 0.20,
        "_default_equity": -0.35, "_default_bond": 0.10,
    },
    "2022 Rate Shock": {
        "SPY": -0.19, "QQQ": -0.33, "IWM": -0.21, "GLD": -0.02, "TLT": -0.31,
        "_default_equity": -0.22, "_default_bond": -0.15,
    },
    "2000 Dot-com Bust": {
        "SPY": -0.49, "QQQ": -0.83, "IWM": -0.20, "GLD": 0.12, "TLT": 0.20,
        "_default_equity": -0.45, "_default_bond": 0.08,
    },
    "+100bps Rate Shock": {
        "SPY": -0.08, "QQQ": -0.12, "IWM": -0.07, "GLD": -0.04, "TLT": -0.09,
        "_default_equity": -0.07, "_default_bond": -0.08,
    },
    "Flash Crash -10%": {
        "_default_equity": -0.10, "_default_bond": 0.02, "GLD": 0.01,
    },
}

# Simple heuristic: symbols whose tickers suggest bonds/fixed income
_BOND_LIKE = {"TLT", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "TIP", "GOVT", "VGIT"}


def _classify_symbol(symbol: str) -> str:
    """Return '_default_bond' or '_default_equity' for fallback shock lookup."""
    return "_default_bond" if symbol.upper() in _BOND_LIKE else "_default_equity"


class RiskAnalyzer:
    """
    Portfolio risk analysis: CVaR, stress tests, correlation clustering,
    drawdown analysis, factor decomposition.
    """

    RISK_FREE_RATE: float = 0.03  # annualised

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _to_wide(self, returns_df: pd.DataFrame) -> pd.DataFrame:
        """
        Convert long-format DataFrame [timestamp, symbol, returns] to wide
        format (index=date, columns=symbols).  Pass-through if already wide.
        """
        if "symbol" in returns_df.columns and "returns" in returns_df.columns:
            idx_col = "timestamp" if "timestamp" in returns_df.columns else returns_df.index.name
            if idx_col and idx_col in returns_df.columns:
                wide = returns_df.pivot(
                    index=idx_col, columns="symbol", values="returns"
                ).sort_index()
            else:
                wide = returns_df.pivot_table(
                    index=returns_df.index, columns="symbol", values="returns"
                ).sort_index()
            wide.columns.name = None
            return wide
        # Already wide — keep only numeric columns
        return returns_df.select_dtypes(include=[np.number])

    @staticmethod
    def _clean_returns(arr: np.ndarray) -> np.ndarray:
        """Drop NaN/inf values from a 1-D return array."""
        arr = np.asarray(arr, dtype=float)
        arr = arr[np.isfinite(arr)]
        return arr

    # ------------------------------------------------------------------
    # VaR / CVaR
    # ------------------------------------------------------------------

    def compute_var_cvar(
        self,
        returns: "np.ndarray | pd.Series",
        confidence_levels: list[float] = None,
    ) -> dict:
        """
        Historical VaR, CVaR, parametric VaR, and Cornish-Fisher adjusted VaR.

        Parameters
        ----------
        returns : array-like of daily returns (not annualised)
        confidence_levels : list of floats, e.g. [0.95, 0.99]

        Returns
        -------
        dict  {0.95: {var, cvar, parametric_var, cf_var}, 0.99: {...}}
        """
        if confidence_levels is None:
            confidence_levels = [0.95, 0.99]

        if isinstance(returns, pd.Series):
            arr = self._clean_returns(returns.values)
        else:
            arr = self._clean_returns(np.asarray(returns))

        if len(arr) == 0:
            return {cl: {"var": 0.0, "cvar": 0.0, "parametric_var": 0.0, "cf_var": 0.0}
                    for cl in confidence_levels}

        mu_r = float(np.mean(arr))
        sigma_r = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0

        result: dict = {}
        for alpha in confidence_levels:
            # Historical VaR
            var_hist = float(-np.percentile(arr, (1 - alpha) * 100))

            # Historical CVaR (Expected Shortfall)
            tail = arr[arr <= -var_hist]
            cvar_hist = float(-np.mean(tail)) if len(tail) > 0 else var_hist

            # Parametric VaR (normal)
            from scipy.stats import norm
            z_alpha = norm.ppf(alpha)
            parametric_var = float(-(mu_r - z_alpha * sigma_r))

            # Cornish-Fisher adjusted VaR (accounts for skewness + kurtosis)
            skew = float(
                np.mean(((arr - mu_r) / sigma_r) ** 3) if sigma_r > 0 else 0.0
            )
            kurt = float(
                np.mean(((arr - mu_r) / sigma_r) ** 4) - 3.0 if sigma_r > 0 else 0.0
            )
            z_cf = (
                z_alpha
                + (z_alpha ** 2 - 1) * skew / 6
                + (z_alpha ** 3 - 3 * z_alpha) * kurt / 24
                - (2 * z_alpha ** 3 - 5 * z_alpha) * skew ** 2 / 36
            )
            cf_var = float(-(mu_r - z_cf * sigma_r))

            result[alpha] = {
                "var": round(var_hist, 6),
                "cvar": round(cvar_hist, 6),
                "parametric_var": round(parametric_var, 6),
                "cf_var": round(cf_var, 6),
            }

        return result

    # ------------------------------------------------------------------
    # Portfolio risk
    # ------------------------------------------------------------------

    def compute_portfolio_risk(
        self,
        weights: dict[str, float],
        returns_df: pd.DataFrame,
    ) -> PortfolioRisk:
        """
        Full risk profile for a portfolio.

        Parameters
        ----------
        weights : dict[str, float]
            Symbol → portfolio weight (should sum to ~1).
        returns_df : pd.DataFrame
            Long or wide daily returns data.

        Returns
        -------
        PortfolioRisk
        """
        wide = self._to_wide(returns_df)

        # Keep only symbols that exist in both weights and data
        symbols = [s for s in weights if s in wide.columns and weights[s] != 0]
        if not symbols:
            raise ValueError("No overlap between weights and returns_df columns.")

        w_arr = np.array([weights[s] for s in symbols], dtype=float)
        total = w_arr.sum()
        if total <= 0:
            raise ValueError("Weights must sum to a positive number.")
        w_arr /= total

        daily_mat = wide[symbols].dropna(how="all")
        # Forward-fill then back-fill NaN within columns
        daily_mat = daily_mat.ffill().bfill()
        daily_mat = daily_mat.dropna()

        port_returns: pd.Series = daily_mat.values @ w_arr
        port_series = pd.Series(port_returns, index=daily_mat.index)

        # ---- Annualised return and volatility ----
        ann_ret = float(np.mean(port_returns) * 252)
        ann_vol = float(np.std(port_returns, ddof=1) * np.sqrt(252)) if len(port_returns) > 1 else 0.0

        # ---- Sharpe ----
        sharpe = (ann_ret - self.RISK_FREE_RATE) / ann_vol if ann_vol > 0 else 0.0

        # ---- Sortino ----
        downside = port_returns[port_returns < 0]
        downside_std = float(np.std(downside, ddof=1) * np.sqrt(252)) if len(downside) > 1 else ann_vol
        sortino = (ann_ret - self.RISK_FREE_RATE) / downside_std if downside_std > 0 else 0.0

        # ---- Max drawdown ----
        dd_list = self.compute_drawdown_series(port_series)
        max_dd = float(min((d["drawdown"] for d in dd_list), default=0.0))

        # ---- Calmar ----
        calmar = ann_ret / abs(max_dd) if max_dd < 0 else (ann_ret if ann_ret > 0 else 0.0)

        # ---- VaR / CVaR ----
        var_cvar = self.compute_var_cvar(port_returns, [0.95, 0.99])

        # ---- Beta vs equal-weight benchmark ----
        eq_weights_arr = np.ones(len(symbols)) / len(symbols)
        bench_returns = daily_mat.values @ eq_weights_arr
        if len(bench_returns) > 1 and np.std(bench_returns) > 0:
            cov_pb = float(np.cov(port_returns, bench_returns)[0, 1])
            var_b = float(np.var(bench_returns, ddof=1))
            beta = cov_pb / var_b if var_b > 0 else 1.0
        else:
            beta = 1.0

        # ---- Correlation matrix ----
        corr_df = daily_mat[symbols].corr()
        corr_dict: dict[str, dict[str, float]] = {
            s: {s2: round(float(corr_df.loc[s, s2]), 4) for s2 in symbols}
            for s in symbols
        }

        # ---- Monthly returns ----
        port_series.index = pd.to_datetime(port_series.index)
        monthly = port_series.resample("ME").apply(lambda r: float((1 + r).prod() - 1))
        monthly_list = [
            {"month": str(dt.to_period("M")), "return": round(float(v), 6)}
            for dt, v in monthly.items()
            if np.isfinite(v)
        ]

        return PortfolioRisk(
            portfolio_return_ann=round(ann_ret, 6),
            portfolio_vol_ann=round(ann_vol, 6),
            sharpe_ratio=round(sharpe, 6),
            sortino_ratio=round(sortino, 6),
            max_drawdown=round(max_dd, 6),
            calmar_ratio=round(calmar, 6),
            var_95=var_cvar[0.95]["var"],
            cvar_95=var_cvar[0.95]["cvar"],
            var_99=var_cvar[0.99]["var"],
            cvar_99=var_cvar[0.99]["cvar"],
            beta=round(beta, 6),
            correlation_matrix=corr_dict,
            drawdown_series=dd_list,
            monthly_returns=monthly_list,
        )

    # ------------------------------------------------------------------
    # Stress tests
    # ------------------------------------------------------------------

    def run_stress_tests(
        self,
        weights: dict[str, float],
        returns_df: pd.DataFrame,
    ) -> list[StressScenario]:
        """
        Apply historical stress scenarios to a portfolio.

        Parameters
        ----------
        weights : dict[str, float]
        returns_df : pd.DataFrame
            Used only to determine which symbols are tradeable; not required
            for scenario impact (shocks are hardcoded).

        Returns
        -------
        list[StressScenario]
        """
        wide = self._to_wide(returns_df)
        held_symbols = [s for s in weights if weights[s] != 0]
        if not held_symbols:
            return []

        # Normalise weights
        w_arr = np.array([weights[s] for s in held_symbols], dtype=float)
        total = w_arr.sum()
        if total <= 0:
            return []
        w_arr = w_arr / total
        w_by_sym = dict(zip(held_symbols, w_arr.tolist()))

        results: list[StressScenario] = []

        for scenario_name, shocks in STRESS_SCENARIOS.items():
            per_symbol: dict[str, float] = {}
            for sym in held_symbols:
                if sym in shocks:
                    per_symbol[sym] = shocks[sym]
                else:
                    fallback_key = _classify_symbol(sym)
                    per_symbol[sym] = shocks.get(fallback_key, 0.0)

            port_impact = float(
                sum(w_by_sym[sym] * per_symbol[sym] for sym in held_symbols)
            )

            # Worst individual holding
            weighted_impacts = {sym: w_by_sym[sym] * per_symbol[sym] for sym in held_symbols}
            worst_sym = min(weighted_impacts, key=lambda s: weighted_impacts[s])
            worst_impact = per_symbol[worst_sym]

            descriptions = {
                "2008 GFC": "Global Financial Crisis peak-to-trough equity drawdown (~Sep 2008 – Mar 2009)",
                "2020 COVID Crash": "COVID-19 crash (Feb 19 – Mar 23 2020)",
                "2022 Rate Shock": "Fed rate-hike cycle annual drawdown (2022)",
                "2000 Dot-com Bust": "Dot-com bubble burst peak-to-trough (2000 – 2002)",
                "+100bps Rate Shock": "Instantaneous +100 bps parallel shift in yield curve",
                "Flash Crash -10%": "Generic equity flash crash of -10% in a single session",
            }
            description = descriptions.get(scenario_name, scenario_name)

            results.append(
                StressScenario(
                    name=scenario_name,
                    description=description,
                    portfolio_impact=round(port_impact, 6),
                    worst_symbol=worst_sym,
                    worst_impact=round(worst_impact, 6),
                    scenario_returns={s: round(v, 6) for s, v in per_symbol.items()},
                )
            )

        return results

    # ------------------------------------------------------------------
    # Drawdown series
    # ------------------------------------------------------------------

    def compute_drawdown_series(
        self, portfolio_returns: pd.Series
    ) -> list[dict]:
        """
        Compute per-period drawdown relative to the running peak.

        Parameters
        ----------
        portfolio_returns : pd.Series
            Daily (or periodic) returns with a datetime-compatible index.

        Returns
        -------
        list[dict]
            [{date: str, drawdown: float, cumulative_return: float}, ...]
        """
        if len(portfolio_returns) == 0:
            return []

        arr = self._clean_returns(portfolio_returns.values)
        if len(arr) == 0:
            return []

        # Cumulative wealth index
        cum = np.cumprod(1.0 + arr)
        peak = np.maximum.accumulate(cum)
        # Drawdown (always <= 0)
        with np.errstate(invalid="ignore", divide="ignore"):
            dd = np.where(peak > 0, (cum - peak) / peak, 0.0)

        # Index alignment
        try:
            idx = portfolio_returns.index[: len(arr)]
            dates = [str(d)[:10] for d in idx]
        except Exception:
            dates = [str(i) for i in range(len(arr))]

        return [
            {
                "date": dates[i],
                "drawdown": round(float(dd[i]), 6),
                "cumulative_return": round(float(cum[i] - 1.0), 6),
            }
            for i in range(len(arr))
        ]

    # ------------------------------------------------------------------
    # Correlation heatmap
    # ------------------------------------------------------------------

    def correlation_heatmap_data(self, returns_df: pd.DataFrame) -> dict:
        """
        Compute pairwise correlations and return data suitable for a heatmap.

        Also returns a ``cluster_order`` list — symbols reordered by
        hierarchical clustering (or by mean correlation if scipy is
        unavailable) for visually appealing grouping.

        Parameters
        ----------
        returns_df : pd.DataFrame
            Long or wide daily returns.

        Returns
        -------
        dict
            {
              "symbols": list[str],            # original order
              "matrix": list[list[float]],     # correlation matrix in original order
              "cluster_order": list[str],      # symbols in clustered order
              "cluster_matrix": list[list[float]],  # matrix reordered by cluster_order
            }
        """
        wide = self._to_wide(returns_df)
        if wide.shape[1] < 2:
            sym = list(wide.columns)
            return {
                "symbols": sym,
                "matrix": [[1.0]],
                "cluster_order": sym,
                "cluster_matrix": [[1.0]],
            }

        # Drop columns that are all NaN
        wide = wide.dropna(axis=1, how="all")
        wide = wide.ffill().bfill().dropna()
        symbols = list(wide.columns)

        corr = wide.corr().values  # numpy array

        # Attempt hierarchical clustering
        cluster_order_idx = list(range(len(symbols)))
        try:
            from scipy.cluster.hierarchy import linkage, leaves_list
            from scipy.spatial.distance import squareform

            # Convert correlation to distance (clip for numerical safety)
            dist_matrix = np.clip(1.0 - corr, 0.0, 2.0)
            np.fill_diagonal(dist_matrix, 0.0)
            condensed = squareform(dist_matrix, checks=False)
            linkage_matrix = linkage(condensed, method="ward")
            cluster_order_idx = list(map(int, leaves_list(linkage_matrix)))
        except Exception:
            # Fallback: sort by mean absolute correlation (most correlated first)
            mean_corr = np.mean(np.abs(corr), axis=1)
            cluster_order_idx = list(np.argsort(-mean_corr))

        cluster_symbols = [symbols[i] for i in cluster_order_idx]
        cluster_corr = corr[np.ix_(cluster_order_idx, cluster_order_idx)]

        def _round_matrix(m: np.ndarray) -> list[list[float]]:
            return [[round(float(v), 4) for v in row] for row in m]

        return {
            "symbols": symbols,
            "matrix": _round_matrix(corr),
            "cluster_order": cluster_symbols,
            "cluster_matrix": _round_matrix(cluster_corr),
        }


# ---------------------------------------------------------------------------
# Copula Tail Dependence
# ---------------------------------------------------------------------------

class CopulaDependence:
    """
    Estimates tail dependence between asset pairs using empirical copulas.
    Normal correlation understates joint crash risk — copulas capture
    "everything drops together in a crisis" which is critical for risk management.
    """

    @staticmethod
    def compute_tail_dependence(returns_a: np.ndarray, returns_b: np.ndarray,
                                 quantile: float = 0.05) -> dict:
        """
        Compute lower and upper tail dependence coefficients.

        Lower tail: λ_L = P(Y ≤ F⁻¹(q) | X ≤ F⁻¹(q)) — crash co-movement
        Upper tail: λ_U = P(Y > F⁻¹(1-q) | X > F⁻¹(1-q)) — rally co-movement

        Values close to 1 = strong tail dependence (crash together).
        Values close to 0 = independent in tails.
        """
        n = len(returns_a)
        if n < 50:
            return {"lower_tail": None, "upper_tail": None, "interpretation": "Insufficient data"}

        # Convert to pseudo-observations (empirical CDF)
        from scipy.stats import rankdata
        u = rankdata(returns_a) / (n + 1)
        v = rankdata(returns_b) / (n + 1)

        # Lower tail dependence (crashes)
        lower_mask = (u <= quantile) & (v <= quantile)
        lower_count = np.sum(lower_mask)
        lower_expected = np.sum(u <= quantile)
        lambda_lower = lower_count / max(lower_expected, 1)

        # Upper tail dependence (rallies)
        upper_mask = (u >= 1 - quantile) & (v >= 1 - quantile)
        upper_count = np.sum(upper_mask)
        upper_expected = np.sum(u >= 1 - quantile)
        lambda_upper = upper_count / max(upper_expected, 1)

        # Linear correlation for comparison
        corr = float(np.corrcoef(returns_a, returns_b)[0, 1])

        # Interpretation
        if lambda_lower > 0.5:
            interp = "Strong crash co-movement — diversification fails in downturns"
        elif lambda_lower > 0.25:
            interp = "Moderate tail dependence — some crash correlation"
        else:
            interp = "Low tail dependence — diversification holds in stress"

        return {
            "lower_tail": round(float(lambda_lower), 3),
            "upper_tail": round(float(lambda_upper), 3),
            "linear_correlation": round(corr, 3),
            "tail_asymmetry": round(float(lambda_lower - lambda_upper), 3),
            "quantile": quantile,
            "n_observations": n,
            "interpretation": interp,
        }

    @staticmethod
    def compute_portfolio_tail_risk(returns_matrix: np.ndarray, symbols: list[str],
                                     quantile: float = 0.05) -> dict:
        """
        Compute pairwise tail dependence for a portfolio.
        Returns NxN lower tail dependence matrix.
        """
        n_assets = returns_matrix.shape[1]
        tail_matrix = np.zeros((n_assets, n_assets))

        for i in range(n_assets):
            for j in range(i, n_assets):
                if i == j:
                    tail_matrix[i][j] = 1.0
                else:
                    result = CopulaDependence.compute_tail_dependence(
                        returns_matrix[:, i], returns_matrix[:, j], quantile
                    )
                    tail_matrix[i][j] = result.get("lower_tail", 0) or 0
                    tail_matrix[j][i] = tail_matrix[i][j]

        # Find riskiest pairs (highest crash co-movement)
        risky_pairs = []
        for i in range(n_assets):
            for j in range(i + 1, n_assets):
                if tail_matrix[i][j] > 0.2:
                    risky_pairs.append({
                        "pair": f"{symbols[i]}-{symbols[j]}",
                        "tail_dependence": round(float(tail_matrix[i][j]), 3),
                    })
        risky_pairs.sort(key=lambda x: x["tail_dependence"], reverse=True)

        return {
            "symbols": symbols,
            "tail_matrix": [[round(float(v), 3) for v in row] for row in tail_matrix],
            "risky_pairs": risky_pairs[:10],
            "avg_tail_dependence": round(float(np.mean(tail_matrix[np.triu_indices_from(tail_matrix, k=1)])), 3),
        }
