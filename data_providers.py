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
        except Exception as e:
            logger.warning("fetch_options_expirations failed for %s: %s", symbol, e)
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


class PolygonProvider(DataProvider):
    """
    Market data provider backed by Polygon.io REST API.
    Requires POLYGON_API_KEY environment variable.

    Plans:
    - Starter ($29/mo): 15-min delayed, 5yr history, fundamentals, options
    - Business ($199/mo): real-time, unlimited calls, WebSocket
    """

    name = "polygon"

    def __init__(self, api_key: str = None):
        import os
        self.api_key = api_key or os.getenv("POLYGON_API_KEY", "")
        if not self.api_key:
            raise ValueError("POLYGON_API_KEY environment variable required")
        from polygon import RESTClient
        self.client = RESTClient(api_key=self.api_key)

    def fetch_ohlcv(
        self,
        symbols: list[str],
        start: datetime,
        end: datetime,
        interval: str = "1d",
    ) -> pl.DataFrame:
        """Fetch OHLCV bars for multiple symbols from Polygon aggregates."""
        timespan_map = {"1d": "day", "1wk": "week", "1mo": "month", "1h": "hour", "4h": "hour", "1m": "minute"}
        mult_map = {"1d": 1, "1wk": 1, "1mo": 1, "1h": 1, "4h": 4, "1m": 1}
        timespan = timespan_map.get(interval, "day")
        multiplier = mult_map.get(interval, 1)

        rows = []
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        for sym in symbols:
            try:
                aggs = self.client.get_aggs(
                    ticker=sym, multiplier=multiplier, timespan=timespan,
                    from_=start_str, to=end_str, adjusted=True, limit=50000,
                )
                if aggs:
                    for bar in aggs:
                        rows.append({
                            "timestamp": datetime.fromtimestamp(bar.timestamp / 1000),
                            "symbol": sym,
                            "open": float(bar.open),
                            "high": float(bar.high),
                            "low": float(bar.low),
                            "close": float(bar.close),
                            "volume": float(bar.volume),
                        })
            except Exception as e:
                logger.error("Polygon OHLCV failed for %s: %s", sym, e)

        if not rows:
            return pl.DataFrame(schema={
                "timestamp": pl.Datetime("us"), "symbol": pl.Utf8,
                "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
                "close": pl.Float64, "volume": pl.Float64,
            })

        df = pl.DataFrame(rows)
        if df["timestamp"].dtype != pl.Datetime("us"):
            df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
        return df.sort(["symbol", "timestamp"])

    def fetch_history(self, symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
        """Fetch history using period string — maps to Polygon date range."""
        period_days = {"5d": 5, "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "3y": 1095, "5y": 1825}
        days = period_days.get(period, 365)
        end = datetime.now()
        start = end - pd.Timedelta(days=days)

        timespan_map = {"1d": "day", "1wk": "week", "1mo": "month", "1h": "hour"}
        timespan = timespan_map.get(interval, "day")

        try:
            aggs = self.client.get_aggs(
                ticker=symbol, multiplier=1, timespan=timespan,
                from_=start.strftime("%Y-%m-%d"), to=end.strftime("%Y-%m-%d"),
                adjusted=True, limit=50000,
            )
            if not aggs:
                return pd.DataFrame()

            data = []
            for bar in aggs:
                data.append({
                    "Date": datetime.fromtimestamp(bar.timestamp / 1000),
                    "Open": bar.open, "High": bar.high, "Low": bar.low,
                    "Close": bar.close, "Volume": bar.volume,
                })
            df = pd.DataFrame(data).set_index("Date")
            df.columns = [c.lower() for c in df.columns]
            return df
        except Exception as e:
            logger.error("Polygon history failed for %s: %s", symbol, e)
            return pd.DataFrame()

    def fetch_quote(self, symbol: str) -> dict:
        """Fetch latest quote from Polygon snapshot."""
        try:
            snap = self.client.get_snapshot_ticker("stocks", symbol)
            if snap:
                return {
                    "lastPrice": float(snap.day.close or snap.prev_day.close or 0),
                    "previousClose": float(snap.prev_day.close or 0),
                    "open": float(snap.day.open or 0),
                    "dayHigh": float(snap.day.high or 0),
                    "dayLow": float(snap.day.low or 0),
                    "volume": int(snap.day.volume or 0),
                    "marketCap": 0,  # not in snapshot — use ticker_details
                    "change": float(snap.todays_change or 0),
                    "changePct": float(snap.todays_change_percent or 0),
                }
        except Exception as e:
            logger.error("Polygon quote failed for %s: %s", symbol, e)
        return {"lastPrice": 0}

    def fetch_fundamentals(self, symbol: str) -> dict:
        """Fetch ticker details + financial ratios from Polygon."""
        info = {}
        try:
            # Ticker details (company info, market cap, SIC code, etc.)
            details = self.client.get_ticker_details(symbol)
            if details:
                info.update({
                    "shortName": details.name,
                    "longName": details.name,
                    "symbol": symbol,
                    "sector": details.sic_description or "",
                    "industry": details.sic_description or "",
                    "marketCap": details.market_cap,
                    "sharesOutstanding": details.share_class_shares_outstanding or details.weighted_shares_outstanding,
                    "description": (details.description or "")[:400],
                    "country": details.locale or "US",
                    "exchange": details.primary_exchange,
                    "type": details.type,
                    "listDate": details.list_date,
                })
        except Exception as e:
            logger.debug("Polygon ticker details failed for %s: %s", symbol, e)

        # Financial ratios (P/E, P/B, ROE, margins, etc.)
        try:
            ratios = list(self.client.list_financials_ratios(ticker=symbol, limit=1))
            if ratios:
                r = ratios[0]
                info.update({
                    "trailingPE": getattr(r, "price_to_earnings", None),
                    "priceToBook": getattr(r, "price_to_book", None),
                    "priceToSalesTrailing12Months": getattr(r, "price_to_sales", None),
                    "enterpriseToEbitda": getattr(r, "ev_to_ebitda", None),
                    "dividendYield": getattr(r, "dividend_yield", None),
                    "returnOnEquity": getattr(r, "return_on_equity", None),
                    "returnOnAssets": getattr(r, "return_on_assets", None),
                    "debtToEquity": getattr(r, "debt_to_equity", None),
                    "currentRatio": getattr(r, "current", None),
                    "trailingEps": getattr(r, "earnings_per_share", None),
                    "freeCashflow": getattr(r, "free_cash_flow", None),
                    "beta": getattr(r, "beta", None),
                })
        except Exception as e:
            logger.debug("Polygon ratios failed for %s: %s", symbol, e)

        # Income statement for revenue/margins
        try:
            income = list(self.client.list_financials_income_statements(
                tickers=symbol, timeframe="annual", limit=1,
            ))
            if income:
                stmt = income[0]
                rev = getattr(stmt, "revenues", None)
                ni = getattr(stmt, "net_income_loss", None)
                gp = getattr(stmt, "gross_profit", None)
                oi = getattr(stmt, "operating_income_loss", None)
                if rev and hasattr(rev, "value"):
                    rev_val = rev.value
                    info["totalRevenue"] = rev_val
                    if gp and hasattr(gp, "value") and rev_val:
                        info["grossMargins"] = gp.value / rev_val
                    if oi and hasattr(oi, "value") and rev_val:
                        info["operatingMargins"] = oi.value / rev_val
                    if ni and hasattr(ni, "value") and rev_val:
                        info["profitMargins"] = ni.value / rev_val
        except Exception as e:
            logger.debug("Polygon income statement failed for %s: %s", symbol, e)

        # Balance sheet for book value, total assets/debt
        try:
            balance = list(self.client.list_financials_balance_sheets(
                tickers=symbol, timeframe="annual", limit=1,
            ))
            if balance:
                bs = balance[0]
                ta = getattr(bs, "assets", None)
                tl = getattr(bs, "liabilities", None)
                eq = getattr(bs, "equity", None)
                if ta and hasattr(ta, "value"):
                    info["totalAssets"] = ta.value
                if tl and hasattr(tl, "value"):
                    info["totalDebt"] = tl.value
                if eq and hasattr(eq, "value"):
                    shares = info.get("sharesOutstanding") or 1
                    info["bookValue"] = eq.value / shares if shares else None
        except Exception as e:
            logger.debug("Polygon balance sheet failed for %s: %s", symbol, e)

        # Short interest
        try:
            shorts = list(self.client.list_short_interest(ticker=symbol, limit=1))
            if shorts:
                s = shorts[0]
                info["shortRatio"] = getattr(s, "days_to_cover", None)
                info["sharesShort"] = getattr(s, "short_volume", None)
        except Exception as e:
            logger.debug("Polygon short interest failed for %s: %s", symbol, e)

        return info

    def fetch_ticker_info(self, symbol: str) -> dict:
        return self.fetch_fundamentals(symbol)

    def fetch_options_expirations(self, symbol: str) -> list[str]:
        """Fetch available options expirations from Polygon."""
        try:
            contracts = list(self.client.list_options_contracts(
                underlying_ticker=symbol, limit=1000,
            ))
            expirations = sorted(set(c.expiration_date for c in contracts if c.expiration_date))
            return expirations
        except Exception as e:
            logger.error("Polygon options expirations failed for %s: %s", symbol, e)
            return []

    def fetch_options_chain(self, symbol: str, expiration: Optional[str] = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Fetch options chain with Greeks from Polygon snapshot."""
        try:
            chain = list(self.client.list_snapshot_options_chain(symbol))
            calls_data, puts_data = [], []

            for contract in chain:
                if expiration and contract.details.expiration_date != expiration:
                    continue
                row = {
                    "contractSymbol": contract.details.ticker,
                    "strike": contract.details.strike_price,
                    "expiration": contract.details.expiration_date,
                    "lastPrice": contract.day.close if contract.day else 0,
                    "bid": contract.last_quote.bid if contract.last_quote else 0,
                    "ask": contract.last_quote.ask if contract.last_quote else 0,
                    "volume": contract.day.volume if contract.day else 0,
                    "openInterest": contract.open_interest or 0,
                    "impliedVolatility": contract.implied_volatility or 0,
                }
                # Greeks
                if contract.greeks:
                    row.update({
                        "delta": contract.greeks.delta,
                        "gamma": contract.greeks.gamma,
                        "theta": contract.greeks.theta,
                        "vega": contract.greeks.vega,
                    })

                if contract.details.contract_type == "call":
                    calls_data.append(row)
                else:
                    puts_data.append(row)

            calls_df = pd.DataFrame(calls_data) if calls_data else pd.DataFrame()
            puts_df = pd.DataFrame(puts_data) if puts_data else pd.DataFrame()
            return calls_df, puts_df
        except Exception as e:
            logger.error("Polygon options chain failed for %s: %s", symbol, e)
            return pd.DataFrame(), pd.DataFrame()

    def batch_download(self, symbols: list[str], start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        """Batch download using Polygon grouped daily aggs."""
        try:
            # For daily data, use grouped daily aggs (all tickers in one call)
            if interval == "1d":
                all_data = {}
                # Polygon grouped daily returns ALL tickers for a single date
                # For multi-day range, iterate dates
                from datetime import timedelta
                current = datetime.strptime(start, "%Y-%m-%d")
                end_dt = datetime.strptime(end, "%Y-%m-%d")
                sym_set = set(symbols)

                while current <= end_dt:
                    try:
                        grouped = self.client.get_grouped_daily_aggs(
                            date=current.strftime("%Y-%m-%d"), adjusted=True,
                        )
                        if grouped:
                            for bar in grouped:
                                if bar.ticker in sym_set:
                                    if bar.ticker not in all_data:
                                        all_data[bar.ticker] = []
                                    all_data[bar.ticker].append({
                                        "Date": current,
                                        "Open": bar.open, "High": bar.high,
                                        "Low": bar.low, "Close": bar.close,
                                        "Volume": bar.volume,
                                    })
                    except Exception:
                        pass
                    current += timedelta(days=1)

                if not all_data:
                    return pd.DataFrame()

                frames = []
                for sym, data in all_data.items():
                    df = pd.DataFrame(data).set_index("Date")
                    df.columns = pd.MultiIndex.from_tuples([(c, sym) for c in df.columns])
                    frames.append(df)
                return pd.concat(frames, axis=1) if frames else pd.DataFrame()
            else:
                # For non-daily, use individual aggs
                df = self.fetch_ohlcv(symbols, datetime.strptime(start, "%Y-%m-%d"),
                                       datetime.strptime(end, "%Y-%m-%d"), interval)
                return df.to_pandas() if not df.is_empty() else pd.DataFrame()
        except Exception as e:
            logger.error("Polygon batch download failed: %s", e)
            return pd.DataFrame()

    # ── Polygon-specific methods (not in base ABC) ───────────────────────

    def fetch_news(self, symbol: str, limit: int = 20) -> list[dict]:
        """Fetch news articles from Polygon."""
        try:
            articles = list(self.client.list_ticker_news(ticker=symbol, limit=limit))
            return [{
                "title": a.title,
                "url": a.article_url,
                "source": a.publisher.name if a.publisher else "",
                "published": a.published_utc,
                "summary": (a.description or "")[:300],
            } for a in articles]
        except Exception as e:
            logger.error("Polygon news failed for %s: %s", symbol, e)
            return []

    def fetch_analyst_ratings(self, symbol: str, limit: int = 10) -> list[dict]:
        """Fetch analyst ratings from Polygon/Benzinga."""
        try:
            ratings = list(self.client.list_benzinga_ratings(ticker=symbol, limit=limit))
            return [{
                "date": getattr(r, "date", None),
                "firm": getattr(r, "analyst_firm", ""),
                "action": getattr(r, "rating_action", ""),
                "rating": getattr(r, "current_rating", ""),
                "prior_rating": getattr(r, "prior_rating", ""),
                "target": getattr(r, "current_price_target", None),
                "prior_target": getattr(r, "prior_price_target", None),
            } for r in ratings]
        except Exception as e:
            logger.debug("Polygon analyst ratings failed for %s: %s", symbol, e)
            return []

    def fetch_earnings(self, symbol: str, limit: int = 8) -> list[dict]:
        """Fetch earnings calendar/history from Polygon/Benzinga."""
        try:
            earnings = list(self.client.list_benzinga_earnings(ticker=symbol, limit=limit))
            return [{
                "date": getattr(e, "date", None),
                "eps_estimate": getattr(e, "eps_estimate", None),
                "eps_actual": getattr(e, "eps_actual", None),
                "eps_surprise_pct": getattr(e, "eps_surprise_percent", None),
                "revenue_estimate": getattr(e, "revenue_estimate", None),
                "revenue_actual": getattr(e, "revenue_actual", None),
            } for e in earnings]
        except Exception as e:
            logger.debug("Polygon earnings failed for %s: %s", symbol, e)
            return []

    def fetch_dividends(self, symbol: str, limit: int = 10) -> list[dict]:
        """Fetch dividend history from Polygon."""
        try:
            divs = list(self.client.list_dividends(ticker=symbol, limit=limit))
            return [{
                "ex_date": d.ex_dividend_date,
                "pay_date": d.pay_date,
                "amount": d.cash_amount,
                "frequency": d.frequency,
                "type": d.dividend_type,
            } for d in divs]
        except Exception as e:
            logger.debug("Polygon dividends failed for %s: %s", symbol, e)
            return []

    def fetch_all_tickers(self, market: str = "stocks", active: bool = True, limit: int = 10000) -> list[dict]:
        """Fetch complete ticker universe from Polygon."""
        try:
            tickers = list(self.client.list_tickers(market=market, active=active, limit=limit))
            return [{
                "symbol": t.ticker,
                "name": t.name,
                "market_cap": t.market_cap,
                "type": t.type,
                "exchange": t.primary_exchange,
                "active": t.active,
            } for t in tickers]
        except Exception as e:
            logger.error("Polygon ticker list failed: %s", e)
            return []


def get_provider(name: str = None) -> DataProvider:
    import os
    name = name or os.getenv("DATA_PROVIDER", "yfinance")
    providers = {"yfinance": YFinanceProvider, "polygon": PolygonProvider}
    if name not in providers:
        raise ValueError(f"Unknown provider: {name}. Available: {list(providers)}")
    return providers[name]()
