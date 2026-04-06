"""
Statistical Validation
======================
Rigorous hypothesis testing for quantitative strategies.

Most strategies are noise. This module is the gatekeeper.

Tests:
- t-tests on Sharpe ratio
- Multiple comparison correction (Bonferroni, Benjamini-Hochberg)
- Permutation test (10,000 shuffles)
- Strategy labeling: valid / likely_noise / fragile
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result Structures
# ---------------------------------------------------------------------------

@dataclass
class ValidationResult:
    strategy_name: str
    label: str  # "valid" | "likely_noise" | "fragile"
    t_stat: float
    p_value_raw: float
    p_value_corrected: float
    correction_method: str
    sharpe_ratio: float
    permutation_p_value: float
    permutation_sharpe_dist: list[float]
    n_observations: int
    conclusion: str
    warnings: list[str] = field(default_factory=list)


@dataclass
class MultipleComparisonResult:
    n_strategies: int
    correction_method: str
    alpha: float
    rejected: list[bool]
    p_values_raw: list[float]
    p_values_corrected: list[float]
    strategy_names: list[str]


# ---------------------------------------------------------------------------
# Core Statistical Tests
# ---------------------------------------------------------------------------

class StatisticalValidator:
    """
    Validates trading strategies against statistical null hypotheses.

    Null hypothesis: strategy returns ~ iid N(0, σ²)
    i.e., no alpha.
    """

    def __init__(
        self,
        alpha: float = 0.05,
        n_permutations: int = 10_000,
        correction_method: str = "benjamini-hochberg",  # or "bonferroni"
        risk_free_rate: float = 0.03,
    ):
        self.alpha = alpha
        self.n_permutations = n_permutations
        self.correction_method = correction_method
        self.risk_free_rate = risk_free_rate

    def validate_single(
        self,
        returns: np.ndarray,
        strategy_name: str = "strategy",
        p_value_corrected: float = None,
        correction_method: str = None,
    ) -> ValidationResult:
        """
        Full statistical validation of a single return series.
        """
        valid = returns[~np.isnan(returns)]
        n = len(valid)

        if n < 30:
            return ValidationResult(
                strategy_name=strategy_name,
                label="likely_noise",
                t_stat=np.nan,
                p_value_raw=1.0,
                p_value_corrected=1.0,
                correction_method=correction_method or self.correction_method,
                sharpe_ratio=np.nan,
                permutation_p_value=1.0,
                permutation_sharpe_dist=[],
                n_observations=n,
                conclusion="Insufficient data (< 30 observations).",
                warnings=["Too few observations for reliable inference."],
            )

        # --- Sharpe Ratio ---
        daily_rf = self.risk_free_rate / 252
        excess = valid - daily_rf
        sr = float(np.mean(excess) / np.std(excess, ddof=1) * np.sqrt(252)) if np.std(excess, ddof=1) > 0 else 0.0

        # --- t-test: H0: mean(returns) = 0 ---
        t_stat, p_raw = stats.ttest_1samp(valid, popmean=0)
        t_stat = float(t_stat)
        p_raw = float(p_raw)

        # --- Permutation test (vectorized) ---
        observed_mean = np.mean(valid)
        rng = np.random.default_rng()

        # Generate all permutation indices at once as a 2D matrix
        n_perms = self.n_permutations
        idx_matrix = np.broadcast_to(np.arange(n), (n_perms, n)).copy()
        rng.permuted(idx_matrix, axis=1, out=idx_matrix)
        perm_matrix = valid[idx_matrix]  # shape: (n_perms, n)

        # Vectorized mean computation for all permutations
        perm_means = perm_matrix.mean(axis=1)

        # Vectorized Sharpe computation for subset
        n_sharpe = min(1000, n_perms)
        std_val = np.std(valid, ddof=1)
        perm_sharpes = (perm_means[:n_sharpe] / std_val * np.sqrt(252)) if std_val > 0 else np.zeros(n_sharpe)

        perm_p = float(np.mean(np.abs(perm_means) >= np.abs(observed_mean)))

        # --- Corrected p-value ---
        p_corr = p_value_corrected if p_value_corrected is not None else p_raw
        method = correction_method or self.correction_method

        # --- Labeling ---
        warnings = []
        if n < 252:
            warnings.append("Less than 1 year of data.")
        if abs(sr) > 3.0:
            warnings.append(f"Sharpe ratio {sr:.2f} is suspiciously high — check for overfitting.")

        if p_corr < self.alpha and perm_p < 0.1:
            label = "valid"
            conclusion = (
                f"Strategy passes statistical validation. "
                f"t-stat={t_stat:.2f}, corrected p={p_corr:.4f}, "
                f"permutation p={perm_p:.4f}, Sharpe={sr:.2f}."
            )
        elif p_corr < self.alpha and perm_p >= 0.1:
            label = "fragile"
            conclusion = (
                f"Strategy passes t-test but fails permutation test. "
                f"Result may be spurious. Permutation p={perm_p:.4f}."
            )
            warnings.append("Permutation test suggests possible data-snooping.")
        else:
            label = "likely_noise"
            conclusion = (
                f"Strategy fails statistical validation. "
                f"Corrected p={p_corr:.4f} >= alpha={self.alpha}. "
                f"Likely noise."
            )

        return ValidationResult(
            strategy_name=strategy_name,
            label=label,
            t_stat=t_stat,
            p_value_raw=p_raw,
            p_value_corrected=p_corr,
            correction_method=method,
            sharpe_ratio=sr,
            permutation_p_value=perm_p,
            permutation_sharpe_dist=perm_sharpes.tolist(),
            n_observations=n,
            conclusion=conclusion,
            warnings=warnings,
        )

    def validate_multiple(
        self,
        return_series: dict[str, np.ndarray],
    ) -> dict[str, ValidationResult]:
        """
        Validate multiple strategies with multiple comparison correction.
        """
        names = list(return_series.keys())
        n_strategies = len(names)
        logger.info(f"Validating {n_strategies} strategies with {self.correction_method} correction")

        # Compute raw p-values
        raw_results = {}
        raw_p_values = []
        for name, returns in return_series.items():
            valid = returns[~np.isnan(returns)]
            if len(valid) < 30:
                raw_p_values.append(1.0)
            else:
                _, p = stats.ttest_1samp(valid, popmean=0)
                raw_p_values.append(float(p))
            raw_results[name] = returns

        # Multiple comparison correction
        corrected_p, rejected = self._correct_p_values(np.array(raw_p_values))

        # Full validation for each with corrected p-values
        results = {}
        for i, name in enumerate(names):
            result = self.validate_single(
                return_series[name],
                strategy_name=name,
                p_value_corrected=float(corrected_p[i]),
                correction_method=self.correction_method,
            )
            results[name] = result

        return results

    def _correct_p_values(self, p_values: np.ndarray):
        """Apply Bonferroni or Benjamini-Hochberg correction."""
        n = len(p_values)
        if n == 0:
            return p_values, np.array([], dtype=bool)

        if self.correction_method == "bonferroni":
            corrected = np.minimum(p_values * n, 1.0)
            rejected = corrected < self.alpha

        elif self.correction_method in ("benjamini-hochberg", "bh"):
            # BH procedure
            order = np.argsort(p_values)
            corrected = np.ones(n)
            for i, idx in enumerate(order):
                corrected[idx] = min(p_values[idx] * n / (i + 1), 1.0)
            # Enforce monotonicity
            max_so_far = 1.0
            for i in range(n - 1, -1, -1):
                idx = order[i]
                corrected[idx] = min(corrected[idx], max_so_far)
                max_so_far = corrected[idx]
            rejected = corrected < self.alpha

        else:
            corrected = p_values
            rejected = p_values < self.alpha

        return corrected, rejected

    def permutation_test_strategy(
        self,
        returns: np.ndarray,
        signal: np.ndarray,
        n_permutations: int = None,
    ) -> dict:
        """
        Permutation test: shuffle signal alignment with returns.
        Tests if signal → return relationship is real or spurious.
        """
        n_perms = n_permutations or self.n_permutations
        valid = ~np.isnan(returns) & ~np.isnan(signal)
        r = returns[valid]
        s = signal[valid]

        if len(r) < 30:
            return {"p_value": 1.0, "observed_ic": 0.0, "distribution": []}

        # Information coefficient: rank correlation (vectorized)
        from scipy.stats import spearmanr, rankdata
        observed_ic, _ = spearmanr(s, r)

        rng = np.random.default_rng()
        n_obs = len(s)

        # Vectorized: generate all permutations, compute rank correlations
        idx_matrix = np.broadcast_to(np.arange(n_obs), (n_perms, n_obs)).copy()
        rng.permuted(idx_matrix, axis=1, out=idx_matrix)
        perm_s_matrix = s[idx_matrix]  # shape: (n_perms, n_obs)

        # Rank-based Spearman via vectorized rank computation
        rank_r = rankdata(r)
        rank_r_centered = rank_r - rank_r.mean()
        rank_r_norm = np.sqrt(np.sum(rank_r_centered ** 2))

        perm_ics = np.empty(n_perms)
        for i in range(n_perms):
            rank_s = rankdata(perm_s_matrix[i])
            rank_s_centered = rank_s - rank_s.mean()
            rank_s_norm = np.sqrt(np.sum(rank_s_centered ** 2))
            denom = rank_s_norm * rank_r_norm
            perm_ics[i] = np.sum(rank_s_centered * rank_r_centered) / denom if denom > 0 else 0.0

        p_value = float(np.mean(np.abs(perm_ics) >= abs(observed_ic)))

        return {
            "p_value": p_value,
            "observed_ic": float(observed_ic),
            "distribution": perm_ics.tolist(),
        }


# ---------------------------------------------------------------------------
# Walk-Forward Validation
# ---------------------------------------------------------------------------

def walk_forward_validate(
    returns_full: np.ndarray,
    compute_strategy_fn,
    n_splits: int = 5,
    train_ratio: float = 0.7,
) -> dict:
    """
    Time-series walk-forward cross-validation.
    Prevents in-sample optimization leakage.
    """
    n = len(returns_full)
    split_size = n // n_splits

    oos_returns = []
    split_results = []

    for i in range(n_splits - 1):
        train_end = (i + 1) * split_size
        test_end = min(train_end + split_size, n)

        train = returns_full[:train_end]
        test = returns_full[train_end:test_end]

        # Caller provides function to fit on train and predict on test
        oos_ret = compute_strategy_fn(train, test)
        oos_returns.extend(oos_ret)

        split_results.append({
            "split": i,
            "train_n": train_end,
            "test_n": test_end - train_end,
            "oos_sharpe": float(
                np.mean(oos_ret) / np.std(oos_ret, ddof=1) * np.sqrt(252)
                if np.std(oos_ret) > 0 else 0
            ),
        })

    combined_oos = np.array(oos_returns)
    validator = StatisticalValidator()
    oos_validation = validator.validate_single(combined_oos, "walk_forward_oos")

    return {
        "splits": split_results,
        "oos_sharpe": float(
            np.mean(combined_oos) / np.std(combined_oos, ddof=1) * np.sqrt(252)
            if len(combined_oos) > 0 and np.std(combined_oos) > 0 else 0
        ),
        "oos_label": oos_validation.label,
        "oos_p_value": oos_validation.p_value_raw,
        "n_oos_obs": len(combined_oos),
    }
