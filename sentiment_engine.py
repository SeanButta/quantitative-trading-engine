"""
Sentiment Engine
================
Scrapes free financial RSS feeds, scores headlines with a keyword
lexicon, and returns a rolling sentiment signal for any ticker.

No API keys required. Uses urllib + xml.etree (stdlib only).
Not financial advice.
"""

from __future__ import annotations
import logging
import math
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Financial Sentiment Lexicon
# ---------------------------------------------------------------------------

BULL_WORDS: dict[str, float] = {
    # Strong positive (weight 2.0)
    "beat": 2.0, "beats": 2.0, "surge": 2.0, "surges": 2.0, "soar": 2.0,
    "soars": 2.0, "rally": 2.0, "breakout": 2.0, "upgrade": 2.0,
    "outperform": 2.0, "record": 1.8, "milestone": 1.8, "acquisition": 1.5,
    "buyback": 1.5, "dividend": 1.5,
    # Moderate positive (weight 1.0)
    "gain": 1.0, "gains": 1.0, "rise": 1.0, "rises": 1.0, "up": 0.5,
    "positive": 1.0, "growth": 1.0, "profit": 1.0, "revenue": 0.8,
    "strong": 1.0, "robust": 1.0, "expand": 1.0, "accelerate": 1.2,
    "recover": 1.2, "rebound": 1.2, "bullish": 1.5, "overweight": 1.5,
    "buy": 1.0, "optimistic": 1.2, "confident": 1.0,
}

BEAR_WORDS: dict[str, float] = {
    # Strong negative (weight 2.0)
    "miss": 2.0, "misses": 2.0, "plunge": 2.0, "crash": 2.0,
    "downgrade": 2.0, "underperform": 2.0, "sell": 1.5, "selloff": 2.0,
    "layoff": 1.8, "layoffs": 1.8, "recall": 1.8, "investigation": 2.0,
    "lawsuit": 1.8, "fine": 1.5, "fraud": 2.5, "bankruptcy": 2.5,
    # Moderate negative (weight 1.0)
    "loss": 1.5, "losses": 1.5, "decline": 1.0, "declines": 1.0,
    "drop": 1.0, "drops": 1.0, "fall": 0.8, "falls": 0.8,
    "weak": 1.0, "concern": 1.0, "risk": 0.5, "warning": 1.5,
    "disappointing": 1.5, "bearish": 1.5, "pessimistic": 1.2,
    "cut": 1.0, "reduce": 0.8, "uncertainty": 1.0, "headwind": 1.2,
}

RSS_FEEDS: list[str] = [
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US",
    "https://finance.yahoo.com/rss/topfinstories",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
]

# Extended feed list used by the /feeds endpoint — broader coverage
# organised by category for source-labelling in the UI
EXTENDED_FEEDS: dict[str, list[str]] = {
    "Markets": [
        "https://finance.yahoo.com/rss/topfinstories",
        "https://feeds.marketwatch.com/marketwatch/topstories/",
        "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
        "https://feeds.reuters.com/reuters/businessNews",
        "https://feeds.reuters.com/reuters/companyNews",
    ],
    "Technology": [
        "https://feeds.reuters.com/reuters/technologyNews",
        "https://www.cnbc.com/id/19854910/device/rss/rss.html",    # CNBC Tech
        "https://feeds.a.dj.com/rss/RSSWSJD.xml",                  # WSJ Tech
    ],
    "Economy": [
        "https://www.cnbc.com/id/20910258/device/rss/rss.html",    # CNBC Economy
        "https://feeds.reuters.com/reuters/economyNews",
        "https://feeds.a.dj.com/rss/RSSOpinion.xml",               # WSJ Opinion/Commentary
    ],
    "Earnings": [
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US",
        "https://www.cnbc.com/id/15839069/device/rss/rss.html",    # CNBC Earnings
    ],
    "Commodities": [
        "https://feeds.reuters.com/reuters/commoditiesNews",
        "https://www.cnbc.com/id/10000664/device/rss/rss.html",    # CNBC Commodities
    ],
}

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class NewsItem:
    title: str
    summary: str
    published: datetime
    source: str
    url: str
    symbol_mentioned: bool      # True if ticker appears in title or summary
    raw_score: float            # bull - bear weighted score
    normalized_score: float     # tanh-normalized to [-1, 1]


@dataclass
class SentimentResult:
    symbol: str
    timestamp: datetime
    score: float                        # -1 (very bearish) to +1 (very bullish)
    direction: str                      # "bullish" / "bearish" / "neutral"
    confidence: float                   # 0-1, based on article count + score magnitude
    article_count: int
    bull_count: int
    bear_count: int
    neutral_count: int
    momentum: float                     # score change: recent vs older window
    headline_snippets: list[str] = field(default_factory=list)  # top 5 headlines
    blurb: str = ""                     # human-readable summary
    signal_strength: int = 1            # 1-5


