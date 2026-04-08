"""
Signal Engine
=============
Modular signal implementations:

1. Conditional Probability Signal    P(A|B) = P(A∩B)/P(B)
2. Bayesian Update Signal            Posterior ∝ Likelihood × Prior
3. Regression Alpha Signal           β̂ = (XᵀX)⁻¹Xᵀy + Newey-West SEs
4. PCA Regime Filter                 Eigen decomposition of covariance
5. Fat-Tail Risk Model               Student-t MLE position sizing
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import polars as pl
from scipy import stats
import statsmodels.api as sm

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Signal Result
# ---------------------------------------------------------------------------

@dataclass
class SignalResult:
    name: str
    symbol: str
    signal: np.ndarray          # raw signal values
    timestamps: list
    metadata: dict = field(default_factory=dict)

    def to_polars(self) -> pl.DataFrame:
        return pl.DataFrame({
            "timestamp": self.timestamps,
            "symbol": [self.symbol] * len(self.timestamps),
            "signal": self.signal,
            "signal_name": [self.name] * len(self.timestamps),
        })


# ---------------------------------------------------------------------------
# Base Signal
# ---------------------------------------------------------------------------

class BaseSignal(ABC):
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def compute(
        self,
        features: pl.DataFrame,
        symbol: str,
        **kwargs,
    ) -> SignalResult:
        ...


# ---------------------------------------------------------------------------
# 1) Conditional Probability Signal
# ---------------------------------------------------------------------------

class ConditionalProbabilitySignal(BaseSignal):
    """
    Estimates P(up | condition) vs P(up) as edge signal.
    Edge = P(up | condition) - P(up)

    Example: condition = high volume (volume_zscore > 1.5)
    Signal is positive when conditional probability of up day
    exceeds base rate significantly.
    """

    def __init__(
        self,
        condition_col: str = "volume_zscore",
        condition_threshold: float = 1.5,
        lookback: int = 252,
        min_samples: int = 20,
    ):
        super().__init__("conditional_probability")
        self.condition_col = condition_col
        self.condition_threshold = condition_threshold
        self.lookback = lookback
        self.min_samples = min_samples

    def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        sym_df = (
            features.filter(pl.col("symbol") == symbol)
            .sort("timestamp")
        )

        returns = sym_df["returns"].to_numpy()
        condition = sym_df[self.condition_col].to_numpy() if self.condition_col in sym_df.columns else np.zeros(len(returns))
        timestamps = sym_df["timestamp"].to_list()
        n = len(returns)

        signal = np.full(n, np.nan)
        metadata = {"edges": [], "p_values": []}

        for i in range(self.lookback, n):
            window_ret = returns[i - self.lookback : i]
            window_cond = condition[i - self.lookback : i]

            valid = ~np.isnan(window_ret) & ~np.isnan(window_cond)
            wr = window_ret[valid]
            wc = window_cond[valid]

            if len(wr) < self.min_samples:
                continue

            # P(up)
            p_up = np.mean(wr > 0)

            # Condition mask
            cond_mask = wc > self.condition_threshold
            n_cond = cond_mask.sum()

            if n_cond < self.min_samples // 2:
                signal[i] = 0.0
                continue

            # P(up | condition)
            p_up_given_cond = np.mean(wr[cond_mask] > 0)

            # Edge
            edge = p_up_given_cond - p_up

            # Statistical test: two-proportion z-test
            n1 = n_cond
            n2 = len(wr) - n_cond
            if n2 < 1:
                signal[i] = 0.0
                continue

            p1 = p_up_given_cond
            p2 = np.mean(wr[~cond_mask] > 0)
            p_pool = (p1 * n1 + p2 * n2) / (n1 + n2)

            if p_pool in (0, 1) or n1 == 0 or n2 == 0:
                signal[i] = 0.0
                continue

            se = np.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
            z = (p1 - p2) / se if se > 0 else 0.0
            p_val = 2 * (1 - stats.norm.cdf(abs(z)))

            # Signal = edge, thresholded by significance
            if p_val < 0.1:
                signal[i] = edge
            else:
                signal[i] = 0.0

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal,
            timestamps=timestamps,
            metadata={
                "condition_col": self.condition_col,
                "condition_threshold": self.condition_threshold,
                "lookback": self.lookback,
            },
        )

    def compute_explorer(
        self,
        features: pl.DataFrame,
        symbol: str,
        condition_col: str,
        condition_threshold: float,
    ) -> dict:
        """
        Returns conditional probability stats for UI explorer.
        """
        sym_df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        returns = sym_df["returns"].to_numpy()
        condition = sym_df[condition_col].to_numpy() if condition_col in sym_df.columns else np.zeros(len(returns))

        valid = ~np.isnan(returns) & ~np.isnan(condition)
        wr = returns[valid]
        wc = condition[valid]

        p_up = float(np.mean(wr > 0))
        cond_mask = wc > condition_threshold
        n_cond = int(cond_mask.sum())

        if n_cond < 5:
            return {
                "p_up": p_up,
                "p_up_given_cond": None,
                "edge": None,
                "n_total": len(wr),
                "n_condition": n_cond,
                "ci_lower": None,
                "ci_upper": None,
                "z_stat": None,
                "p_value": None,
            }

        p_up_cond = float(np.mean(wr[cond_mask] > 0))
        edge = p_up_cond - p_up

        # Wilson confidence interval
        z_ci = 1.96
        ci_lo, ci_hi = self._wilson_ci(p_up_cond, n_cond, z_ci)

        # z-test
        n2 = len(wr) - n_cond
        p2 = float(np.mean(wr[~cond_mask] > 0))
        p_pool = (p_up_cond * n_cond + p2 * n2) / (n_cond + n2)
        se = np.sqrt(p_pool * (1 - p_pool) * (1 / n_cond + 1 / n2)) if p_pool not in (0, 1) else 1.0
        z_stat = float((p_up_cond - p2) / se) if se > 0 else 0.0
        p_value = float(2 * (1 - stats.norm.cdf(abs(z_stat))))

        return {
            "p_up": p_up,
            "p_up_given_cond": p_up_cond,
            "edge": edge,
            "n_total": len(wr),
            "n_condition": n_cond,
            "ci_lower": ci_lo,
            "ci_upper": ci_hi,
            "z_stat": z_stat,
            "p_value": p_value,
        }

    @staticmethod
    def _wilson_ci(p: float, n: int, z: float = 1.96):
        denom = 1 + z ** 2 / n
        center = (p + z ** 2 / (2 * n)) / denom
        margin = z * np.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2)) / denom
        return float(center - margin), float(center + margin)


# ---------------------------------------------------------------------------
# 2) Bayesian Update Signal
# ---------------------------------------------------------------------------

class BayesianUpdateSignal(BaseSignal):
    """
    Maintains a running belief about expected return.
    Prior: N(mu_0, sigma_0^2)
    Likelihood: N(observed, sigma_lik^2)
    Posterior = Gaussian update rule.

    Signal = posterior mean (updated expected return).
    """

    def __init__(
        self,
        prior_mean: float = 0.0,
        prior_variance: float = 0.01,
        likelihood_variance: float = 0.0004,  # ~2% daily vol
        decay: float = 0.98,
    ):
        super().__init__("bayesian_update")
        self.prior_mean = prior_mean
        self.prior_variance = prior_variance
        self.likelihood_variance = likelihood_variance
        self.decay = decay

    def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        sym_df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        returns = sym_df["returns"].to_numpy()
        timestamps = sym_df["timestamp"].to_list()
        n = len(returns)

        signal = np.full(n, np.nan)

        mu = self.prior_mean
        var = self.prior_variance

        for i in range(1, n):
            obs = returns[i]
            if np.isnan(obs):
                signal[i] = mu
                # Decay: inflate uncertainty over time
                var = var / (self.decay ** 2)
                continue

            # Gaussian Bayesian update
            # posterior mean = (mu/var + obs/lik_var) / (1/var + 1/lik_var)
            K = var / (var + self.likelihood_variance)  # Kalman gain
            mu = mu + K * (obs - mu)
            var = (1 - K) * var

            # Apply decay to allow adaptation
            var = var / (self.decay ** 2)

            signal[i] = mu

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal,
            timestamps=timestamps,
            metadata={
                "prior_mean": self.prior_mean,
                "prior_variance": self.prior_variance,
                "likelihood_variance": self.likelihood_variance,
            },
        )


# ---------------------------------------------------------------------------
# 3) Regression Alpha Signal
# ---------------------------------------------------------------------------

class RegressionAlphaSignal(BaseSignal):
    """
    Fits rolling OLS:  r_t = alpha + beta * X_t + epsilon

    X can be any feature column(s). Uses Newey-West HAC standard errors.
    Signal = alpha (intercept) / its t-stat.
    """

    def __init__(
        self,
        feature_cols: list[str] = None,
        lookback: int = 126,
        min_obs: int = 40,
        newey_west_lags: int = 5,
    ):
        super().__init__("regression_alpha")
        self.feature_cols = feature_cols or ["pca_factor_1", "volume_zscore"]
        self.lookback = lookback
        self.min_obs = min_obs
        self.newey_west_lags = newey_west_lags

    def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        sym_df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        timestamps = sym_df["timestamp"].to_list()
        n = len(timestamps)

        returns = sym_df["returns"].to_numpy()

        # Gather X columns (only those that exist)
        available_cols = [c for c in self.feature_cols if c in sym_df.columns]
        if not available_cols:
            available_cols = ["volume_zscore"]

        X_dict = {}
        for col in available_cols:
            X_dict[col] = sym_df[col].to_numpy() if col in sym_df.columns else np.zeros(n)

        signal = np.full(n, np.nan)
        alpha_arr = np.full(n, np.nan)
        t_stat_arr = np.full(n, np.nan)

        for i in range(self.lookback, n):
            y = returns[i - self.lookback : i]
            X_cols = [X_dict[c][i - self.lookback : i] for c in available_cols]

            # Stack and filter valid rows
            X_mat = np.column_stack(X_cols)
            valid = ~np.isnan(y)
            for j in range(X_mat.shape[1]):
                valid = valid & ~np.isnan(X_mat[:, j])

            y_v = y[valid]
            X_v = X_mat[valid]

            if len(y_v) < self.min_obs:
                continue

            # OLS with Newey-West SEs
            try:
                X_with_const = sm.add_constant(X_v, has_constant="add")
                model = sm.OLS(y_v, X_with_const)
                result = model.fit(
                    cov_type="HAC",
                    cov_kwds={"maxlags": self.newey_west_lags},
                )
                alpha = result.params[0]
                t_stat = result.tvalues[0]

                alpha_arr[i] = alpha
                t_stat_arr[i] = t_stat

                # Signal = alpha t-stat (signed)
                signal[i] = t_stat

            except Exception:
                pass

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal,
            timestamps=timestamps,
            metadata={
                "feature_cols": available_cols,
                "lookback": self.lookback,
                "alpha_series": alpha_arr.tolist(),
                "t_stat_series": t_stat_arr.tolist(),
            },
        )


# ---------------------------------------------------------------------------
# 4) PCA Regime Filter
# ---------------------------------------------------------------------------

class PCARegimeFilter(BaseSignal):
    """
    Uses PCA on the cross-sectional covariance to detect market regimes.

    Computes:
    - Covariance matrix Σ
    - Portfolio variance σ² = wᵀΣw (equal weight)
    - Top eigenvectors
    - Regime = {risk_on, risk_off, transition} based on explained variance

    Signal = regime-adjusted position scalar (-1, 0, 1)
    """

    def __init__(
        self,
        n_components: int = 2,
        lookback: int = 63,
        risk_off_threshold: float = 0.7,  # top PC explains > 70% → systemic risk
    ):
        super().__init__("pca_regime")
        self.n_components = n_components
        self.lookback = lookback
        self.risk_off_threshold = risk_off_threshold

    def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        # Use all symbols for cross-sectional PCA
        all_symbols = features["symbol"].unique().sort().to_list()
        pivot = (
            features.select(["timestamp", "symbol", "log_returns"])
            .pivot(index="timestamp", columns="symbol", values="log_returns")
            .sort("timestamp")
        )

        timestamps_all = pivot["timestamp"].to_list()
        sym_cols = [c for c in pivot.columns if c != "timestamp"]
        mat = pivot.select(sym_cols).to_numpy().astype(float)
        n_t = len(timestamps_all)

        regime_signal = np.full(n_t, np.nan)
        top_variance_explained = np.full(n_t, np.nan)

        for i in range(self.lookback, n_t):
            window = mat[i - self.lookback : i]
            # Drop rows with any NaN
            valid_rows = ~np.isnan(window).any(axis=1)
            w = window[valid_rows]
            if len(w) < 10 or w.shape[1] < 2:
                continue

            # Covariance matrix Σ
            cov = np.cov(w.T)
            if cov.ndim == 0:
                continue

            # Eigendecomposition
            eigenvalues, eigenvectors = np.linalg.eigh(cov)
            # Sort descending
            idx = np.argsort(eigenvalues)[::-1]
            eigenvalues = eigenvalues[idx]
            eigenvectors = eigenvectors[:, idx]

            total_var = eigenvalues.sum()
            if total_var <= 0:
                continue

            top_explained = eigenvalues[0] / total_var
            top_variance_explained[i] = float(top_explained)

            # Portfolio variance (equal weight)
            eq_weight = np.ones(cov.shape[0]) / cov.shape[0]
            port_var = float(eq_weight @ cov @ eq_weight)

            # Regime classification
            if top_explained > self.risk_off_threshold:
                # High systemic risk → risk off
                regime_signal[i] = -1.0
            elif top_explained < 0.4:
                # Dispersed → favorable
                regime_signal[i] = 1.0
            else:
                regime_signal[i] = 0.0

        # Map back to symbol timestamps
        sym_df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        sym_ts = sym_df["timestamp"].to_list()

        ts_to_regime = dict(zip(timestamps_all, regime_signal))
        ts_to_var = dict(zip(timestamps_all, top_variance_explained))

        signal = np.array([ts_to_regime.get(ts, np.nan) for ts in sym_ts])
        var_explained = np.array([ts_to_var.get(ts, np.nan) for ts in sym_ts])

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal,
            timestamps=sym_ts,
            metadata={
                "top_variance_explained": var_explained.tolist(),
                "risk_off_threshold": self.risk_off_threshold,
            },
        )


# ---------------------------------------------------------------------------
# 5) Fat-Tail Risk Model
# ---------------------------------------------------------------------------

class FatTailRiskSignal(BaseSignal):
    """
    Fits Student-t distribution to returns and adjusts position sizing.

    Lower nu (degrees of freedom) → fatter tails → smaller position.
    Signal = tail-risk-adjusted position scalar ∈ (0, 1].
    """

    def __init__(
        self,
        lookback: int = 126,
        target_var: float = 0.02,  # 2% daily VaR target
        confidence: float = 0.95,
    ):
        super().__init__("fat_tail_risk")
        self.lookback = lookback
        self.target_var = target_var
        self.confidence = confidence

    def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        sym_df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        timestamps = sym_df["timestamp"].to_list()
        returns = sym_df["returns"].to_numpy()
        n = len(returns)

        signal = np.full(n, np.nan)

        for i in range(self.lookback, n):
            window = returns[i - self.lookback : i]
            valid = window[~np.isnan(window)]
            if len(valid) < 20:
                continue

            try:
                nu, mu, sigma = stats.t.fit(valid)
                nu = max(2.1, nu)

                # VaR at confidence level for unit position
                var_q = abs(stats.t.ppf(1 - self.confidence, df=nu, loc=mu, scale=sigma))

                # Position size = target VaR / unit VaR
                if var_q > 0:
                    pos_size = min(1.0, self.target_var / var_q)
                else:
                    pos_size = 1.0

                signal[i] = pos_size

            except Exception:
                signal[i] = 0.5  # fallback

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal,
            timestamps=timestamps,
            metadata={
                "lookback": self.lookback,
                "target_var": self.target_var,
                "confidence": self.confidence,
            },
        )


# ---------------------------------------------------------------------------
# Signal Registry
# ---------------------------------------------------------------------------

SIGNAL_REGISTRY = {
    "conditional_probability": ConditionalProbabilitySignal,
    "bayesian_update": BayesianUpdateSignal,
    "regression_alpha": RegressionAlphaSignal,
    "pca_regime": PCARegimeFilter,
    "fat_tail_risk": FatTailRiskSignal,
}


def get_signal(name: str, **kwargs) -> BaseSignal:
    if name not in SIGNAL_REGISTRY:
        raise ValueError(f"Unknown signal: {name}. Options: {list(SIGNAL_REGISTRY)}")
    return SIGNAL_REGISTRY[name](**kwargs)


# ---------------------------------------------------------------------------
# Combined Signal Engine
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Signal 6 — GARCH Volatility Forecast
# ---------------------------------------------------------------------------

class GARCHVolatilitySignal(BaseSignal):
    """
    GARCH(1,1) volatility model: σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁

    Captures volatility clustering — the #1 empirical fact of financial returns.
    Signal: ratio of GARCH forecast vol to realized vol.
    High ratio (vol expanding) = risk-off signal.
    Low ratio (vol contracting) = opportunity signal.
    """

    def __init__(self, lookback: int = 252, forecast_horizon: int = 5):
        super().__init__("garch_volatility", {"lookback": lookback, "forecast_horizon": forecast_horizon})
        self.lookback = lookback
        self.horizon = forecast_horizon

    def compute(self, features: pl.DataFrame, symbol: str) -> SignalResult:
        df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        rets = df["returns"].to_numpy()
        ts = df["timestamp"].to_list()

        signal = np.full(len(rets), np.nan)

        for t in range(max(self.lookback, 50), len(rets)):
            window = rets[t - self.lookback:t]
            window = window[~np.isnan(window)]
            if len(window) < 50:
                continue

            try:
                # Fit GARCH(1,1) via quasi-MLE
                omega, alpha, beta, sigma2 = self._fit_garch11(window)

                # Forecast h-step ahead variance
                last_eps2 = window[-1] ** 2
                forecast_var = sigma2
                for _ in range(self.horizon):
                    forecast_var = omega + alpha * last_eps2 + beta * forecast_var
                    last_eps2 = forecast_var  # expected eps^2 = sigma^2

                forecast_vol = np.sqrt(forecast_var) * np.sqrt(252)  # annualize
                realized_vol = np.std(window[-21:]) * np.sqrt(252) if len(window) >= 21 else np.std(window) * np.sqrt(252)

                if realized_vol > 0:
                    # Signal: negative when forecast vol >> realized (risk expanding)
                    # Positive when forecast vol << realized (vol contracting = opportunity)
                    ratio = realized_vol / max(forecast_vol, 1e-8)
                    signal[t] = np.clip(ratio - 1.0, -1.0, 1.0)
            except Exception:
                continue

        return SignalResult(
            name=self.name, symbol=symbol, signal=signal,
            timestamps=ts, metadata=self.params,
        )

    @staticmethod
    def _fit_garch11(returns, max_iter=100):
        """Fit GARCH(1,1) via variance targeting + simple optimization."""
        r = returns - np.mean(returns)
        T = len(r)
        var_target = np.var(r)

        # Initialize: omega from variance targeting, alpha=0.1, beta=0.85
        alpha, beta = 0.1, 0.85
        omega = var_target * (1 - alpha - beta)
        omega = max(omega, 1e-10)

        # Iterative quasi-MLE (simplified — avoids scipy.optimize for speed)
        sigma2 = np.full(T, var_target)
        for iteration in range(max_iter):
            # E-step: compute conditional variances
            for t in range(1, T):
                sigma2[t] = omega + alpha * r[t - 1] ** 2 + beta * sigma2[t - 1]
                sigma2[t] = max(sigma2[t], 1e-10)

            # M-step: update parameters (moment matching)
            eps2 = r ** 2
            new_alpha = np.clip(np.mean(eps2[1:] * sigma2[:-1]) / np.mean(sigma2[:-1] ** 2) * alpha, 0.01, 0.3)
            new_beta = np.clip(1 - new_alpha - omega / max(var_target, 1e-10), 0.5, 0.98)
            new_omega = max(var_target * (1 - new_alpha - new_beta), 1e-10)

            if abs(new_alpha - alpha) + abs(new_beta - beta) < 1e-6:
                break
            alpha, beta, omega = new_alpha, new_beta, new_omega

        return omega, alpha, beta, sigma2[-1]


# ---------------------------------------------------------------------------
# Signal 7 — Hurst Exponent (Trending vs Mean-Reverting)
# ---------------------------------------------------------------------------

class HurstExponentSignal(BaseSignal):
    """
    Hurst Exponent via Rescaled Range (R/S) analysis.

    H > 0.5 → persistent (trending) — use momentum strategies
    H = 0.5 → random walk — no exploitable pattern
    H < 0.5 → anti-persistent (mean-reverting) — use pairs/reversion strategies

    Signal output: H mapped to [-1, +1] where:
    - +1 = strongly trending (H ≈ 1.0)
    - 0  = random walk (H ≈ 0.5)
    - -1 = strongly mean-reverting (H ≈ 0.0)
    """

    def __init__(self, lookback: int = 252, min_window: int = 20):
        super().__init__("hurst_exponent", {"lookback": lookback, "min_window": min_window})
        self.lookback = lookback
        self.min_window = min_window

    def compute(self, features: pl.DataFrame, symbol: str) -> SignalResult:
        df = features.filter(pl.col("symbol") == symbol).sort("timestamp")
        rets = df["returns"].to_numpy()
        ts = df["timestamp"].to_list()

        signal = np.full(len(rets), np.nan)

        for t in range(self.lookback, len(rets)):
            window = rets[t - self.lookback:t]
            window = window[~np.isnan(window)]
            if len(window) < 50:
                continue

            try:
                H = self._compute_hurst(window)
                # Map H ∈ [0, 1] to signal ∈ [-1, +1]
                # H=0.5 → 0, H=1.0 → +1, H=0.0 → -1
                signal[t] = np.clip((H - 0.5) * 2, -1.0, 1.0)
            except Exception:
                continue

        return SignalResult(
            name=self.name, symbol=symbol, signal=signal,
            timestamps=ts, metadata=self.params,
        )

    @staticmethod
    def _compute_hurst(series):
        """Compute Hurst exponent via Rescaled Range (R/S) analysis."""
        N = len(series)
        if N < 20:
            return 0.5

        # Use multiple sub-period lengths
        max_k = min(N // 2, 128)
        sizes = []
        rs_values = []

        for k in [16, 32, 64, 128, 256]:
            if k > max_k or k < 8:
                continue
            n_blocks = N // k
            if n_blocks < 1:
                continue

            rs_list = []
            for i in range(n_blocks):
                block = series[i * k:(i + 1) * k]
                mean = np.mean(block)
                devs = np.cumsum(block - mean)
                R = np.max(devs) - np.min(devs)
                S = np.std(block, ddof=1)
                if S > 0:
                    rs_list.append(R / S)

            if rs_list:
                sizes.append(np.log(k))
                rs_values.append(np.log(np.mean(rs_list)))

        if len(sizes) < 2:
            return 0.5

        # Linear regression: log(R/S) = H * log(n) + c
        slope, _, _, _, _ = stats.linregress(sizes, rs_values)
        return np.clip(slope, 0.0, 1.0)


class SignalEngine:
    """Runs all signals for a project and combines into a signal matrix."""

    def __init__(self, signals: list[BaseSignal] = None):
        self.signals = signals or [
            ConditionalProbabilitySignal(),
            BayesianUpdateSignal(),
            RegressionAlphaSignal(),
            PCARegimeFilter(),
            FatTailRiskSignal(),
            GARCHVolatilitySignal(),
            HurstExponentSignal(),
        ]

    def run(self, features: pl.DataFrame) -> pl.DataFrame:
        symbols = features["symbol"].unique().sort().to_list()
        results = []

        for sig in self.signals:
            logger.info(f"Computing signal: {sig.name}")
            for sym in symbols:
                try:
                    result = sig.compute(features, sym)
                    results.append(result.to_polars())
                except Exception as e:
                    logger.error(f"Signal {sig.name} failed for {sym}: {e}")

        if not results:
            return pl.DataFrame()

        combined = pl.concat(results)

        # Pivot to wide format: one row per (symbol, timestamp), one col per signal
        wide = combined.pivot(
            index=["timestamp", "symbol"],
            columns="signal_name",
            values="signal",
        ).sort(["symbol", "timestamp"])

        return wide
