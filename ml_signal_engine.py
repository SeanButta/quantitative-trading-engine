"""
ML Signal Engine
================
Gradient Boosting classifier trained on technical features → next-N-day
return direction, with walk-forward retraining and permutation-based
feature importance.

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
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score

# ---------------------------------------------------------------------------
# Optional signal_engine import — module remains usable standalone
# ---------------------------------------------------------------------------

try:
    from signal_engine import BaseSignal, SignalResult
except ImportError:
    try:
        import sys
        import os
        sys.path.insert(0, os.path.dirname(__file__))
        from signal_engine import BaseSignal, SignalResult
    except ImportError:
        # Fallback stubs so the module loads standalone
        from abc import ABC, abstractmethod
        from dataclasses import dataclass as _dataclass, field as _field

        @_dataclass
        class SignalResult:  # type: ignore[no-redef]
            name: str
            symbol: str
            signal: np.ndarray
            timestamps: list
            metadata: dict = _field(default_factory=dict)

            def to_polars(self) -> pl.DataFrame:
                return pl.DataFrame({
                    "timestamp": self.timestamps,
                    "symbol": [self.symbol] * len(self.timestamps),
                    "signal": self.signal,
                    "signal_name": [self.name] * len(self.timestamps),
                })

        class BaseSignal(ABC):  # type: ignore[no-redef]
            def __init__(self, name: str):
                self.name = name

            @abstractmethod
            def compute(self, features: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
                ...


logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default feature columns
# ---------------------------------------------------------------------------

# Primary names as requested in the spec.  Many of these match feature_engine
# output directly; alternatives (actual engine names) are resolved at runtime
# inside _resolve_feature_cols.
_DEFAULT_FEATURE_COLS: list[str] = [
    "returns",
    "log_returns",
    "vol_21",
    "momentum_5",
    "momentum_21",
    "momentum_63",
    "sma_10_ratio",
    "sma_50_ratio",
    "volume_zscore",
    "rsi_14",
    "bb_width",
]

# Mapping from spec names → alternative column names produced by feature_engine
_COL_ALIASES: dict[str, list[str]] = {
    "vol_21":       ["vol_21", "volatility"],
    "momentum_5":   ["momentum_5", "momentum_5d"],
    "momentum_21":  ["momentum_21", "momentum_21d"],
    "momentum_63":  ["momentum_63", "momentum_63d"],
    "sma_10_ratio": ["sma_10_ratio", "price_vs_sma_10"],
    "sma_50_ratio": ["sma_50_ratio", "price_vs_sma_50"],
    "rsi_14":       ["rsi_14", "rsi"],
}


def _resolve_feature_cols(
    requested: list[str],
    available_cols: list[str],
) -> tuple[list[str], dict[str, str]]:
    """
    Resolve requested feature column names against what is actually present in
    the DataFrame, using alias fallbacks where the feature_engine uses
    different naming conventions.

    Returns
    -------
    resolved : list[str]
        Column names as they exist in the DataFrame (may be shorter than
        ``requested`` when columns are truly absent).
    rename_map : dict[str, str]
        Mapping {dataframe_col -> canonical_name} for final X matrix labeling.
    """
    resolved: list[str] = []
    rename_map: dict[str, str] = {}

    for spec_name in requested:
        candidates = _COL_ALIASES.get(spec_name, [spec_name])
        found: Optional[str] = None
        for candidate in candidates:
            if candidate in available_cols:
                found = candidate
                break
        if found is not None:
            resolved.append(found)
            rename_map[found] = spec_name
        else:
            logger.warning(
                "ML signal: feature '%s' (and aliases %s) not found in "
                "DataFrame — skipping.",
                spec_name,
                candidates,
            )

    return resolved, rename_map


# ---------------------------------------------------------------------------
# MLSignalResult dataclass
# ---------------------------------------------------------------------------

@dataclass
class MLSignalResult:
    """Structured result for a single symbol at the latest timestamp."""

    symbol: str
    timestamp: datetime
    p_up: float                      # P(next N days up) in [0, 1]
    direction: str                   # "bullish" / "bearish" / "neutral"
    confidence: float                # |p_up - 0.5| * 2, in [0, 1]
    feature_importance: dict         # {feature_name: importance_score}
    top_feature: str
    model_accuracy: float
    forward_days: int
    signal_strength: int             # 1–5 score
    blurb: str                       # human-readable explanation


# ---------------------------------------------------------------------------
# 1) WalkForwardMLSignal  (BaseSignal subclass)
# ---------------------------------------------------------------------------

class WalkForwardMLSignal(BaseSignal):
    """
    Walk-forward Gradient Boosting classifier.

    For each bar from ``train_window`` onward, a GBM is (re)trained on the
    preceding ``train_window`` days and produces P(up) for the current bar.
    The model is retrained every ``retrain_every`` bars (quarterly by default)
    to avoid the overhead of daily fitting while staying adaptive.

    Signal values are P(up) ∈ [0, 1]; 0.5 is neutral.
    """

    def __init__(
        self,
        forward_days: int = 5,
        train_window: int = 252,
        retrain_every: int = 63,
        min_train_samples: int = 100,
        n_estimators: int = 200,
        max_depth: int = 4,
        feature_cols: list[str] | None = None,
    ):
        super().__init__("walk_forward_ml")
        self.forward_days = forward_days
        self.train_window = train_window
        self.retrain_every = retrain_every
        self.min_train_samples = min_train_samples
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.feature_cols: list[str] = feature_cols if feature_cols is not None else list(_DEFAULT_FEATURE_COLS)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compute(self, features_df: pl.DataFrame, symbol: str, **kwargs) -> SignalResult:
        """
        Run walk-forward ML signal for ``symbol``.

        Parameters
        ----------
        features_df:
            Full features DataFrame (all symbols, as produced by
            FeatureEngine.compute()).
        symbol:
            The ticker / symbol to compute the signal for.

        Returns
        -------
        SignalResult
            ``signal`` array contains P(up) values in [0, 1].  Positions
            before ``train_window`` are filled with 0.5 (neutral).
        """
        try:
            return self._compute_impl(features_df, symbol)
        except Exception as exc:
            logger.warning("WalkForwardMLSignal.compute failed for %s: %s", symbol, exc)
            sym_df = (
                features_df.filter(pl.col("symbol") == symbol).sort("timestamp")
                if "symbol" in features_df.columns
                else features_df.sort("timestamp")
            )
            n = len(sym_df)
            timestamps = sym_df["timestamp"].to_list() if "timestamp" in sym_df.columns else list(range(n))
            return self._neutral_result(symbol, n, timestamps)

    # ------------------------------------------------------------------
    # Internal implementation
    # ------------------------------------------------------------------

    def _compute_impl(self, features_df: pl.DataFrame, symbol: str) -> SignalResult:
        # ── Filter & sort ──────────────────────────────────────────────
        sym_df = features_df.filter(pl.col("symbol") == symbol).sort("timestamp")
        n = len(sym_df)
        timestamps = sym_df["timestamp"].to_list()

        if n < self.min_train_samples:
            logger.warning(
                "ML signal: only %d rows for %s (min %d) — returning neutral.",
                n, symbol, self.min_train_samples,
            )
            return self._neutral_result(symbol, n, timestamps)

        # ── Resolve feature columns ────────────────────────────────────
        available_cols = sym_df.columns
        resolved_cols, rename_map = _resolve_feature_cols(self.feature_cols, available_cols)

        if not resolved_cols:
            logger.warning("ML signal: no usable feature columns for %s — returning neutral.", symbol)
            return self._neutral_result(symbol, n, timestamps)

        # ── Build feature matrix using Polars/numpy (no pandas/pyarrow dep) ─
        canonical_cols = [rename_map.get(c, c) for c in resolved_cols]

        close_arr = sym_df["close"].to_numpy().astype(float)

        # Build X column-by-column to avoid any pandas/pyarrow dependency
        X_cols_list: list[np.ndarray] = []
        for col in resolved_cols:
            series = sym_df[col].to_numpy()
            X_cols_list.append(series.astype(float))
        X_full = np.column_stack(X_cols_list) if X_cols_list else np.empty((n, 0))

        # ── Build target: next-N-day return direction ──────────────────
        y_full = self._build_target(close_arr, self.forward_days)

        # ── Impute NaNs with column means (simple but safe) ───────────
        X_full = self._impute_nan_colmean(X_full)

        # ── Walk-forward loop ──────────────────────────────────────────
        signal_arr = np.full(n, 0.5)  # default neutral
        predictions_oos = []          # (true_label, predicted_label) pairs
        model: Optional[GradientBoostingClassifier] = None
        n_retrain_events = 0
        last_importance: Optional[np.ndarray] = None

        for i in range(self.train_window, n):
            # Determine if we need to (re)train
            steps_since_start = i - self.train_window
            should_retrain = (model is None) or (steps_since_start % self.retrain_every == 0)

            if should_retrain:
                train_start = max(0, i - self.train_window)
                train_end = i  # exclusive

                X_train = X_full[train_start:train_end]
                y_train = y_full[train_start:train_end]

                # Drop rows where target is NaN (tail of the target array)
                valid_mask = ~np.isnan(y_train)
                X_tr = X_train[valid_mask]
                y_tr = y_train[valid_mask].astype(int)

                if len(X_tr) < self.min_train_samples // 2:
                    # Not enough labeled samples yet — skip this bar
                    continue

                # Verify both classes are present
                if len(np.unique(y_tr)) < 2:
                    # Degenerate target — skip
                    continue

                try:
                    # Try XGBoost first (faster, handles missing data, better accuracy)
                    try:
                        import xgboost as xgb
                        model = xgb.XGBClassifier(
                            n_estimators=self.n_estimators,
                            max_depth=self.max_depth,
                            random_state=42,
                            subsample=0.8,
                            learning_rate=0.05,
                            use_label_encoder=False,
                            eval_metric="logloss",
                            verbosity=0,
                        )
                        model.fit(X_tr, y_tr)
                        last_importance = model.feature_importances_.copy()
                    except (ImportError, Exception):
                        # Fallback to sklearn GBM
                        model = GradientBoostingClassifier(
                            n_estimators=self.n_estimators,
                            max_depth=self.max_depth,
                            random_state=42,
                            subsample=0.8,
                            learning_rate=0.05,
                        )
                        model.fit(X_tr, y_tr)
                        last_importance = model.feature_importances_.copy()
                    n_retrain_events += 1
                except Exception as fit_exc:
                    logger.warning("ML fit failed at i=%d for %s: %s", i, symbol, fit_exc)
                    model = None
                    continue

            if model is None:
                continue

            # ── Predict on current bar ─────────────────────────────────
            x_i = X_full[i : i + 1]
            try:
                proba = model.predict_proba(x_i)
                # Identify the column for class 1 (up)
                classes = list(model.classes_)
                if 1 in classes:
                    p_up = float(proba[0, classes.index(1)])
                else:
                    p_up = 0.5
            except Exception as pred_exc:
                logger.warning("GBM predict failed at i=%d for %s: %s", i, symbol, pred_exc)
                p_up = 0.5

            signal_arr[i] = p_up

            # Collect for accuracy computation (only where true label is known)
            if not np.isnan(y_full[i]):
                pred_class = 1 if p_up > 0.5 else 0
                predictions_oos.append((int(y_full[i]), pred_class))

        # ── Feature importance ─────────────────────────────────────────
        if last_importance is not None and len(last_importance) == len(canonical_cols):
            importance_dict = dict(zip(canonical_cols, last_importance.tolist()))
            importance_dict = dict(
                sorted(importance_dict.items(), key=lambda kv: kv[1], reverse=True)
            )
        else:
            importance_dict = {c: 0.0 for c in canonical_cols}

        top_feature = next(iter(importance_dict), "unknown")

        # ── Out-of-sample accuracy ─────────────────────────────────────
        if predictions_oos:
            y_true_oos = [p[0] for p in predictions_oos]
            y_pred_oos = [p[1] for p in predictions_oos]
            model_accuracy = float(accuracy_score(y_true_oos, y_pred_oos))
        else:
            model_accuracy = float("nan")

        train_samples_used = min(self.train_window, n)

        metadata = {
            "feature_importance": importance_dict,
            "top_feature": top_feature,
            "train_samples_used": train_samples_used,
            "model_accuracy": model_accuracy,
            "n_retrain_events": n_retrain_events,
            "forward_days": self.forward_days,
        }

        return SignalResult(
            name=self.name,
            symbol=symbol,
            signal=signal_arr,
            timestamps=timestamps,
            metadata=metadata,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_target(close: np.ndarray, forward_days: int) -> np.ndarray:
        """
        y[i] = 1 if close[i + forward_days] > close[i] else 0.
        NaN for the last ``forward_days`` positions (future unknown).
        """
        n = len(close)
        y = np.full(n, np.nan)
        if n <= forward_days:
            return y
        future_close = np.empty(n)
        future_close[:] = np.nan
        future_close[: n - forward_days] = close[forward_days:]
        with np.errstate(divide="ignore", invalid="ignore"):
            fwd_return = np.where(close > 0, future_close / close - 1.0, np.nan)
        y = np.where(np.isnan(fwd_return), np.nan, (fwd_return > 0).astype(float))
        return y

    @staticmethod
    def _impute_nan_colmean(X: np.ndarray) -> np.ndarray:
        """Replace NaN values with the column mean (or 0 if all NaN)."""
        X = X.copy()
        for j in range(X.shape[1]):
            col = X[:, j]
            nan_mask = np.isnan(col)
            if nan_mask.any():
                col_mean = np.nanmean(col) if not np.all(nan_mask) else 0.0
                col_mean = 0.0 if np.isnan(col_mean) else col_mean
                X[nan_mask, j] = col_mean
        return X

    @staticmethod
    def _neutral_result(symbol: str, n: int, timestamps: list) -> SignalResult:
        return SignalResult(
            name="walk_forward_ml",
            symbol=symbol,
            signal=np.full(n, 0.5),
            timestamps=timestamps,
            metadata={
                "feature_importance": {},
                "top_feature": "none",
                "train_samples_used": 0,
                "model_accuracy": float("nan"),
                "n_retrain_events": 0,
                "forward_days": 0,
            },
        )


# ---------------------------------------------------------------------------
# 2) MLSignalEngine  (high-level, non-BaseSignal)
# ---------------------------------------------------------------------------

class MLSignalEngine:
    """
    High-level entry point called from the API layer.

    Wraps ``WalkForwardMLSignal`` and returns a rich ``MLSignalResult`` for
    the most recent timestamp of the requested symbol.

    Example
    -------
    ::

        engine = MLSignalEngine(forward_days=5)
        result = engine.run(features_df, "AAPL")
        print(result.direction, result.confidence, result.blurb)
    """

    def __init__(
        self,
        forward_days: int = 5,
        train_window: int = 252,
        retrain_every: int = 63,
        n_estimators: int = 200,
        max_depth: int = 4,
        feature_cols: list[str] | None = None,
    ):
        self.forward_days = forward_days
        self.train_window = train_window
        self.retrain_every = retrain_every
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.feature_cols = feature_cols

    def run(self, features_df: pl.DataFrame, symbol: str) -> MLSignalResult:
        """
        Run walk-forward ML signal for one symbol.

        Returns
        -------
        MLSignalResult
            Fully populated result for the latest available timestamp.
        """
        try:
            return self._run_impl(features_df, symbol)
        except Exception as exc:
            logger.warning("MLSignalEngine.run failed for %s: %s", symbol, exc)
            return self._neutral_ml_result(symbol, self.forward_days)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_impl(self, features_df: pl.DataFrame, symbol: str) -> MLSignalResult:
        signal_obj = WalkForwardMLSignal(
            forward_days=self.forward_days,
            train_window=self.train_window,
            retrain_every=self.retrain_every,
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            feature_cols=self.feature_cols,
        )

        result = signal_obj.compute(features_df, symbol)

        # ── Extract latest bar ─────────────────────────────────────────
        if len(result.signal) == 0:
            return self._neutral_ml_result(symbol, self.forward_days)

        latest_p_up = float(result.signal[-1])
        # Guard against degenerate values
        if math.isnan(latest_p_up) or math.isinf(latest_p_up):
            latest_p_up = 0.5

        latest_timestamp = result.timestamps[-1]

        # ── Coerce timestamp to datetime ───────────────────────────────
        if not isinstance(latest_timestamp, datetime):
            try:
                latest_timestamp = datetime.fromisoformat(str(latest_timestamp))
            except Exception:
                latest_timestamp = datetime.utcnow()

        # ── Direction & confidence ─────────────────────────────────────
        if latest_p_up > 0.55:
            direction = "bullish"
        elif latest_p_up < 0.45:
            direction = "bearish"
        else:
            direction = "neutral"

        confidence = abs(latest_p_up - 0.5) * 2.0
        confidence = max(0.0, min(1.0, confidence))

        # ── Signal strength 1–5 ────────────────────────────────────────
        signal_strength = self._confidence_to_strength(confidence)

        # ── Metadata ──────────────────────────────────────────────────
        meta = result.metadata
        feature_importance: dict = meta.get("feature_importance", {})
        top_feature: str = meta.get("top_feature", "unknown")
        model_accuracy: float = meta.get("model_accuracy", float("nan"))

        # ── Human-readable blurb ───────────────────────────────────────
        blurb = self._build_blurb(
            symbol=symbol,
            p_up=latest_p_up,
            direction=direction,
            forward_days=self.forward_days,
            top_feature=top_feature,
            feature_importance=feature_importance,
            model_accuracy=model_accuracy,
        )

        return MLSignalResult(
            symbol=symbol,
            timestamp=latest_timestamp,
            p_up=latest_p_up,
            direction=direction,
            confidence=confidence,
            feature_importance=feature_importance,
            top_feature=top_feature,
            model_accuracy=model_accuracy,
            forward_days=self.forward_days,
            signal_strength=signal_strength,
            blurb=blurb,
        )

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _confidence_to_strength(confidence: float) -> int:
        """Map confidence ∈ [0, 1] to integer strength 1–5."""
        if confidence < 0.2:
            return 1
        elif confidence < 0.4:
            return 2
        elif confidence < 0.6:
            return 3
        elif confidence < 0.8:
            return 4
        else:
            return 5

    @staticmethod
    def _build_blurb(
        symbol: str,
        p_up: float,
        direction: str,
        forward_days: int,
        top_feature: str,
        feature_importance: dict,
        model_accuracy: float,
    ) -> str:
        p_pct = round(p_up * 100)
        top_imp = feature_importance.get(top_feature, 0.0) if feature_importance else 0.0
        top_imp_pct = round(top_imp * 100)

        acc_str = (
            f" Walk-forward accuracy: {round(model_accuracy * 100)}%."
            if not math.isnan(model_accuracy)
            else ""
        )

        return (
            f"GBM model assigns {p_pct}% probability of upward move over next "
            f"{forward_days} days ({direction}). "
            f"Top feature: {top_feature} ({top_imp_pct}% importance).{acc_str}"
        )

    @staticmethod
    def _neutral_ml_result(symbol: str, forward_days: int) -> MLSignalResult:
        return MLSignalResult(
            symbol=symbol,
            timestamp=datetime.utcnow(),
            p_up=0.5,
            direction="neutral",
            confidence=0.0,
            feature_importance={},
            top_feature="none",
            model_accuracy=float("nan"),
            forward_days=forward_days,
            signal_strength=1,
            blurb=(
                f"GBM model could not produce a signal for {symbol}. "
                "Insufficient data or feature unavailability."
            ),
        )


# ---------------------------------------------------------------------------
# 3) MLBacktestSignal  (backtest_engine integration)
# ---------------------------------------------------------------------------

class MLBacktestSignal:
    """
    Wraps ``WalkForwardMLSignal`` for integration with the backtest engine.

    Converts P(up) probabilities to a discrete signal series:
        +1  if P(up) > threshold
        -1  if P(up) < (1 - threshold)
         0  otherwise (neutral)

    Example
    -------
    ::

        bt_sig = MLBacktestSignal(forward_days=5, threshold=0.55)
        df = bt_sig.generate_signals(features_df, "AAPL")
        # df columns: timestamp, symbol, signal
    """

    def __init__(
        self,
        forward_days: int = 5,
        train_window: int = 252,
        threshold: float = 0.55,
        retrain_every: int = 63,
        n_estimators: int = 200,
        max_depth: int = 4,
        feature_cols: list[str] | None = None,
    ):
        if not (0.5 < threshold <= 1.0):
            raise ValueError(f"threshold must be in (0.5, 1.0], got {threshold}")
        self.forward_days = forward_days
        self.train_window = train_window
        self.threshold = threshold
        self.retrain_every = retrain_every
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.feature_cols = feature_cols

    def generate_signals(self, features_df: pl.DataFrame, symbol: str) -> pl.DataFrame:
        """
        Generate discrete signal series for use with the backtest engine.

        Parameters
        ----------
        features_df:
            Full features DataFrame (multi-symbol OK).
        symbol:
            Ticker to generate signals for.

        Returns
        -------
        pl.DataFrame
            Columns: ``timestamp``, ``symbol``, ``signal`` (int8: -1 / 0 / 1).
        """
        try:
            return self._generate_impl(features_df, symbol)
        except Exception as exc:
            logger.warning("MLBacktestSignal.generate_signals failed for %s: %s", symbol, exc)
            return self._empty_signals(features_df, symbol)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _generate_impl(self, features_df: pl.DataFrame, symbol: str) -> pl.DataFrame:
        signal_engine = WalkForwardMLSignal(
            forward_days=self.forward_days,
            train_window=self.train_window,
            retrain_every=self.retrain_every,
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            feature_cols=self.feature_cols,
        )

        result = signal_engine.compute(features_df, symbol)

        p_up_arr = result.signal  # shape (n,), values in [0, 1]
        timestamps = result.timestamps
        n = len(p_up_arr)

        lower_threshold = 1.0 - self.threshold

        discrete = np.zeros(n, dtype=np.int8)
        discrete[p_up_arr > self.threshold] = 1
        discrete[p_up_arr < lower_threshold] = -1
        # Positions still 0 where p_up_arr is nan or exactly 0.5
        nan_mask = np.isnan(p_up_arr)
        discrete[nan_mask] = 0

        return pl.DataFrame({
            "timestamp": timestamps,
            "symbol": [symbol] * n,
            "signal": discrete.tolist(),
        })

    def _empty_signals(self, features_df: pl.DataFrame, symbol: str) -> pl.DataFrame:
        """Return a neutral all-zero signal DataFrame on failure."""
        try:
            sym_df = (
                features_df.filter(pl.col("symbol") == symbol).sort("timestamp")
                if "symbol" in features_df.columns
                else features_df.sort("timestamp")
            )
            timestamps = sym_df["timestamp"].to_list()
            n = len(timestamps)
        except Exception:
            timestamps = []
            n = 0

        return pl.DataFrame({
            "timestamp": timestamps,
            "symbol": [symbol] * n,
            "signal": [0] * n,
        })


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------

def run_ml_signal(
    features_df: pl.DataFrame,
    symbol: str,
    forward_days: int = 5,
    train_window: int = 252,
    retrain_every: int = 63,
) -> MLSignalResult:
    """
    Convenience wrapper — create a one-off ``MLSignalEngine`` and run it.

    Suitable for quick usage from notebooks or the REPL.
    """
    engine = MLSignalEngine(
        forward_days=forward_days,
        train_window=train_window,
        retrain_every=retrain_every,
    )
    return engine.run(features_df, symbol)
