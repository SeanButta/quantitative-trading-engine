"""
SQLAlchemy ORM Models
=====================
Project, Strategy, Run — persistence layer for the quant engine.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, DateTime, JSON, Text, Integer, ForeignKey
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    symbols = Column(JSON, default=list)
    timeframe = Column(String, default="1d")
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    provider = Column(String, default="yfinance")
    status = Column(String, default="created")
    created_at = Column(DateTime, default=datetime.utcnow)

    strategies = relationship("Strategy", back_populates="project", cascade="all, delete-orphan")
    runs = relationship("Run", back_populates="project", cascade="all, delete-orphan")


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    signals = Column(JSON, default=list)
    config = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="strategies")


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    strategy_id = Column(String, nullable=True)
    run_type = Column(String, default="backtest")
    status = Column(String, default="pending")
    config = Column(JSON, default=dict)
    metrics = Column(JSON, nullable=True)
    validation = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    artifacts_dir = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="runs")


class OptionsRefreshJob(Base):
    __tablename__ = "options_refresh_jobs"

    id              = Column(String, primary_key=True)
    status          = Column(String, default="running")   # running / complete / failed
    symbols_total   = Column(Integer, default=0)
    symbols_done    = Column(Integer, default=0)
    symbols_failed  = Column(JSON, default=dict)          # {symbol: error_message}
    risk_free_rate  = Column(JSON, default=0.05)
    started_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)


class SignalReadingJob(Base):
    __tablename__ = "signal_reading_jobs"

    id           = Column(String, primary_key=True)
    project_id   = Column(String, ForeignKey("projects.id"), nullable=False)
    symbol       = Column(String, nullable=False)
    status       = Column(String, default="pending")  # pending / running / complete / failed
    results      = Column(JSON, nullable=True)         # full readings + consensus dict
    error        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class PortfolioAnalysisJob(Base):
    __tablename__ = "portfolio_analysis_jobs"

    id           = Column(String, primary_key=True)
    status       = Column(String, default="pending")   # pending / running / complete / failed
    holdings     = Column(JSON, nullable=False)         # [{ticker, weight, shares, price}]
    results      = Column(JSON, nullable=True)          # full analytics dict
    error        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class SectorRefreshJob(Base):
    __tablename__ = "sector_refresh_jobs"

    id              = Column(String, primary_key=True)
    status          = Column(String, default="running")   # running / complete / failed
    sectors_total   = Column(Integer, default=0)
    sectors_done    = Column(Integer, default=0)
    sectors_failed  = Column(JSON, default=dict)          # {sector: error_message}
    started_at      = Column(DateTime, default=datetime.utcnow)
    completed_at    = Column(DateTime, nullable=True)


class DailySummary(Base):
    __tablename__ = "daily_summaries"

    date          = Column(String, primary_key=True)   # YYYY-MM-DD (UTC)
    generated_at  = Column(DateTime, default=datetime.utcnow)
    theme         = Column(Text, nullable=True)         # one-line headline theme
    paragraphs    = Column(JSON, default=list)          # [p1, p2, p3, p4] strings
    sentiment     = Column(String, default="neutral")   # bullish / bearish / neutral
    sentiment_score = Column(JSON, default=0.0)         # float avg score
    top_tags      = Column(JSON, default=list)          # top 5 tag strings
    article_count = Column(Integer, default=0)
    sources_used  = Column(JSON, default=list)          # list of source names
