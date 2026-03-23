"""
Background Task Queue
=====================
Wraps the four compute-heavy jobs (sectors refresh, options refresh,
signal reading, portfolio analysis) so they can run:

  1. TODAY   — FastAPI BackgroundTasks (same process, no extra infra)
  2. SOON    — Celery workers (when REDIS_URL + CELERY_BROKER_URL are set)

Adding Celery workers later is a zero-code-change upgrade — just set the
env vars and start `celery -A tasks worker -c 4`.

The public interface (submit_* functions) is identical in both modes,
so main.py doesn't need to know which backend is active.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Detect Celery availability
# ---------------------------------------------------------------------------

CELERY_BROKER = os.getenv("CELERY_BROKER_URL") or os.getenv("REDIS_URL", "")
_CELERY_AVAILABLE = False
celery_app: Any = None

if CELERY_BROKER:
    try:
        from celery import Celery as _Celery
        celery_app = _Celery(
            "quant_engine",
            broker=CELERY_BROKER,
            backend=CELERY_BROKER,
        )
        celery_app.conf.update(
            task_serializer="json",
            result_serializer="json",
            accept_content=["json"],
            task_track_started=True,
            task_acks_late=True,
            worker_prefetch_multiplier=1,   # fair dispatch for long tasks
            task_time_limit=900,            # 15 min hard kill
            task_soft_time_limit=840,       # 14 min soft kill (raises SoftTimeLimitExceeded)
            task_routes={
                "tasks.refresh_sectors_task":    {"queue": "heavy"},
                "tasks.refresh_options_task":    {"queue": "heavy"},
                "tasks.signal_reading_task":     {"queue": "default"},
                "tasks.portfolio_analysis_task": {"queue": "default"},
            },
        )
        _CELERY_AVAILABLE = True
        logger.info("Celery task queue initialised (broker=%s)", CELERY_BROKER.split("@")[-1])
    except Exception as exc:
        logger.warning("Celery setup failed (%s). Falling back to threading.", exc)
else:
    logger.info("CELERY_BROKER_URL not set — using threading for background jobs")


# ---------------------------------------------------------------------------
# Thread-based fallback runner
# ---------------------------------------------------------------------------

def _run_in_thread(fn: Callable, *args, **kwargs) -> None:
    """Fire-and-forget in a daemon thread (existing behaviour)."""
    t = threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# Celery task definitions (only registered when Celery is available)
# ---------------------------------------------------------------------------

def _make_celery_tasks():
    """
    Define Celery tasks inside a function so they're only created when
    celery_app is not None, avoiding import-time errors in threadonly mode.
    """

    @celery_app.task(bind=True, name="tasks.refresh_sectors_task", max_retries=2)
    def refresh_sectors_task(self, job_id: str, sector_names: Optional[list] = None):
        try:
            from main import _run_sector_refresh_job
            _run_sector_refresh_job(job_id, sector_names)
        except Exception as exc:
            logger.exception("Sector refresh task failed (job_id=%s)", job_id)
            raise self.retry(exc=exc, countdown=30)

    @celery_app.task(bind=True, name="tasks.refresh_options_task", max_retries=2)
    def refresh_options_task(self, job_id: str, symbols: list, risk_free_rate: float, max_workers: int):
        try:
            from main import _run_options_refresh
            _run_options_refresh(job_id, symbols, risk_free_rate, max_workers)
        except Exception as exc:
            logger.exception("Options refresh task failed (job_id=%s)", job_id)
            raise self.retry(exc=exc, countdown=60)

    @celery_app.task(bind=True, name="tasks.signal_reading_task", max_retries=1)
    def signal_reading_task(self, reading_id: str, project_id: str, symbol: str):
        try:
            from main import _run_signal_reading
            _run_signal_reading(reading_id, project_id, symbol)
        except Exception as exc:
            logger.exception("Signal reading task failed (reading_id=%s)", reading_id)
            raise self.retry(exc=exc, countdown=10)

    @celery_app.task(bind=True, name="tasks.portfolio_analysis_task", max_retries=1)
    def portfolio_analysis_task(self, job_id: str, holdings_data: list, risk_free_rate: float,
                                 n_mc_paths: int, mc_horizon_days: int, n_frontier_portfolios: int):
        try:
            from main import _run_portfolio_analysis
            _run_portfolio_analysis(
                job_id, holdings_data, risk_free_rate,
                n_mc_paths, mc_horizon_days, n_frontier_portfolios,
            )
        except Exception as exc:
            logger.exception("Portfolio analysis task failed (job_id=%s)", job_id)
            raise self.retry(exc=exc, countdown=15)

    return (
        refresh_sectors_task,
        refresh_options_task,
        signal_reading_task,
        portfolio_analysis_task,
    )


if _CELERY_AVAILABLE:
    (
        refresh_sectors_task,
        refresh_options_task,
        signal_reading_task,
        portfolio_analysis_task,
    ) = _make_celery_tasks()


# ---------------------------------------------------------------------------
# Public submit functions (main.py uses these instead of BackgroundTasks)
# ---------------------------------------------------------------------------

def submit_sector_refresh(job_id: str, sector_names: Optional[list] = None, bg=None) -> None:
    """Submit a sector refresh job."""
    if _CELERY_AVAILABLE:
        refresh_sectors_task.apply_async(args=[job_id, sector_names])
    elif bg is not None:
        from main import _run_sector_refresh_job
        bg.add_task(_run_sector_refresh_job, job_id, sector_names)
    else:
        from main import _run_sector_refresh_job
        _run_in_thread(_run_sector_refresh_job, job_id, sector_names)


def submit_options_refresh(
    job_id: str,
    symbols: list,
    risk_free_rate: float,
    max_workers: int,
    bg=None,
) -> None:
    """Submit an options refresh job."""
    if _CELERY_AVAILABLE:
        refresh_options_task.apply_async(args=[job_id, symbols, risk_free_rate, max_workers])
    elif bg is not None:
        from main import _run_options_refresh
        bg.add_task(_run_options_refresh, job_id, symbols, risk_free_rate, max_workers)
    else:
        from main import _run_options_refresh
        _run_in_thread(_run_options_refresh, job_id, symbols, risk_free_rate, max_workers)


def submit_signal_reading(
    reading_id: str,
    project_id: str,
    symbol: str,
    bg=None,
) -> None:
    """Submit a signal reading job."""
    if _CELERY_AVAILABLE:
        signal_reading_task.apply_async(args=[reading_id, project_id, symbol])
    elif bg is not None:
        from main import _run_signal_reading
        bg.add_task(_run_signal_reading, reading_id, project_id, symbol)
    else:
        from main import _run_signal_reading
        _run_in_thread(_run_signal_reading, reading_id, project_id, symbol)


def submit_portfolio_analysis(
    job_id: str,
    holdings_data: list,
    risk_free_rate: float,
    n_mc_paths: int,
    mc_horizon_days: int,
    n_frontier_portfolios: int,
    bg=None,
) -> None:
    """Submit a portfolio analysis job."""
    if _CELERY_AVAILABLE:
        portfolio_analysis_task.apply_async(
            args=[job_id, holdings_data, risk_free_rate, n_mc_paths, mc_horizon_days, n_frontier_portfolios]
        )
    elif bg is not None:
        from main import _run_portfolio_analysis
        bg.add_task(
            _run_portfolio_analysis,
            job_id, holdings_data, risk_free_rate,
            n_mc_paths, mc_horizon_days, n_frontier_portfolios,
        )
    else:
        from main import _run_portfolio_analysis
        _run_in_thread(
            _run_portfolio_analysis,
            job_id, holdings_data, risk_free_rate,
            n_mc_paths, mc_horizon_days, n_frontier_portfolios,
        )