# ---------------------------------------------------------------------------
# Sentiment Engine
# ---------------------------------------------------------------------------

class SentimentEngine:
    """
    Fetches financial RSS feeds, scores each headline with a keyword
    lexicon, and exposes a rolling sentiment signal per ticker.
    """

    def __init__(self, cache_ttl_minutes: int = 30, max_age_hours: int = 48) -> None:
        self.cache_ttl = timedelta(minutes=cache_ttl_minutes)
        self.max_age = timedelta(hours=max_age_hours)
        # Keyed by feed URL → (fetch_time, list[NewsItem])
        self._cache: dict[str, tuple[datetime, list[NewsItem]]] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _score_text(self, title: str, summary: str) -> float:
        """
        Score a news item using the bull/bear lexicon.

        Lowercases all text, tokenises on non-alpha boundaries, sums
        weighted matches, and returns tanh-normalised score in [-1, 1].
        """
        combined = (title + " " + summary).lower()
        tokens = re.findall(r"[a-z]+", combined)

        bull_score: float = 0.0
        bear_score: float = 0.0

        for token in tokens:
            if token in BULL_WORDS:
                bull_score += BULL_WORDS[token]
            if token in BEAR_WORDS:
                bear_score += BEAR_WORDS[token]

        raw = bull_score - bear_score
        normalized = math.tanh(raw / 3.0)
        return normalized

    def _parse_datetime(self, date_str: str) -> Optional[datetime]:
        """
        Attempt to parse a pubDate string into a timezone-aware datetime.
        Handles RFC-2822 (RSS standard) and ISO 8601 variants.
        Returns None on failure.
        """
        if not date_str:
            return None

        # Try RFC-2822 (standard RSS pubDate)
        try:
            dt = parsedate_to_datetime(date_str.strip())
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            pass

        # Try ISO 8601 variants
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                continue

        logger.debug("Could not parse date string: %r", date_str)
        return None

    def _fetch_feed(self, url: str) -> list[NewsItem]:
        """
        Fetch and parse a single RSS 2.0 feed.

        Uses a 10-second timeout and a browser-like User-Agent.
        Returns an empty list on any failure — never raises.
        """
        now = datetime.now(tz=timezone.utc)

        # Cache hit guard
        if url in self._cache:
            cached_at, items = self._cache[url]
            if now - cached_at < self.cache_ttl:
                return items

        items: list[NewsItem] = []

        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; QuantBot/1.0)"},
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                raw_bytes = response.read()

            root = ET.fromstring(raw_bytes)

            # RSS 2.0 items live at channel/item; Atom entries at feed/entry
            # We handle both by searching anywhere in the tree for <item>
            ns_strip = re.compile(r"\{[^}]*\}")

            for item_el in root.iter("item"):
                title_el = item_el.find("title")
                desc_el = item_el.find("description")
                pub_el = item_el.find("pubDate")
                link_el = item_el.find("link")

                title = (title_el.text or "").strip() if title_el is not None else ""
                summary = (desc_el.text or "").strip() if desc_el is not None else ""
                pub_raw = (pub_el.text or "").strip() if pub_el is not None else ""
                link = (link_el.text or "").strip() if link_el is not None else ""

                # Strip HTML tags from summary
                summary = re.sub(r"<[^>]+>", " ", summary).strip()

                # Parse publish date
                published = self._parse_datetime(pub_raw)
                if published is None:
                    published = now  # fallback to now so we don't discard

                # Derive source from URL hostname
                try:
                    from urllib.parse import urlparse
                    source = urlparse(url).netloc.replace("www.", "").replace("feeds.", "")
                except Exception:
                    source = "unknown"

                normalized_score = self._score_text(title, summary)
                bull_score_raw, bear_score_raw = self._raw_bull_bear(title, summary)
                raw_score = bull_score_raw - bear_score_raw

                news_item = NewsItem(
                    title=title,
                    summary=summary[:500],          # cap summary length
                    published=published,
                    source=source,
                    url=link,
                    symbol_mentioned=False,          # populated later by get_news
                    raw_score=raw_score,
                    normalized_score=normalized_score,
                )
                items.append(news_item)

        except Exception as exc:
            logger.warning("Failed to fetch feed %s: %s", url, exc)
            return []

        self._cache[url] = (now, items)
        logger.debug("Fetched %d items from %s", len(items), url)
        return items

    def _raw_bull_bear(self, title: str, summary: str) -> tuple[float, float]:
        """Return (bull_score, bear_score) for computing raw_score on NewsItem."""
        combined = (title + " " + summary).lower()
        tokens = re.findall(r"[a-z]+", combined)

        bull_score: float = 0.0
        bear_score: float = 0.0
        for token in tokens:
            if token in BULL_WORDS:
                bull_score += BULL_WORDS[token]
            if token in BEAR_WORDS:
                bear_score += BEAR_WORDS[token]
        return bull_score, bear_score

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_news(self, symbol: str, limit: int = 50) -> list[NewsItem]:
        """
        Fetch news relevant to *symbol* from:
          - Yahoo Finance symbol-specific feed
          - Two general financial feeds

        Items older than max_age_hours are discarded.
        Each item is tagged with symbol_mentioned if the ticker
        appears verbatim in the title or summary (case-insensitive).

        Returns items sorted by published descending, up to *limit*.
        """
        now = datetime.now(tz=timezone.utc)
        cutoff = now - self.max_age

        # Build URL list: symbol-specific first, then two general feeds
        symbol_url = RSS_FEEDS[0].format(symbol=symbol)
        general_urls = [
            RSS_FEEDS[1],   # Yahoo Finance top financial stories
            RSS_FEEDS[2],   # MarketWatch top stories
        ]

        all_items: list[NewsItem] = []

        for url in [symbol_url] + general_urls:
            fetched = self._fetch_feed(url)
            all_items.extend(fetched)

        # Deduplicate by (title, source) to avoid cross-feed duplicates
        seen: set[tuple[str, str]] = set()
        unique_items: list[NewsItem] = []
        for item in all_items:
            key = (item.title.lower()[:80], item.source)
            if key not in seen:
                seen.add(key)
                unique_items.append(item)

        # Apply age filter
        recent_items = [i for i in unique_items if i.published >= cutoff]

        # Tag symbol_mentioned
        sym_upper = symbol.upper()
        for item in recent_items:
            item.symbol_mentioned = (
                sym_upper in item.title.upper()
                or sym_upper in item.summary.upper()
            )

        # Sort by published descending
        recent_items.sort(key=lambda x: x.published, reverse=True)

        return recent_items[:limit]

    def compute_signal(self, symbol: str, window_hours: int = 24) -> SentimentResult:
        """
        Compute a sentiment signal for *symbol* over the last *window_hours*.

        Symbol-mentioned articles receive 3x weight in the weighted mean.
        Momentum is the score difference between the most-recent 6 hours
        and the prior 6 hours within the window.

        Returns a neutral SentimentResult if no articles are found.
        """
        now = datetime.now(tz=timezone.utc)
        window_cutoff = now - timedelta(hours=window_hours)

        try:
            all_news = self.get_news(symbol)
        except Exception as exc:
            logger.warning("compute_signal: get_news failed for %s: %s", symbol, exc)
            return self._neutral_result(symbol, now)

        # Filter to window
        windowed = [i for i in all_news if i.published >= window_cutoff]

        if not windowed:
            return self._neutral_result(symbol, now)

        # Weighted mean score
        weighted_sum: float = 0.0
        weight_total: float = 0.0
        bull_count = bear_count = neutral_count = 0

        for item in windowed:
            weight = 3.0 if item.symbol_mentioned else 1.0
            weighted_sum += item.normalized_score * weight
            weight_total += weight

            if item.normalized_score > 0.1:
                bull_count += 1
            elif item.normalized_score < -0.1:
                bear_count += 1
            else:
                neutral_count += 1

        overall_score: float = weighted_sum / weight_total if weight_total > 0 else 0.0

        # Momentum: compare most-recent 6h vs prior 6h
        momentum = self._compute_momentum(windowed, now, half_window_hours=6)

        # Direction
        direction = self._score_to_direction(overall_score)

        # Confidence
        article_count = len(windowed)
        confidence = min(1.0, (article_count / 10) * 0.5 + abs(overall_score) * 0.5)

        # Signal strength
        signal_strength = self._score_to_signal_strength(overall_score)

        # Headline snippets (top 5, symbol-mentioned items first)
        sorted_for_snippets = sorted(
            windowed,
            key=lambda x: (x.symbol_mentioned, abs(x.normalized_score)),
            reverse=True,
        )
        snippets: list[str] = []
        for item in sorted_for_snippets[:5]:
            score_tag = f"{item.normalized_score:+.2f}"
            snippets.append(f"[{score_tag}] {item.title[:120]}")

        # Blurb
        blurb = (
            f"{direction.capitalize()} sentiment (score: {overall_score:+.2f}) "
            f"based on {article_count} article{'s' if article_count != 1 else ''} "
            f"in last {window_hours}h"
        )

        return SentimentResult(
            symbol=symbol,
            timestamp=now,
            score=round(overall_score, 4),
            direction=direction,
            confidence=round(confidence, 4),
            article_count=article_count,
            bull_count=bull_count,
            bear_count=bear_count,
            neutral_count=neutral_count,
            momentum=round(momentum, 4),
            headline_snippets=snippets,
            blurb=blurb,
            signal_strength=signal_strength,
        )

    # ------------------------------------------------------------------
    # Private calculation helpers
    # ------------------------------------------------------------------

    def _compute_momentum(
        self,
        items: list[NewsItem],
        now: datetime,
        half_window_hours: int = 6,
    ) -> float:
        """
        Momentum = mean score of recent half-window minus mean score of
        older half-window.  Returns 0.0 if either bucket is empty.
        """
        recent_cutoff = now - timedelta(hours=half_window_hours)
        older_cutoff = now - timedelta(hours=half_window_hours * 2)

        recent_scores = [i.normalized_score for i in items if i.published >= recent_cutoff]
        older_scores = [
            i.normalized_score
            for i in items
            if older_cutoff <= i.published < recent_cutoff
        ]

        if not recent_scores or not older_scores:
            return 0.0

        recent_mean = float(np.mean(recent_scores))
        older_mean = float(np.mean(older_scores))
        return recent_mean - older_mean

    @staticmethod
    def _score_to_direction(score: float) -> str:
        if score > 0.2:
            return "bullish"
        if score < -0.2:
            return "bearish"
        return "neutral"

    @staticmethod
    def _score_to_signal_strength(score: float) -> int:
        abs_score = abs(score)
        if abs_score < 0.1:
            return 1
        if abs_score < 0.25:
            return 2
        if abs_score < 0.45:
            return 3
        if abs_score < 0.65:
            return 4
        return 5

    @staticmethod
    def _neutral_result(symbol: str, now: datetime) -> SentimentResult:
        """Return a fully-populated neutral SentimentResult."""
        return SentimentResult(
            symbol=symbol,
            timestamp=now,
            score=0.0,
            direction="neutral",
            confidence=0.0,
            article_count=0,
            bull_count=0,
            bear_count=0,
            neutral_count=0,
            momentum=0.0,
            headline_snippets=[],
            blurb="Neutral sentiment — no recent articles found",
            signal_strength=1,
        )


