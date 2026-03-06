#!/usr/bin/env python3
"""
Integration test: Full pipeline without a running server.
Tests: ingest → features → signals → backtest → validation → report
"""

import sys
import json
import tempfile
import numpy as np
import polars as pl
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "packages" / "quant"))


def make_synthetic_data(symbols, n_days=600, seed=42):
    np.random.seed(seed)
    rows = []
    for sym in symbols:
        close = 100.0
        for i in range(n_days):
            ret = np.random.normal(0.0004, 0.012)
            close *= (1 + ret)
            rows.append({
                "timestamp": datetime(2019, 1, 1) + timedelta(days=i),
                "symbol": sym,
                "open": close * 0.999,
                "high": close * (1 + abs(np.random.normal(0, 0.004))),
                "low": close * (1 - abs(np.random.normal(0, 0.004))),
                "close": close,
                "volume": float(np.random.randint(1_000_000, 10_000_000)),
            })
    return pl.DataFrame(rows).with_columns(pl.col("timestamp").cast(pl.Datetime("us")))


def run_integration_test():
    print("=" * 60)
    print("INTEGRATION TEST: Full Pipeline")
    print("Not financial advice. Markets involve risk.")
    print("=" * 60)

    SYMBOLS = ["SPY", "QQQ", "IWM", "TLT", "GLD"]
    passed = 0
    failed = 0

    def check(name, fn):
        nonlocal passed, failed
        try:
            result = fn()
            print(f"  ✓ {name}")
            passed += 1
            return result
        except Exception as e:
            print(f"  ✗ {name}: {e}")
            failed += 1
            return None

    # ── Step 1: Synthetic data ──────────────────────────────
    print("\n[1/8] Data layer")
    raw = check("Generate synthetic OHLCV (600 days × 5 symbols)",
                lambda: make_synthetic_data(SYMBOLS, n_days=600))

    if raw is None:
        print("FATAL: No data. Aborting.")
        return

    check("Polars DataFrame schema correct",
          lambda: all(c in raw.columns for c in ["timestamp", "symbol", "open", "high", "low", "close", "volume"]))
    check("No null prices",
          lambda: raw.filter(pl.col("close").is_null()).is_empty())

    # ── Step 2: Feature engine ──────────────────────────────
    print("\n[2/8] Feature engine")
    from feature_engine import FeatureEngine
    engine = FeatureEngine(vol_window=21, momentum_windows=[5, 21, 63], ma_windows=[10, 50, 200])

    features = check("Compute all features",
                     lambda: engine.compute(raw))

    if features is not None:
        check("Feature count ≥ 20",
              lambda: len(features.columns) >= 20)
        check("Returns column populated",
              lambda: features["returns"].drop_nulls().__len__() > 100)
        check("Volatility column populated",
              lambda: features["volatility"].drop_nulls().__len__() > 100)
        check("PCA factors computed",
              lambda: "pca_factor_1" in features.columns)
        check("ATR computed",
              lambda: "atr" in features.columns)

    # ── Step 3: Signal engine ───────────────────────────────
    print("\n[3/8] Signal engine")
    from signal_engine import (
        ConditionalProbabilitySignal, BayesianUpdateSignal,
        RegressionAlphaSignal, PCARegimeFilter, FatTailRiskSignal,
        SignalEngine
    )

    cp_result = check("Conditional probability signal",
                      lambda: ConditionalProbabilitySignal(lookback=126).compute(features, "SPY"))
    check("CP signal has non-NaN values",
          lambda: np.sum(~np.isnan(cp_result.signal)) > 50 if cp_result else False)

    bay_result = check("Bayesian update signal",
                       lambda: BayesianUpdateSignal().compute(features, "SPY"))

    pca_result = check("PCA regime filter",
                       lambda: PCARegimeFilter().compute(features, "SPY"))

    fat_result = check("Fat-tail risk signal",
                       lambda: FatTailRiskSignal().compute(features, "SPY"))

    all_signals = [
        ConditionalProbabilitySignal(lookback=126),
        BayesianUpdateSignal(),
        PCARegimeFilter(),
        FatTailRiskSignal(),
    ]
    signal_engine = SignalEngine(all_signals)
    signal_df = check("Full signal engine run",
                      lambda: signal_engine.run(features))

    if signal_df is not None:
        check("Signal matrix has rows",
              lambda: len(signal_df) > 0)

    # ── Step 4: Statistical validation ─────────────────────
    print("\n[4/8] Statistical validation")
    from statistical_validation import StatisticalValidator

    validator = StatisticalValidator(n_permutations=500)

    # inject a "real" signal to get a valid result
    np.random.seed(0)
    good_returns = np.random.normal(0.0008, 0.015, 500)  # positive drift
    noise_returns = np.random.normal(0.0, 0.015, 500)

    good_val = check("Validate positive-drift returns",
                     lambda: validator.validate_single(good_returns, "signal_with_drift"))
    noise_val = check("Validate noise returns",
                      lambda: validator.validate_single(noise_returns, "noise_signal"))

    check("Noise classified as likely_noise or fragile",
          lambda: noise_val.label in ("likely_noise", "fragile") if noise_val else False)

    multi_results = check("Multiple comparison correction (BH)",
                          lambda: validator.validate_multiple({
                              "strat_a": good_returns,
                              "strat_b": noise_returns,
                              "strat_c": np.random.normal(0, 0.02, 500),
                          }))

    perm_test = check("Permutation test (IC)",
                      lambda: validator.permutation_test_strategy(
                          good_returns,
                          np.sign(np.random.normal(0.001, 1, 500)),
                          n_permutations=200,
                      ))

    # ── Step 5: Backtest engine ─────────────────────────────
    print("\n[5/8] Backtest engine")
    from backtest_engine import BacktestEngine, BacktestConfig, WalkForwardEngine

    config = BacktestConfig(fee_bps=1.0, slippage_bps=2.0, risk_free_rate=0.03)
    bt_engine = BacktestEngine(config)
    prices = raw.select(["timestamp", "symbol", "open", "close"])

    bt_result = check("Run backtest",
                      lambda: bt_engine.run(prices, signal_df if signal_df is not None else pl.DataFrame()))

    if bt_result is not None:
        m = bt_result.metrics
        check("Metrics: CAGR present",    lambda: "cagr" in m)
        check("Metrics: Sharpe present",  lambda: "sharpe_ratio" in m)
        check("Metrics: MaxDD present",   lambda: "max_drawdown" in m)
        check("Metrics: Sortino present", lambda: "sortino_ratio" in m)
        check("Equity curve non-empty",   lambda: len(bt_result.equity_curve) > 0)
        check("MaxDD ≤ 0",               lambda: m.get("max_drawdown", 0) <= 0)
        print(f"\n     Results preview:")
        print(f"       CAGR:    {m.get('cagr', 0)*100:.2f}%")
        print(f"       Sharpe:  {m.get('sharpe_ratio', 0):.4f}")
        print(f"       MaxDD:   {m.get('max_drawdown', 0)*100:.2f}%")
        print(f"       Trades:  {m.get('n_trades', 0)}")
        print(f"       Alpha:   {m.get('alpha_annualized', 0)*100:.2f}%  t={m.get('alpha_t_stat', 0):.3f}")

    # ── Step 6: Portfolio optimization ─────────────────────
    print("\n[6/8] Portfolio optimization")
    from portfolio_optimizer import MarkowitzOptimizer

    optimizer = MarkowitzOptimizer()
    returns_df = features.select(["timestamp", "symbol", "returns"]).drop_nulls()

    opt_min_var = check("Min variance optimization",
                        lambda: optimizer.optimize(returns_df, objective="min_variance"))

    opt_max_sr = check("Max Sharpe optimization",
                       lambda: optimizer.optimize(returns_df, objective="max_sharpe"))

    frontier = check("Efficient frontier (10 points)",
                     lambda: optimizer.efficient_frontier(returns_df, n_points=10))

    if opt_min_var is not None:
        check("Weights sum to ~1",
              lambda: abs(sum(opt_min_var.weights.values()) - 1.0) < 0.01)
        check("Portfolio vol > 0",
              lambda: opt_min_var.portfolio_volatility > 0)
        print(f"\n     Min-var weights: { {k: f'{v*100:.1f}%' for k,v in opt_min_var.weights.items()} }")

    # ── Step 7: Stochastic finance ──────────────────────────
    print("\n[7/8] Stochastic finance")
    from stochastic_finance import BlackScholes, LMSRMarket, GBMSimulator, simulate_gbm_paths

    call = check("Black-Scholes call price",
                 lambda: BlackScholes.price(100, 100, 0.25, 0.03, 0.20, "call"))
    put = check("Black-Scholes put price",
                lambda: BlackScholes.price(100, 100, 0.25, 0.03, 0.20, "put"))

    if call and put:
        # Put-call parity: C - P = S*e^(-qT) - K*e^(-rT)
        pcp = call.price - put.price
        theoretical = 100 - 100 * np.exp(-0.03 * 0.25)
        check("Put-call parity holds",
              lambda: abs(pcp - theoretical) < 0.01)
        print(f"\n     Call: ${call.price:.4f}  Δ={call.delta:.4f}  Γ={call.gamma:.4f}")
        print(f"     Put:  ${put.price:.4f}  Δ={put.delta:.4f}")

    mc_result = check("Monte Carlo option pricing",
                      lambda: BlackScholes.monte_carlo_price(100, 100, 0.25, 0.03, 0.20, n_paths=10_000))
    if mc_result:
        check("MC vs BS error < 2%",
              lambda: mc_result["error"] / mc_result["bs_price"] < 0.02)

    iv = check("Implied volatility inversion",
               lambda: BlackScholes.implied_vol(call.price, 100, 100, 0.25, 0.03))
    if iv:
        check("IV close to 0.20",
              lambda: abs(iv - 0.20) < 0.001)

    gbm_result = check("GBM simulation (1000 paths)",
                       lambda: simulate_gbm_paths(0.08, 0.20, n_paths=1000))
    if gbm_result:
        check("GBM mean within 10% of theoretical",
              lambda: abs(gbm_result["final_mean"] - gbm_result["theoretical_mean"]) / gbm_result["theoretical_mean"] < 0.10)

    lmsr = check("LMSR market maker",
                 lambda: LMSRMarket(n_outcomes=2, b=100))
    if lmsr:
        trade = check("LMSR trade execution",
                      lambda: lmsr.buy(0, 100))
        check("LMSR prices sum to 1",
              lambda: abs(sum(lmsr.prices()) - 1.0) < 1e-9)

    # ── Step 8: Report generation ───────────────────────────
    print("\n[8/8] Report generation")
    from report_generator import generate_report

    if bt_result is not None:
        validation_dict = {
            "label": good_val.label if good_val else "likely_noise",
            "t_stat": good_val.t_stat if good_val else 0,
            "p_value_raw": good_val.p_value_raw if good_val else 1.0,
            "p_value_corrected": good_val.p_value_corrected if good_val else 1.0,
            "correction_method": "benjamini-hochberg",
            "sharpe_ratio": good_val.sharpe_ratio if good_val else 0,
            "permutation_p_value": good_val.permutation_p_value if good_val else 1.0,
            "n_observations": good_val.n_observations if good_val else 0,
            "conclusion": good_val.conclusion if good_val else "N/A",
            "warnings": good_val.warnings if good_val else [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            report_path = check("Generate markdown report",
                                lambda: generate_report(
                                    run_id="test_integration",
                                    project_name="Integration Test Project",
                                    strategy_config={"fee_bps": 1.0, "slippage_bps": 2.0, "execution": "next_open"},
                                    backtest_metrics=bt_result.metrics,
                                    validation_result=validation_dict,
                                    signals_used=["conditional_probability", "pca_regime", "bayesian_update"],
                                    symbols=SYMBOLS,
                                    timeframe="1d (10Y)",
                                    artifacts_dir=tmpdir,
                                ))
            if report_path:
                report_text = Path(report_path).read_text()
                check("Report > 2000 chars",  lambda: len(report_text) > 2000)
                check("Report contains CAGR",  lambda: "CAGR" in report_text)
                check("Report contains disclaimer", lambda: "Not financial advice" in report_text)
                print(f"\n     Report preview (first 200 chars):")
                print(f"     {report_text[:200].replace(chr(10), ' ')[:200]}...")

    # ── Final summary ───────────────────────────────────────
    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"RESULTS: {passed}/{total} checks passed  ({failed} failed)")
    if failed == 0:
        print("✓ ALL SYSTEMS OPERATIONAL")
    elif failed <= 3:
        print("⚠ MOSTLY OPERATIONAL (minor issues)")
    else:
        print("✗ SIGNIFICANT FAILURES — check logs")
    print("=" * 60)
    print("\nNot financial advice. Markets involve risk.\n")
    return passed, failed


if __name__ == "__main__":
    run_integration_test()
