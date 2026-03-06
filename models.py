"""
SQLAlchemy ORM Models
=====================
Project, Strategy, Run — persistence layer for the quant engine.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, DateTime, JSON, Text, ForeignKey
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