# ---------------------------------------------------------------------------
# Module-level convenience function
# ---------------------------------------------------------------------------

def get_market_sentiment() -> dict[str, SentimentResult]:
    """
    Compute sentiment for major indices and asset-class proxies.

    Returns a dict keyed by symbol.  Used as a macro sentiment overlay
    in the Trade Advisor.  All failures return a neutral result so the
    caller never has to handle exceptions.

    Symbols:
        SPY  – S&P 500 large cap
        QQQ  – Nasdaq 100 / tech
        IWM  – Russell 2000 small cap
        GLD  – Gold / safe-haven proxy
        BTC-USD – Crypto sentiment
    """
    MACRO_SYMBOLS = ["SPY", "QQQ", "IWM", "GLD", "BTC-USD"]

    engine = SentimentEngine()
    results: dict[str, SentimentResult] = {}

    for sym in MACRO_SYMBOLS:
        try:
            results[sym] = engine.compute_signal(sym)
        except Exception as exc:
            logger.warning("get_market_sentiment: failed for %s: %s", sym, exc)
            results[sym] = SentimentEngine._neutral_result(
                sym, datetime.now(tz=timezone.utc)
            )

    return results


# ---------------------------------------------------------------------------
# CLI smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    import sys

    symbols = sys.argv[1:] if len(sys.argv) > 1 else ["AAPL", "TSLA"]

    engine = SentimentEngine()

    for sym in symbols:
        print(f"\n{'=' * 60}")
        result = engine.compute_signal(sym)
        print(f"Symbol       : {result.symbol}")
        print(f"Timestamp    : {result.timestamp.strftime('%Y-%m-%d %H:%M UTC')}")
        print(f"Score        : {result.score:+.4f}")
        print(f"Direction    : {result.direction}")
        print(f"Signal Str   : {result.signal_strength}/5")
        print(f"Confidence   : {result.confidence:.2%}")
        print(f"Articles     : {result.article_count}  "
              f"(bull={result.bull_count}, bear={result.bear_count}, "
              f"neutral={result.neutral_count})")
        print(f"Momentum     : {result.momentum:+.4f}")
        print(f"Blurb        : {result.blurb}")
        if result.headline_snippets:
            print("Headlines    :")
            for h in result.headline_snippets:
                print(f"  {h}")

    print(f"\n{'=' * 60}")
    print("Macro Market Sentiment:")
    macro = get_market_sentiment()
    for sym, r in macro.items():
        print(f"  {sym:>7s}  {r.direction:<8s}  score={r.score:+.3f}  "
              f"strength={r.signal_strength}/5  articles={r.article_count}")
