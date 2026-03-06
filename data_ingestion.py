"""
Data Ingestion
==============
Download OHLCV market data and store/load as Parquet.

Providers: yfinance (default)
Storage: Parquet files per project
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

class YFinanceProvider:
    """Downloads OHLCV data via yfinance."""

    name = "yfinance"

    def fetch(
        self,
        symbols: list[str],
        start: datetime,
        end: datetime,
    ) -> pl.DataFrame:
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError("yfinance not installed. Run: pip install yfinance")

        rows = []
        for sym in symbols:
            logger.info(f"Downloading {sym} from {start.date()} to {end.date()}")
            try:
                ticker = yf.Ticker(sym)
                df = ticker.history(start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"), auto_adjust=True)
                if df.empty:
                    logger.warning(f"No data for {sym}")
                    continue
                df = df.reset_index()
                for _, row in df.iterrows():
                    rows.append({
                        "timestamp": row["Date"].to_pydatetime() if hasattr(row["Date"], "to_pydatetime") else row["Date"],
                        "symbol": sym,
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": float(row["Volume"]),
                    })
            except Exception as e:
                logger.error(f"Failed to fetch {sym}: {e}")

        if not rows:
            return pl.DataFrame(schema={
                "timestamp": pl.Datetime("us"),
                "symbol": pl.Utf8,
                "open": pl.Float64,
                "high": pl.Float64,
                "low": pl.Float64,
                "close": pl.Float64,
                "volume": pl.Float64,
            })

        df = pl.DataFrame(rows)
        # Ensure timestamp is Datetime
        if df["timestamp"].dtype != pl.Datetime("us"):
            df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
        return df.sort(["symbol", "timestamp"])


def get_provider(name: str = "yfinance"):
    providers = {"yfinance": YFinanceProvider}
    if name not in providers:
        raise ValueError(f"Unknown provider: {name}. Available: {list(providers)}")
    return providers[name]()


# ---------------------------------------------------------------------------
# DataStore
# ---------------------------------------------------------------------------

class DataStore:
    """Stores and loads OHLCV data as Parquet files."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, project_id: str) -> Path:
        return self.data_dir / f"{project_id}_raw.parquet"

    def ingest(
        self,
        project_id: str,
        provider,
        symbols: list[str],
        start: datetime,
        end: datetime,
    ) -> dict:
        df = provider.fetch(symbols, start, end)
        path = self._path(project_id)
        df.write_parquet(path)
        logger.info(f"Saved {len(df)} rows to {path}")
        return {
            "status": "ok",
            "n_rows": len(df),
            "symbols": symbols,
            "path": str(path),
        }

    def load(self, project_id: str) -> pl.DataFrame:
        path = self._path(project_id)
        if not path.exists():
            return pl.DataFrame()
        df = pl.read_parquet(path)
        if df["timestamp"].dtype != pl.Datetime("us"):
            df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
        return df

    def status(self, project_id: str) -> dict:
        path = self._path(project_id)
        if not path.exists():
            return {"exists": False, "n_rows": 0, "symbols": []}
        df = pl.read_parquet(path)
        return {
            "exists": True,
            "n_rows": len(df),
            "symbols": df["symbol"].unique().sort().to_list(),
            "start": str(df["timestamp"].min()),
            "end": str(df["timestamp"].max()),
            "path": str(path),
        }

    def is_empty(self, project_id: str = None) -> bool:
        """Check if a DataFrame or store is empty."""
        if project_id is not None:
            return not self._path(project_id).exists()
        return True
