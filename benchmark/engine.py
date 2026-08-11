"""
SentinelFraud benchmark — deterministic engine score in Python.

Faithful port of the additive scoring rule in lib/fraud-engine.ts for the five
core signals: score(x) = min(100, sum_i w_i * a_i(x)), with a_i in [0, 1].
Pure and deterministic. The parity test checks it against the TypeScript engine.
"""

from __future__ import annotations

import numpy as np

from config import BANDS, CORE_SIGNALS, CORE_WEIGHTS

_WEIGHT_VEC = np.array([CORE_WEIGHTS[s] for s in CORE_SIGNALS], dtype=float)


def engine_score(signals: np.ndarray) -> np.ndarray:
    """Score a matrix of core-signal activations.

    signals: shape (n, 5), columns in CORE_SIGNALS order, values in [0, 1].
    Returns an (n,) array of scores in [0, 100].
    """
    signals = np.asarray(signals, dtype=float)
    if signals.shape[1] != len(CORE_SIGNALS):
        raise ValueError(f"expected {len(CORE_SIGNALS)} signal columns")
    return np.minimum(100.0, signals @ _WEIGHT_VEC)


def band_for_score(score: np.ndarray) -> np.ndarray:
    """Map scores to 0/1/2 = low/medium/high using the configured thresholds."""
    score = np.asarray(score, dtype=float)
    out = np.zeros_like(score, dtype=int)
    out[score >= BANDS["medium"]] = 1
    out[score >= BANDS["high"]] = 2
    return out
