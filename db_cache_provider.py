"""
DB-Cached Data Provider
=======================
Wraps any DataProvider with a PostgreSQL/SQLite caching layer.
Checks the DB first; on cache miss, fetches from the upstream provider
and writes through to the DB for future reads.

Usage:
    from data_providers import YFinanceProvider
    from db_cache_provider import DBCachedProvider

    upstream = YFinanceProvider()
    provider = DBCachedProvider(upstream, SessionLocal)
    df = provider.fetch_ohlcv(["AAPL"], start, end)  # DB-first
"""

from __future__ import annotations

import logging
from datetime import datetime, date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import polars as pl
from sqlalchemy import text
from sqlalchemy.orm import Session

from data_providers import DataProvider

logger = logging.getLogger(__name__)


class DBCachedProvider(DataProvider):
    """
    DataProvider wrapper that caches OHLCV data in PostgreSQL/SQLite.

    - fetch_ohlcv: checks ohlcv_daily table, fills gaps from upstream
    - Other methods: pass-through to upstream (no DB caching)
    """

    name = "db_cached"

    def __init__(self, upstream: DataProvider, session_factory):
        self.upstream = upstream
        self.session_factory = session_factory

    # ------------------------------------------------------------------
    # OHLCV — DB-cached
    # ------------------------------------------------------------------

    def fetch_ohlcv(
        self,
        symbols: list[str],
        start: datetime,
        end: datetime,
        interval: str = "1d",
    ) -> pl.DataFrame:
        if interval != "1d":
            return self.upstream.fetch_ohlcv(symbols, start, end, interval)

        start_date = start.date() if isinstance(start, datetime) else start
        end_date = end.date() if isinstance(end, datetime) else end

        cached_df = self._read_ohlcv_from_db(symbols, start_date, end_date)
        missing = self._find_missing_symbols(cached_df, symbols, start_date, end_date)

        if missing:
            logger.info("OHLCV cache miss for %d symbols, fetching upstream", len(missing))
            fresh = self.upstream.fetch_ohlcv(missing, start, end, interval)
            if not fresh.is_empty():
                self._write_ohlcv_to_db(fresh)
                cached_df = pl.concat([cached_df, fresh]) if not cached_df.is_empty() else fresh

        if cached_df.is_empty():
            return pl.DataFrame(schema={
                "timestamp": pl.Datetime("us"),
                "symbol": pl.Utf8,
                "open": pl.Float64,
                "high": pl.Float64,
                "low": pl.Float64,
                "close": pl.Float64,
                "volume": pl.Float64,
            })

        return cached_df.sort(["symbol", "timestamp"])

    def _read_ohlcv_from_db(
        self, symbols: list[str], start_date: date, end_date: date,
    ) -> pl.DataFrame:
        try:
            session: Session = self.session_factory()
            try:
                placeholders = ",".join([f":s{i}" for i in range(len(symbols))])
                params = {f"s{i}": s for i, s in enumerate(symbols)}
                params["start"] = str(start_date)
                params["end"] = str(end_date)

                query = text(f"""
                    SELECT symbol, date, open, high, low, close, volume
                    FROM ohlcv_daily
                    WHERE symbol IN ({placeholders})
                      AND date >= :start AND date <= :end
                    ORDER BY symbol, date
                """)
                rows = session.execute(query, params).fetchall()
                if not rows:
                    return pl.DataFrame(schema={
                        "timestamp": pl.Datetime("us"), "symbol": pl.Utf8,
                        "open": pl.Float64, "high": pl.Float64,
                        "low": pl.Float64, "close": pl.Float64, "volume": pl.Float64,
                    })

                data = []
                for r in rows:
                    data.append({
                        "timestamp": datetime.strptime(str(r[1]), "%Y-%m-%d") if isinstance(r[1], str) else datetime.combine(r[1], datetime.min.time()),
                        "symbol": r[0],
                        "open": float(r[2]),
                        "high": float(r[3]),
                        "low": float(r[4]),
                        "close": float(r[5]),
                        "volume": float(r[6]),
                    })
                df = pl.DataFrame(data)
                if df["timestamp"].dtype != pl.Datetime("us"):
                    df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
                return df
            finally:
                session.close()
        except Exception as e:
            logger.warning("DB OHLCV read failed: %s", e)
            return pl.DataFrame(schema={
                "timestamp": pl.Datetime("us"), "symbol": pl.Utf8,
                "open": pl.Float64, "high": pl.Float64,
                "low": pl.Float64, "close": pl.Float64, "volume": pl.Float64,
            })

    def _find_missing_symbols(
        self,
        cached: pl.DataFrame,
        requested: list[str],
        start_date: date,
        end_date: date,
    ) -> list[str]:
        if cached.is_empty():
            return requested

        cached_syms = set(cached["symbol"].unique().to_list())
        missing = [s for s in requested if s not in cached_syms]

        for sym in requested:
            if sym in cached_syms:
                sym_df = cached.filter(pl.col("symbol") == sym)
                if len(sym_df) < 5:
                    missing.append(sym)

        return list(set(missing))

    def _write_ohlcv_to_db(self, df: pl.DataFrame) -> None:
        try:
            session: Session = self.session_factory()
            try:
                from models import OHLCVDaily
                rows_written = 0
                for row in df.iter_rows(named=True):
                    ts = row["timestamp"]
                    d = ts.date() if isinstance(ts, datetime) else ts
                    try:
                        existing = session.query(OHLCVDaily).filter_by(
                            symbol=row["symbol"], date=d
                        ).first()
                        if existing:
                            existing.open = row["open"]
                            existing.high = row["high"]
                            existing.low = row["low"]
                            existing.close = row["close"]
                            existing.volume = row["volume"]
                            existing.fetched_at = datetime.utcnow()
                        else:
                            session.add(OHLCVDaily(
                                symbol=row["symbol"],
                                date=d,
                                open=row["open"],
                                high=row["high"],
                                low=row["low"],
                                close=row["close"],
                                volume=row["volume"],
                                provider=self.upstream.name,
                                fetched_at=datetime.utcnow(),
                            ))
                        rows_written += 1
                    except Exception:
                        continue
                session.commit()
                logger.info("Wrote %d OHLCV rows to DB", rows_written)
            finally:
                session.close()
        except Exception as e:
            logger.warning("DB OHLCV write failed: %s", e)

    # ------------------------------------------------------------------
    # Pass-through methods (no DB caching yet)
    # ------------------------------------------------------------------

    def fetch_history(self, symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
        return self.upstream.fetch_history(symbol, period, interval)

    def fetch_quote(self, symbol: str) -> dict:
        return self.upstream.fetch_quote(symbol)

    def fetch_fundamentals(self, symbol: str) -> dict:
        return self.upstream.fetch_fundamentals(symbol)

    def fetch_ticker_info(self, symbol: str) -> dict:
        return self.upstream.fetch_ticker_info(symbol)

    def fetch_options_expirations(self, symbol: str) -> list[str]:
        return self.upstream.fetch_options_expirations(symbol)

    def fetch_options_chain(self, symbol: str, expiration: Optional[str] = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        return self.upstream.fetch_options_chain(symbol, expiration)

    def batch_download(self, symbols: list[str], start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        return self.upstream.batch_download(symbols, start, end, interval)
