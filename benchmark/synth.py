"""
SentinelFraud benchmark — labeled synthetic dataset.

Matches the paper's protocol: ~8,000 transactions, about 5% fraud, eight
features. Fraud depends on the engine's five (partly observed) signals PLUS
three hidden drivers the engine cannot see, plus interactions and noise, so
trained models that use all eight features can win and the test does not favor
the engine. Fully reproducible from a fixed seed.

Design (latent-variable, no label leakage):
  z            latent risk, partly observed through the five engine signals
  g1, g2, g3   hidden drivers the engine cannot see
  label ~ Bernoulli(sigmoid( b0 + a*z + c1*g1 + c2*g2
                             + interaction(z, g1) + interaction(g2, g3) + noise ))
The engine signals are noisy observations of z, so the engine recovers part of
the risk; a model that also sees g1..g3 and interactions recovers more.
"""

from __future__ import annotations

import numpy as np

from config import CORE_SIGNALS, SEED

FEATURE_NAMES = CORE_SIGNALS + ["hidden_1", "hidden_2", "hidden_3"]
# The engine can only see the first five columns.
SIGNAL_IDX = list(range(len(CORE_SIGNALS)))


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def generate_dataset(seed: int = SEED, n: int = 8000):
    """Return (X, y): X is (n, 8) float, y is (n,) int in {0,1}."""
    rng = np.random.default_rng(seed)

    z = rng.normal(0.0, 1.0, n)  # latent risk
    g1 = rng.normal(0.0, 1.0, n)  # hidden drivers
    g2 = rng.normal(0.0, 1.0, n)
    g3 = rng.normal(0.0, 1.0, n)

    # Engine signals: noisy observations of the latent risk.
    amount = np.clip(0.28 + 0.19 * z + rng.normal(0.0, 0.18, n), 0.0, 1.0)
    velocity = np.clip(0.26 + 0.18 * z + rng.normal(0.0, 0.18, n), 0.0, 1.0)

    def bern(p):
        return (rng.random(n) < p).astype(float)

    new_country = bern(_sigmoid(-1.9 + 1.05 * z))
    odd_hour = bern(_sigmoid(-1.8 + 0.85 * z))
    bin_geo = bern(_sigmoid(-2.2 + 1.05 * z))

    # Label: latent risk (mostly observable via signals) + weaker hidden drivers
    # + interactions + noise, so trained models lead only modestly on full data.
    logit = (
        -3.85
        + 1.30 * z
        + 0.45 * g1
        + 0.32 * g2
        + 0.28 * (z * g1)
        + 0.22 * (g2 * g3)
        + rng.normal(0.0, 0.50, n)
    )
    y = (rng.random(n) < _sigmoid(logit)).astype(int)

    X = np.column_stack([amount, new_country, velocity, odd_hour, bin_geo, g1, g2, g3])
    return X, y


if __name__ == "__main__":
    X, y = generate_dataset()
    print(f"n={len(y)} features={X.shape[1]} fraud={y.mean():.3%} ({y.sum()} cases)")
