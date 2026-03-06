"""
Stochastic Finance Module
=========================
Geometric Brownian Motion, Black-Scholes, Greeks, Monte Carlo, LMSR.

Mathematical rigor required. All formulas documented.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy import stats
from scipy.optimize import brentq

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Geometric Brownian Motion
# ---------------------------------------------------------------------------

class GBMSimulator:
    """
    Geometric Brownian Motion:
      dS = μS dt + σS dW
      
    Ito's lemma on f(S,t) = ln(S):
      d(ln S) = (μ - σ²/2) dt + σ dW
      
    Exact solution:
      S(T) = S(0) exp[(μ - σ²/2)T + σ√T Z]  where Z ~ N(0,1)
    """

    def __init__(self, mu: float, sigma: float, s0: float = 100.0, seed: int = None):
        self.mu = mu
        self.sigma = sigma
        self.s0 = s0
        self.rng = np.random.default_rng(seed)

    def simulate(self, T: float, n_steps: int, n_paths: int = 1) -> np.ndarray:
        """
        Simulate GBM paths.
        Returns array of shape (n_paths, n_steps+1).
        """
        dt = T / n_steps
        # Drift and diffusion terms via Ito's lemma
        drift = (self.mu - 0.5 * self.sigma ** 2) * dt
        diffusion = self.sigma * np.sqrt(dt)

        Z = self.rng.standard_normal((n_paths, n_steps))
        log_increments = drift + diffusion * Z

        log_paths = np.concatenate([
            np.zeros((n_paths, 1)),
            np.cumsum(log_increments, axis=1),
        ], axis=1)

        return self.s0 * np.exp(log_paths)

    def expected_value(self, T: float) -> float:
        """E[S(T)] = S(0) exp(μT)"""
        return self.s0 * np.exp(self.mu * T)

    def variance(self, T: float) -> float:
        """Var[S(T)] = S(0)² exp(2μT)(exp(σ²T) - 1)"""
        return (self.s0 ** 2) * np.exp(2 * self.mu * T) * (np.exp(self.sigma ** 2 * T) - 1)


# ---------------------------------------------------------------------------
# Black-Scholes Pricing
# ---------------------------------------------------------------------------

@dataclass
class BSResult:
    price: float
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float
    d1: float
    d2: float


class BlackScholes:
    """
    Black-Scholes European option pricing.

    Call: C = S₀N(d₁) - Ke^{-rT}N(d₂)
    Put:  P = Ke^{-rT}N(-d₂) - S₀N(-d₁)

    where:
      d₁ = [ln(S₀/K) + (r + σ²/2)T] / (σ√T)
      d₂ = d₁ - σ√T

    Greeks:
      Δ = ∂C/∂S = N(d₁)
      Γ = ∂²C/∂S² = φ(d₁) / (S₀σ√T)
      Θ = ∂C/∂t = -S₀φ(d₁)σ/(2√T) - rKe^{-rT}N(d₂)
      ν = ∂C/∂σ = S₀φ(d₁)√T
      ρ = ∂C/∂r = KTe^{-rT}N(d₂)
    """

    @classmethod
    def price(
        cls,
        S: float,      # spot price
        K: float,      # strike
        T: float,      # time to expiry (years)
        r: float,      # risk-free rate
        sigma: float,  # implied vol
        option_type: str = "call",
        q: float = 0.0,  # continuous dividend yield
    ) -> BSResult:
        if T <= 0:
            intrinsic = max(S - K, 0) if option_type == "call" else max(K - S, 0)
            return BSResult(price=intrinsic, delta=0, gamma=0, theta=0, vega=0, rho=0, d1=0, d2=0)

        sqrtT = np.sqrt(T)
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * sqrtT)
        d2 = d1 - sigma * sqrtT

        N = stats.norm.cdf
        n = stats.norm.pdf

        if option_type == "call":
            price = S * np.exp(-q * T) * N(d1) - K * np.exp(-r * T) * N(d2)
            delta = np.exp(-q * T) * N(d1)
            rho = K * T * np.exp(-r * T) * N(d2) / 100
        else:
            price = K * np.exp(-r * T) * N(-d2) - S * np.exp(-q * T) * N(-d1)
            delta = -np.exp(-q * T) * N(-d1)
            rho = -K * T * np.exp(-r * T) * N(-d2) / 100

        gamma = np.exp(-q * T) * n(d1) / (S * sigma * sqrtT)
        vega = S * np.exp(-q * T) * n(d1) * sqrtT / 100  # per 1% vol change

        # Theta (per calendar day)
        theta_call = (
            -S * np.exp(-q * T) * n(d1) * sigma / (2 * sqrtT)
            - r * K * np.exp(-r * T) * N(d2)
            + q * S * np.exp(-q * T) * N(d1)
        )
        if option_type == "call":
            theta = theta_call / 365
        else:
            theta_put = (
                -S * np.exp(-q * T) * n(d1) * sigma / (2 * sqrtT)
                + r * K * np.exp(-r * T) * N(-d2)
                - q * S * np.exp(-q * T) * N(-d1)
            )
            theta = theta_put / 365

        return BSResult(
            price=float(price),
            delta=float(delta),
            gamma=float(gamma),
            theta=float(theta),
            vega=float(vega),
            rho=float(rho),
            d1=float(d1),
            d2=float(d2),
        )

    @classmethod
    def implied_vol(
        cls,
        market_price: float,
        S: float,
        K: float,
        T: float,
        r: float,
        option_type: str = "call",
        tol: float = 1e-6,
    ) -> float:
        """Compute implied volatility via Brent's method."""
        def objective(sigma):
            return cls.price(S, K, T, r, sigma, option_type).price - market_price

        try:
            return brentq(objective, 1e-6, 10.0, xtol=tol)
        except ValueError:
            return np.nan

    @classmethod
    def monte_carlo_price(
        cls,
        S: float,
        K: float,
        T: float,
        r: float,
        sigma: float,
        option_type: str = "call",
        n_paths: int = 100_000,
        seed: int = 42,
    ) -> dict:
        """Monte Carlo verification of BS price."""
        rng = np.random.default_rng(seed)
        Z = rng.standard_normal(n_paths)
        S_T = S * np.exp((r - 0.5 * sigma ** 2) * T + sigma * np.sqrt(T) * Z)

        if option_type == "call":
            payoffs = np.maximum(S_T - K, 0)
        else:
            payoffs = np.maximum(K - S_T, 0)

        mc_price = np.exp(-r * T) * np.mean(payoffs)
        mc_se = np.exp(-r * T) * np.std(payoffs, ddof=1) / np.sqrt(n_paths)
        bs_price = cls.price(S, K, T, r, sigma, option_type).price

        return {
            "mc_price": float(mc_price),
            "mc_se": float(mc_se),
            "mc_ci_lower": float(mc_price - 1.96 * mc_se),
            "mc_ci_upper": float(mc_price + 1.96 * mc_se),
            "bs_price": float(bs_price),
            "error": float(abs(mc_price - bs_price)),
            "n_paths": n_paths,
        }


