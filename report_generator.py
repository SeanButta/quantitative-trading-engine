"""
Report Generator
================
Generates markdown performance reports for backtest runs.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path


def generate_report(
    run_id: str,
    project_name: str,
    strategy_config: dict,
    backtest_metrics: dict,
    validation_result: dict,
    signals_used: list[str],
    symbols: list[str],
    timeframe: str,
    artifacts_dir,
) -> str:
    """
    Generate a markdown report and write to artifacts_dir/run_id/report.md.
    Returns the path to the report file.
    """
    artifacts_path = Path(artifacts_dir) / run_id
    artifacts_path.mkdir(parents=True, exist_ok=True)
    report_path = artifacts_path / "report.md"

    m = backtest_metrics or {}
    v = validation_result or {}

    label = v.get("label", "N/A")
    label_emoji = {"valid": "✓", "fragile": "⚠", "likely_noise": "✗"}.get(label, "?")

    lines = [
        f"# Backtest Report — {project_name}",
        f"",
        f"> **Run ID:** `{run_id}`  ",
        f"> **Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}  ",
        f"> **Not financial advice. Markets involve risk.**",
        f"",
        f"---",
        f"",
        f"## Strategy Configuration",
        f"",
        f"| Parameter | Value |",
        f"|-----------|-------|",
        f"| Symbols | {', '.join(symbols)} |",
        f"| Timeframe | {timeframe} |",
        f"| Signals | {', '.join(signals_used)} |",
        f"| Fee | {strategy_config.get('fee_bps', 'N/A')} bps |",
        f"| Slippage | {strategy_config.get('slippage_bps', 'N/A')} bps |",
        f"| Execution | {strategy_config.get('execution', 'next_open')} |",
        f"",
        f"---",
        f"",
        f"## Performance Metrics",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| CAGR | {m.get('cagr', 0)*100:.2f}% |",
        f"| Total Return | {m.get('total_return', 0)*100:.2f}% |",
        f"| Annualized Volatility | {m.get('volatility', 0)*100:.2f}% |",
        f"| Sharpe Ratio | {m.get('sharpe_ratio', 0):.4f} |",
        f"| Sortino Ratio | {m.get('sortino_ratio', 0):.4f} |",
        f"| Max Drawdown | {m.get('max_drawdown', 0)*100:.2f}% |",
        f"| Calmar Ratio | {m.get('calmar_ratio', 0):.4f} |",
        f"| Annual Turnover | {m.get('annual_turnover', 0):.2f}x |",
        f"| Number of Trades | {m.get('n_trades', 0)} |",
        f"| Total Fees | ${m.get('total_fees', 0):,.2f} |",
        f"| Total Slippage | ${m.get('total_slippage', 0):,.2f} |",
        f"",
        f"### Alpha Analysis",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Annualized Alpha | {m.get('alpha_annualized', 0)*100:.2f}% |",
        f"| Alpha t-stat | {m.get('alpha_t_stat', 0):.4f} |",
        f"| Alpha p-value | {m.get('alpha_p_value', 1):.4f} |",
        f"| N Days | {m.get('n_days', 0)} |",
        f"",
        f"---",
        f"",
        f"## Statistical Validation",
        f"",
        f"**Result: {label_emoji} {label.upper()}**",
        f"",
        f"| Test | Value |",
        f"|------|-------|",
        f"| t-statistic | {v.get('t_stat', 'N/A')} |",
        f"| p-value (raw) | {v.get('p_value_raw', 'N/A')} |",
        f"| p-value (corrected) | {v.get('p_value_corrected', 'N/A')} |",
        f"| Correction method | {v.get('correction_method', 'N/A')} |",
        f"| Sharpe (validation) | {v.get('sharpe_ratio', 'N/A')} |",
        f"| Permutation p-value | {v.get('permutation_p_value', 'N/A')} |",
        f"| N observations | {v.get('n_observations', 'N/A')} |",
        f"",
        f"**Conclusion:** {v.get('conclusion', 'N/A')}",
        f"",
    ]

    warnings = v.get("warnings", [])
    if warnings:
        lines += [
            f"### Warnings",
            f"",
        ]
        for w in warnings:
            lines.append(f"- ⚠ {w}")
        lines.append("")

    lines += [
        f"---",
        f"",
        f"## Signals",
        f"",
    ]
    for sig in signals_used:
        lines.append(f"- **{sig}**")
    lines.append("")

    lines += [
        f"---",
        f"",
        f"## Disclaimer",
        f"",
        f"> Not financial advice. This report is for research and educational purposes only.",
        f"> Past performance does not guarantee future results. Markets involve risk.",
        f"> Statistical significance does not imply economic significance.",
        f"> Always perform your own due diligence before making investment decisions.",
        f"",
    ]

    report_text = "\n".join(lines)
    report_path.write_text(report_text)
    return str(report_path)
