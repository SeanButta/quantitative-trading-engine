"""
Data Provider Abstraction
=========================
Swappable market data sources. YFinanceProvider is the default;
others (Polygon, Alpha Vantage, etc.) can be dropped in later by
implementing the same interface.

Usage:
    from data_providers import YFinanceProvider
    provider = YFinanceProvider()
    df = provider.fetch_ohlcv(["AAPL","MSFT"], start, end)
"""

from __future__ import annotations

import abc
import logging
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
import polars as pl

logger = logging.getLogger(__name__)


class DataProvider(abc.ABC):
    """Abstract base class for all market data providers."""

    name: str = "base"

    @abc.abstractmethod
    def fetch_ohlcv(
        self,
        symbols: list[str],
        start: datetime,
        end: datetime,
        interval: str = "1d",
    ) -> pl.DataFrame:
        """
        Fetch OHLCV bars.
        Returns Polars DataFrame with columns:
            timestamp (Datetime), symbol (Utf8),
            open, high, low, close, volume (Float64)
        """
        ...

    @abc.abstractmethod
    def fetch_history(
        self,
        symbol: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> pd.DataFrame:
        """
        Fetch history using a relative period string (e.g. "1y", "6mo").
        Returns a pandas DataFrame with DatetimeIndex and OHLCV columns.
        Used by TA endpoints that expect pandas with period syntax.
        """
        ...

    @abc.abstractmethod
    def fetch_quote(self, symbol: str) -> dict:
        """
        Fetch current spot quote.
        Returns dict with at least: lastPrice, previousClose, change, changePct, volume
        """
        ...

    @abc.abstractmethod
    def fetch_fundamentals(self, symbol: str) -> dict:
        """
        Fetch fundamental data (P/E, market cap, earnings, etc.).
        Returns raw dict of fundamental fields.
        """
        ...

    @abc.abstractmethod
    def fetch_options_expirations(self, symbol: str) -> list[str]:
        """Return list of available option expiration date strings."""
        ...

    @abc.abstractmethod
    def fetch_options_chain(
        self,
        symbol: str,
        expiration: Optional[str] = None,
    ) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Fetch options chain for a symbol.
        Returns (calls_df, puts_df) as raw pandas DataFrames from the provider.
        """
        ...

    @abc.abstractmethod
    def fetch_ticker_info(self, symbol: str) -> dict:
        """Fetch full ticker info dict (used for fundamentals, analyst targets, etc.)."""
        ...

    @abc.abstractmethod
    def batch_download(
        self,
        symbols: list[str],
        start: str,
        end: str,
        interval: str = "1d",
    ) -> pd.DataFrame:
        """
        Batch download OHLCV for multiple symbols.
        Returns a pandas DataFrame (multi-level columns or stacked).
        """
        ...


class YFinanceProvider(DataProvider):
    """Market data provider backed by yfinance."""

    name = "yfinance"

    def __init__(self):
        try:
            import yfinance  # noqa: F401
        except ImportError:
            raise ImportError("yfinance not installed. Run: pip install yfinance")

    def fetch_ohlcv(
        self,
        symbols: list[str],
        start: datetime,
        end: datetime,
        interval: str = "1d",
    ) -> pl.DataFrame:
        import yfinance as yf

        rows = []
        for sym in symbols:
            logger.info("Downloading %s from %s to %s", sym, start.date(), end.date())
            try:
                ticker = yf.Ticker(sym)
                df = ticker.history(
                    start=start.strftime("%Y-%m-%d"),
                    end=end.strftime("%Y-%m-%d"),
                    interval=interval,
                    auto_adjust=True,
                )
                if df.empty:
                    logger.warning("No data for %s", sym)
                    continue
                df = df.reset_index()
                for _, row in df.iterrows():
                    ts = row["Date"]
                    if hasattr(ts, "to_pydatetime"):
                        ts = ts.to_pydatetime()
                    rows.append({
                        "timestamp": ts,
                        "symbol": sym,
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": float(row["Volume"]),
                    })
            except Exception as e:
                logger.error("Failed to fetch %s: %s", sym, e)

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
        if df["timestamp"].dtype != pl.Datetime("us"):
            df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
        return df.sort(["symbol", "timestamp"])

    def fetch_history(
        self,
        symbol: str,
        period: str = "1y",
        interval: str = "1d",
    ) -> pd.DataFrame:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        return ticker.history(period=period, interval=interval, auto_adjust=True)

    def fetch_quote(self, symbol: str) -> dict:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        try:
            fi = ticker.fast_info
            return {
                "lastPrice": float(fi["lastPrice"]),
                "previousClose": float(fi.get("previousClose", 0)),
                "open": float(fi.get("open", 0)),
                "dayHigh": float(fi.get("dayHigh", 0)),
                "dayLow": float(fi.get("dayLow", 0)),
                "volume": int(fi.get("lastVolume", 0)),
                "marketCap": float(fi.get("marketCap", 0)),
            }
        except Exception:
            hist = ticker.history(period="2d")
            if hist.empty:
                return {"lastPrice": 0}
            last = hist.iloc[-1]
            return {
                "lastPrice": float(last["Close"]),
                "previousClose": float(hist.iloc[-2]["Close"]) if len(hist) > 1 else 0,
                "volume": int(last.get("Volume", 0)),
            }

    def fetch_fundamentals(self, symbol: str) -> dict:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        return info

    def fetch_ticker_info(self, symbol: str) -> dict:
        return self.fetch_fundamentals(symbol)

    def fetch_options_expirations(self, symbol: str) -> list[str]:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        try:
            return list(ticker.options)
        except Exception:
            return []

    def fetch_options_chain(
        self,
        symbol: str,
        expiration: Optional[str] = None,
    ) -> tuple[pd.DataFrame, pd.DataFrame]:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        chain = ticker.option_chain(expiration)
        return chain.calls, chain.puts

    def batch_download(
        self,
        symbols: list[str],
        start: str,
        end: str,
        interval: str = "1d",
    ) -> pd.DataFrame:
        import yfinance as yf
        return yf.download(symbols, start=start, end=end, interval=interval, auto_adjust=True, progress=False)


def get_provider(name: str = "yfinance") -> DataProvider:
    providers = {"yfinance": YFinanceProvider}
    if name not in providers:
        raise ValueError(f"Unknown provider: {name}. Available: {list(providers)}")
    return providers[name]()
