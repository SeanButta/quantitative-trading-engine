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

            # Build a lookup: (timestamp, symbol) → pca factors
            ts_idx = {ts: i for i, ts in enumerate(ts_list)}

            # Update combined DataFrame
            pf1 = []
            pf2 = []
            pf3 = []
            for row in combined.iter_rows(named=True):
                sym = row["symbol"]
                ts = row["timestamp"]
                idx = ts_idx.get(ts)
                if idx is not None and sym in pca_factors:
                    pf1.append(float(pca_factors[sym][1][idx]))
                    pf2.append(float(pca_factors[sym][2][idx]))
                    pf3.append(float(pca_factors[sym][3][idx]))
                else:
                    pf1.append(float("nan"))
                    pf2.append(float("nan"))
                    pf3.append(float("nan"))

            combined = combined.with_columns([
                pl.Series("pca_factor_1", pf1),
                pl.Series("pca_factor_2", pf2),
                pl.Series("pca_factor_3", pf3),
            ])
        except Exception as e:
            logger.warning(f"PCA factor computation failed: {e}")

        return combined

    # ── Rolling helpers ──────────────────────────────────────

    @staticmethod
    def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
        result = np.full(len(arr), np.nan)
        for i in range(window - 1, len(arr)):
            result[i] = np.nanmean(arr[i - window + 1: i + 1])
        return result

    @staticmethod
    def _rolling_std(arr: np.ndarray, window: int) -> np.ndarray:
        result = np.full(len(arr), np.nan)
        for i in range(window - 1, len(arr)):
            w = arr[i - window + 1: i + 1]
            valid = w[~np.isnan(w)]
            if len(valid) > 1:
                result[i] = float(np.std(valid, ddof=1))
        return result

    @staticmethod
    def _rolling_zscore(arr: np.ndarray, window: int) -> np.ndarray:
        result = np.full(len(arr), np.nan)
        for i in range(window - 1, len(arr)):
            w = arr[i - window + 1: i + 1]
            valid = w[~np.isnan(w)]
            if len(valid) > 1:
                mu = np.mean(valid)
                sigma = np.std(valid, ddof=1)
                if sigma > 0:
                    result[i] = (arr[i] - mu) / sigma
                else:
                    result[i] = 0.0
        return result

    @staticmethod
    def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, window: int) -> np.ndarray:
        n = len(close)
        tr = np.full(n, np.nan)
        for i in range(1, n):
            hl = high[i] - low[i]
            hc = abs(high[i] - close[i - 1])
            lc = abs(low[i] - close[i - 1])
            tr[i] = max(hl, hc, lc)

        atr = np.full(n, np.nan)
        for i in range(window, n):
            valid = tr[i - window + 1: i + 1]
            valid = valid[~np.isnan(valid)]
            if len(valid) > 0:
                atr[i] = float(np.mean(valid))
        return atr

    @staticmethod
    def _compute_rsi(close: np.ndarray, window: int) -> np.ndarray:
        n = len(close)
        rsi = np.full(n, np.nan)
        deltas = np.diff(close)
        gains = np.maximum(deltas, 0)
        losses = np.maximum(-deltas, 0)

        for i in range(window, n):
            g = gains[i - window: i]
            l = losses[i - window: i]
            avg_gain = np.mean(g) if len(g) > 0 else 0
            avg_loss = np.mean(l) if len(l) > 0 else 0
            if avg_loss == 0:
                rsi[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi[i] = 100 - (100 / (1 + rs))
        return rsi

    @staticmethod
    def _compute_bb_width(close: np.ndarray, window: int) -> np.ndarray:
        n = len(close)
        bb_width = np.full(n, np.nan)
        for i in range(window - 1, n):
            w = close[i - window + 1: i + 1]
            valid = w[~np.isnan(w)]
            if len(valid) > 1:
                mu = np.mean(valid)
                sigma = np.std(valid, ddof=1)
                if mu > 0:
                    bb_width[i] = 4 * sigma / mu  # 2-sigma band width as % of price
        return bb_width