# ---------------------------------------------------------------------------
# LMSR Prediction Market
# ---------------------------------------------------------------------------

class LMSRMarket:
    """
    Logarithmic Market Scoring Rule (LMSR) automated market maker.

    Cost function:
      C(q) = b · ln( Σᵢ exp(qᵢ/b) )

    Price (probability) of outcome i:
      pᵢ = exp(qᵢ/b) / Σⱼ exp(qⱼ/b)

    where:
      q = quantity vector (shares outstanding)
      b = liquidity parameter

    Properties:
    - Bounded loss: b · ln(n) where n = number of outcomes
    - Proper scoring rule (incentive-compatible)
    - Prices sum to 1 at all times
    """

    def __init__(self, n_outcomes: int, b: float = 100.0):
        self.n_outcomes = n_outcomes
        self.b = b
        self.q = np.zeros(n_outcomes)   # outstanding shares
        self.trade_history = []

    def cost(self, q: np.ndarray) -> float:
        """C(q) = b · ln( Σᵢ exp(qᵢ/b) )"""
        # Use log-sum-exp for numerical stability
        a = q / self.b
        a_max = a.max()
        return float(self.b * (a_max + np.log(np.sum(np.exp(a - a_max)))))

    def prices(self, q: np.ndarray = None) -> np.ndarray:
        """
        pᵢ = exp(qᵢ/b) / Σⱼ exp(qⱼ/b)
        Returns probability vector.
        """
        if q is None:
            q = self.q
        a = q / self.b
        a -= a.max()  # numerical stability
        exp_a = np.exp(a)
        return exp_a / exp_a.sum()

    def cost_to_buy(self, outcome_idx: int, shares: float) -> float:
        """
        Cost of buying `shares` of outcome `outcome_idx`.
        = C(q + Δ) - C(q) where Δᵢ = shares at outcome_idx
        """
        q_new = self.q.copy()
        q_new[outcome_idx] += shares
        return self.cost(q_new) - self.cost(self.q)

    def buy(self, outcome_idx: int, shares: float) -> dict:
        """Execute a trade."""
        cost = self.cost_to_buy(outcome_idx, shares)
        self.q[outcome_idx] += shares
        prices_after = self.prices()

        trade = {
            "outcome": outcome_idx,
            "shares": shares,
            "cost": cost,
            "prices_after": prices_after.tolist(),
            "implied_prob": float(prices_after[outcome_idx]),
        }
        self.trade_history.append(trade)
        return trade

    def state(self) -> dict:
        prices = self.prices()
        return {
            "quantities": self.q.tolist(),
            "prices": prices.tolist(),
            "cost_basis": self.cost(self.q),
            "max_loss": float(self.b * np.log(self.n_outcomes)),
            "n_trades": len(self.trade_history),
        }

    def as_signal(self, bull_outcome_idx: int = 0) -> float:
        """
        Convert LMSR probability to a trading signal.
        Returns probability of outcome_idx being correct.
        Used to incorporate prediction market beliefs into signal engine.
        """
        prices = self.prices()
        return float(prices[bull_outcome_idx])


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

def simulate_gbm_paths(
    mu: float,
    sigma: float,
    s0: float = 100.0,
    T: float = 1.0,
    n_steps: int = 252,
    n_paths: int = 1000,
    seed: int = 42,
) -> dict:
    sim = GBMSimulator(mu=mu, sigma=sigma, s0=s0, seed=seed)
    paths = sim.simulate(T, n_steps, n_paths)
    final_prices = paths[:, -1]
    return {
        "paths": paths[:min(50, n_paths)].tolist(),  # return subset for bandwidth
        "final_mean": float(np.mean(final_prices)),
        "final_std": float(np.std(final_prices)),
        "final_5th": float(np.percentile(final_prices, 5)),
        "final_95th": float(np.percentile(final_prices, 95)),
        "theoretical_mean": float(sim.expected_value(T)),
        "n_paths": n_paths,
        "n_steps": n_steps,
    }


def price_option_full(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str = "call",
) -> dict:
    result = BlackScholes.price(S, K, T, r, sigma, option_type)
    mc = BlackScholes.monte_carlo_price(S, K, T, r, sigma, option_type, n_paths=50_000)
    return {
        "black_scholes": {
            "price": result.price,
            "delta": result.delta,
            "gamma": result.gamma,
            "theta": result.theta,
            "vega": result.vega,
            "rho": result.rho,
        },
        "monte_carlo": mc,
    }
