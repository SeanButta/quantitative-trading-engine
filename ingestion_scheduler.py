"""
Batch Ingestion Scheduler
=========================
Scheduled data ingestion jobs for production deployment.

- EOD prices:  nightly after market close (6pm ET)
- FRED macro:  monthly (most series update monthly)
- SEC filings: quarterly (10-K/10-Q cadence)

Each method fetches from upstream providers and upserts into
the PostgreSQL/SQLite database tables.

Usage:
    from ingestion_scheduler import IngestionScheduler

    scheduler = IngestionScheduler(provider, session_factory)
    scheduler.ingest_eod_prices(["AAPL", "MSFT", "SPY"])
    scheduler.ingest_fred_series(["DGS10", "UNRATE", "CPIAUCSL"])
    scheduler.ingest_sec_filings(["0000320193"])  # Apple's CIK
"""

from __future__ import annotations

import logging
from datetime import datetime, date, timedelta
from typing import Optional

import numpy as np

from data_providers import DataProvider

logger = logging.getLogger(__name__)

# Batch size for DB writes (avoids overwhelming connections)
BATCH_SIZE = 50


class IngestionScheduler:
    """Orchestrates batch data ingestion into the DB."""

    def __init__(self, provider: DataProvider, session_factory):
        self.provider = provider
        self.session_factory = session_factory

    # ------------------------------------------------------------------
    # EOD Prices
    # ------------------------------------------------------------------

    def ingest_eod_prices(
        self,
        symbols: list[str],
        lookback_days: int = 5,
    ) -> dict:
        """
        Fetch recent EOD prices and upsert into ohlcv_daily.
        Default lookback of 5 days catches weekends/holidays.
        """
        from models import OHLCVDaily

        end = datetime.utcnow()
        start = end - timedelta(days=lookback_days)

        total_written = 0
        errors = {}

        # Process in batches
        for i in range(0, len(symbols), BATCH_SIZE):
            batch = symbols[i:i + BATCH_SIZE]
            logger.info("Ingesting EOD batch %d-%d of %d", i, i + len(batch), len(symbols))

            try:
                df = self.provider.fetch_ohlcv(batch, start, end)
                if df.is_empty():
                    continue

                session = self.session_factory()
                try:
                    for row in df.iter_rows(named=True):
                        ts = row["timestamp"]
                        d = ts.date() if isinstance(ts, datetime) else ts
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
                                provider=self.provider.name,
                                fetched_at=datetime.utcnow(),
                            ))
                        total_written += 1
                    session.commit()
                finally:
                    session.close()
            except Exception as e:
                logger.error("EOD batch %d failed: %s", i, e)
                for sym in batch:
                    errors[sym] = str(e)

        return {
            "status": "complete",
            "rows_written": total_written,
            "symbols_requested": len(symbols),
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # FRED Macro Series
    # ------------------------------------------------------------------

    def ingest_fred_series(
        self,
        series_ids: Optional[list[str]] = None,
        lookback_days: int = 90,
    ) -> dict:
        """
        Fetch FRED macro series and upsert into macro_series table.
        """
        from models import MacroSeries

        # Default popular FRED series
        if series_ids is None:
            series_ids = [
                "DGS10", "DGS2", "DGS30",     # Treasury yields
                "UNRATE",                        # Unemployment
                "CPIAUCSL",                      # CPI
                "FEDFUNDS",                      # Fed funds rate
                "VIXCLS",                        # VIX
                "DTWEXBGS",                      # Trade-weighted USD
                "BAMLH0A0HYM2",                  # HY OAS spread
                "T10Y2Y",                        # 10Y-2Y spread
                "ICSA",                          # Initial claims
                "INDPRO",                        # Industrial production
                "UMCSENT",                       # Consumer sentiment
                "M2SL",                          # M2 money supply
            ]

        total_written = 0
        errors = {}

        for sid in series_ids:
            try:
                # Try to use existing fred_data module if available
                try:
                    from fred_data import _get as fred_get
                    end_date = date.today().strftime("%Y-%m-%d")
                    start_date = (date.today() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
                    data = fred_get(sid, start_date, end_date)
                except (ImportError, Exception):
                    logger.debug("FRED module not available for %s, skipping", sid)
                    continue

                if not data:
                    continue

                session = self.session_factory()
                try:
                    for entry in data:
                        d = entry.get("date")
                        v = entry.get("value")
                        if d is None or v is None:
                            continue
                        if isinstance(d, str):
                            d = date.fromisoformat(d)

                        existing = session.query(MacroSeries).filter_by(
                            series_id=sid, date=d
                        ).first()
                        if existing:
                            existing.value = float(v)
                            existing.fetched_at = datetime.utcnow()
                        else:
                            session.add(MacroSeries(
                                series_id=sid,
                                date=d,
                                value=float(v),
                                fetched_at=datetime.utcnow(),
                            ))
                        total_written += 1
                    session.commit()
                finally:
                    session.close()

            except Exception as e:
                logger.error("FRED series %s failed: %s", sid, e)
                errors[sid] = str(e)

        return {
            "status": "complete",
            "rows_written": total_written,
            "series_requested": len(series_ids),
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # SEC Filings
    # ------------------------------------------------------------------

    def ingest_sec_filings(
        self,
        ciks: Optional[list[str]] = None,
    ) -> dict:
        """
        Fetch SEC filing metadata and upsert into sec_filings table.
        """
        from models import SecFiling

        total_written = 0
        errors = {}

        if not ciks:
            return {"status": "complete", "rows_written": 0, "errors": {}}

        for cik in ciks:
            try:
                try:
                    from sec_feed import SecFeed
                    feed = SecFeed()
                    filings = feed.fetch_submissions(cik)
                except (ImportError, Exception) as e:
                    logger.debug("SEC module not available for CIK %s: %s", cik, e)
                    continue

                if not filings:
                    continue

                session = self.session_factory()
                try:
                    for filing in filings:
                        accession = filing.get("accession", "")
                        if not accession:
                            continue

                        existing = session.query(SecFiling).filter_by(
                            cik=cik, accession=accession
                        ).first()
                        if existing:
                            continue  # SEC filings don't change

                        filed_str = filing.get("filingDate", "")
                        period_str = filing.get("periodOfReport", "")
                        session.add(SecFiling(
                            cik=cik,
                            accession=accession,
                            form_type=filing.get("form", ""),
                            filed_date=date.fromisoformat(filed_str) if filed_str else None,
                            period_end=date.fromisoformat(period_str) if period_str else None,
                            raw_json=filing,
                            fetched_at=datetime.utcnow(),
                        ))
                        total_written += 1
                    session.commit()
                finally:
                    session.close()

            except Exception as e:
                logger.error("SEC CIK %s failed: %s", cik, e)
                errors[cik] = str(e)

        return {
            "status": "complete",
            "rows_written": total_written,
            "ciks_requested": len(ciks),
            "errors": errors,
        }

    # ------------------------------------------------------------------
    # Get tracked symbols (union of projects + watchlists + defaults)
    # ------------------------------------------------------------------

    def get_tracked_symbols(self) -> list[str]:
        """Return all unique symbols the platform should keep up-to-date."""
        from models import Project, Watchlist

        symbols = set()

        # Default universe
        symbols.update(["SPY", "QQQ", "IWM", "TLT", "GLD", "DIA"])

        session = self.session_factory()
        try:
            # From projects
            projects = session.query(Project).all()
            for p in projects:
                if p.symbols:
                    syms = p.symbols if isinstance(p.symbols, list) else []
                    symbols.update(syms)

            # From watchlists
            watchlists = session.query(Watchlist).all()
            for w in watchlists:
                if w.symbols:
                    syms = w.symbols if isinstance(w.symbols, list) else []
                    symbols.update(syms)
        finally:
            session.close()

        return sorted(symbols)

    # ------------------------------------------------------------------
    # DB stats
    # ------------------------------------------------------------------

    def get_ingestion_status(self) -> dict:
        """Return row counts and last-updated timestamps for all data tables."""
        from models import OHLCVDaily, MacroSeries, SecFiling, Fundamental

        session = self.session_factory()
        try:
            ohlcv_count = session.query(OHLCVDaily).count()
            macro_count = session.query(MacroSeries).count()
            sec_count = session.query(SecFiling).count()
            fund_count = session.query(Fundamental).count()

            # Latest fetched_at for each table
            from sqlalchemy import func
            ohlcv_latest = session.query(func.max(OHLCVDaily.fetched_at)).scalar()
            macro_latest = session.query(func.max(MacroSeries.fetched_at)).scalar()
            sec_latest = session.query(func.max(SecFiling.fetched_at)).scalar()

            return {
                "ohlcv_daily": {"rows": ohlcv_count, "last_updated": str(ohlcv_latest) if ohlcv_latest else None},
                "macro_series": {"rows": macro_count, "last_updated": str(macro_latest) if macro_latest else None},
                "sec_filings": {"rows": sec_count, "last_updated": str(sec_latest) if sec_latest else None},
                "fundamentals": {"rows": fund_count, "last_updated": None},
            }
        finally:
            session.close()
