"""
Feature Engine
==============
Computes technical and statistical features from OHLCV data.

Features:
- Returns (simple, log)
- Rolling volatility
- Momentum (N-day)
- Moving averages (SMA)
- Volume z-score
- ATR (Average True Range)
- RSI
- Bollinger Band width
- PCA factors (cross-sectional)
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import polars as pl
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)


class FeatureEngine:
    def __init__(
        self,
        vol_window: int = 21,
        momentum_windows: list[int] = None,
        ma_windows: list[int] = None,
        atr_window: int = 14,
        rsi_window: int = 14,
        bb_window: int = 20,
        volume_zscore_window: int = 21,
        pca_n_components: int = 3,
        pca_lookback: int = 63,
    ):
        self.vol_window = vol_window
        self.momentum_windows = momentum_windows or [5, 21, 63]
        self.ma_windows = ma_windows or [10, 21, 50, 200]
        self.atr_window = atr_window
        self.rsi_window = rsi_window
        self.bb_window = bb_window
        self.volume_zscore_window = volume_zscore_window
        self.pca_n_components = pca_n_components
        self.pca_lookback = pca_lookback

    def compute(self, raw: pl.DataFrame) -> pl.DataFrame:
        """
        Compute all features for each symbol.
        Returns a single polars DataFrame with columns per feature.
        """
        symbols = raw["symbol"].unique().sort().to_list()
        all_dfs = []

        for sym in symbols:
            sym_df = raw.filter(pl.col("symbol") == sym).sort("timestamp")
            feat_df = self._compute_symbol_features(sym_df)
            all_dfs.append(feat_df)

        if not all_dfs:
            return pl.DataFrame()

        combined = pl.concat(all_dfs)

        # PCA factors across symbols
        combined = self._compute_pca_factors(combined)

        return combined.sort(["symbol", "timestamp"])

    def _compute_symbol_features(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)
        close = df["close"].to_numpy()
        high = df["high"].to_numpy() if "high" in df.columns else close
        low = df["low"].to_numpy() if "low" in df.columns else close
        volume = df["volume"].to_numpy() if "volume" in df.columns else np.ones(n)
        open_ = df["open"].to_numpy() if "open" in df.columns else close

        features = {
            "timestamp": df["timestamp"].to_list(),
            "symbol": df["symbol"].to_list(),
            "open": open_.tolist(),
            "high": high.tolist(),
            "low": low.tolist(),
            "close": close.tolist(),
            "volume": volume.tolist(),
        }

        # Returns
        returns = np.full(n, np.nan)
        returns[1:] = (close[1:] - close[:-1]) / close[:-1]
        features["returns"] = returns.tolist()

        # Log returns
        log_returns = np.full(n, np.nan)
        with np.errstate(divide="ignore", invalid="ignore"):
            log_returns[1:] = np.log(close[1:] / close[:-1])
        features["log_returns"] = log_returns.tolist()

        # Rolling volatility
        vol = self._rolling_std(returns, self.vol_window)
        features["volatility"] = vol.tolist()

        # Annualized volatility
        features["volatility_annual"] = (vol * np.sqrt(252)).tolist()

        # Momentum
        for w in self.momentum_windows:
            mom = np.full(n, np.nan)
            mom[w:] = (close[w:] - close[:-w]) / close[:-w]
            features[f"momentum_{w}d"] = mom.tolist()

        # Simple moving averages
        for w in self.ma_windows:
            sma = self._rolling_mean(close, w)
            features[f"sma_{w}"] = sma.tolist()
            # Price vs MA ratio
            with np.errstate(divide="ignore", invalid="ignore"):
                ratio = np.where(sma > 0, (close - sma) / sma, np.nan)
            features[f"price_vs_sma_{w}"] = ratio.tolist()

        # Volume z-score
        vol_zscore = self._rolling_zscore(volume, self.volume_zscore_window)
        features["volume_zscore"] = vol_zscore.tolist()

        # ATR
        atr = self._compute_atr(high, low, close, self.atr_window)
        features["atr"] = atr.tolist()
        with np.errstate(divide="ignore", invalid="ignore"):
            features["atr_pct"] = np.where(close > 0, atr / close, np.nan).tolist()

        # RSI
        rsi = self._compute_rsi(close, self.rsi_window)
        features["rsi"] = rsi.tolist()

        # Bollinger Band width
        bb_width = self._compute_bb_width(close, self.bb_window)
        features["bb_width"] = bb_width.tolist()

        # Placeholder PCA factors (filled in by _compute_pca_factors)
        features["pca_factor_1"] = [np.nan] * n
        features["pca_factor_2"] = [np.nan] * n
        features["pca_factor_3"] = [np.nan] * n

        return pl.DataFrame(features)

    def _compute_pca_factors(self, combined: pl.DataFrame) -> pl.DataFrame:
        """
        Cross-sectional PCA on log returns. Fills pca_factor_* columns.
        """
        try:
            symbols = combined["symbol"].unique().sort().to_list()
            timestamps = combined["timestamp"].unique().sort().to_list()

            # Pivot to returns matrix: timestamps x symbols
            pivot = (
                combined.select(["timestamp", "symbol", "log_returns"])
                .pivot(index="timestamp", columns="symbol", values="log_returns")
                .sort("timestamp")
            )
            sym_cols = [c for c in pivot.columns if c != "timestamp"]
            mat = pivot.select(sym_cols).to_numpy().astype(float)
            ts_list = pivot["timestamp"].to_list()
            n_t = len(ts_list)

            pca_factors = {s: {1: np.full(n_t, np.nan), 2: np.full(n_t, np.nan), 3: np.full(n_t, np.nan)} for s in symbols}

            for i in range(self.pca_lookback, n_t):
                window = mat[i - self.pca_lookback: i + 1]
                valid_rows = ~np.isnan(window).any(axis=1)
                w = window[valid_rows]
                if len(w) < 10 or w.shape[1] < 2:
                    continue

                try:
                    scaler = StandardScaler()
                    w_scaled = scaler.fit_transform(w)
                    n_comp = min(self.pca_n_components, w.shape[1], w.shape[0] - 1)
                    pca = PCA(n_components=n_comp)
                    scores = pca.fit_transform(w_scaled)
                    # Last row = current timestamp scores
                    current_scores = scores[-1]
                    for j, sym in enumerate(sym_cols):
                        if sym in pca_factors:
                            for k in range(min(n_comp, 3)):
                                pca_factors[sym][k + 1][i] = float(current_scores[k])
                except Exception:
                    pass

            # Build PCA lookup DataFrame and join (vectorized)
            pca_rows = []
            for sym in pca_factors:
                for idx, ts in enumerate(ts_list):
                    pca_rows.append({
                        "timestamp": ts,
                        "symbol": sym,
                        "_pf1": float(pca_factors[sym][1][idx]),
                        "_pf2": float(pca_factors[sym][2][idx]),
                        "_pf3": float(pca_factors[sym][3][idx]),
                    })

            if pca_rows:
                pca_df = pl.DataFrame(pca_rows)
                combined = combined.drop(["pca_factor_1", "pca_factor_2", "pca_factor_3"])
                combined = combined.join(pca_df, on=["timestamp", "symbol"], how="left")
                combined = combined.rename({"_pf1": "pca_factor_1", "_pf2": "pca_factor_2", "_pf3": "pca_factor_3"})
        except Exception as e:
            logger.warning(f"PCA factor computation failed: {e}")

        return combined

    # ── Rolling helpers (vectorized via pandas C-optimized rolling) ─────

    @staticmethod
    def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
        s = pd.Series(arr)
        return s.rolling(window, min_periods=window).mean().to_numpy()

    @staticmethod
    def _rolling_std(arr: np.ndarray, window: int) -> np.ndarray:
        s = pd.Series(arr)
        return s.rolling(window, min_periods=2).std(ddof=1).to_numpy()

    @staticmethod
    def _rolling_zscore(arr: np.ndarray, window: int) -> np.ndarray:
        s = pd.Series(arr)
        mu = s.rolling(window, min_periods=2).mean()
        sigma = s.rolling(window, min_periods=2).std(ddof=1)
        result = ((s - mu) / sigma).fillna(0.0).to_numpy().copy()
        # Restore NaN for initial window
        result[:window - 1] = np.nan
        return result

    @staticmethod
    def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, window: int) -> np.ndarray:
        n = len(close)
        # Vectorized True Range computation
        tr = np.full(n, np.nan)
        hl = high[1:] - low[1:]
        hc = np.abs(high[1:] - close[:-1])
        lc = np.abs(low[1:] - close[:-1])
        tr[1:] = np.maximum(hl, np.maximum(hc, lc))

        # Rolling mean of TR
        return pd.Series(tr).rolling(window, min_periods=1).mean().to_numpy()

    @staticmethod
    def _compute_rsi(close: np.ndarray, window: int) -> np.ndarray:
        deltas = np.diff(close)
        gains = pd.Series(np.maximum(deltas, 0))
        losses = pd.Series(np.maximum(-deltas, 0))

        avg_gain = gains.rolling(window, min_periods=window).mean()
        avg_loss = losses.rolling(window, min_periods=window).mean()

        rs = avg_gain / avg_loss
        rsi_vals = 100 - (100 / (1 + rs))
        # Where avg_loss == 0, RSI = 100
        rsi_vals = rsi_vals.fillna(100.0)

        result = np.full(len(close), np.nan)
        result[window:] = rsi_vals.iloc[window - 1:].to_numpy()
        return result

    @staticmethod
    def _compute_bb_width(close: np.ndarray, window: int) -> np.ndarray:
        s = pd.Series(close)
        mu = s.rolling(window, min_periods=2).mean()
        sigma = s.rolling(window, min_periods=2).std(ddof=1)
        result = np.where(mu > 0, 4 * sigma / mu, np.nan)
        result[:window - 1] = np.nan
        return result
