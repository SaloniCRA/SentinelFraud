"""
SentinelFraud benchmark — engine configuration mirrored from lib/fraud-engine.ts.

These weights and band thresholds MUST match the TypeScript CONFIG object so the
benchmark scores the same engine the app ships. The parity test
(benchmark/test_parity.py) checks a set of signal vectors against the TS engine
to catch drift.

Only the FIVE core signals are used here: the synthetic benchmark models these,
matching the paper's protocol ("isolates the five core signals"). The four
enrichment signals (IP-geo, anonymizer, email, impossible-travel) are exercised
in the live system and unit tests, not in this tabular benchmark.
"""

# Core signal weights (max points each signal contributes), from CONFIG.weights.
CORE_WEIGHTS = {
    "amount_anomaly": 70,
    "new_country": 30,
    "velocity": 35,
    "odd_hour": 20,
    "bin_geo_mismatch": 25,
}

CORE_SIGNALS = list(CORE_WEIGHTS.keys())

# Band thresholds (inclusive lower bounds), from CONFIG.bands.
BANDS = {"medium": 35, "high": 70}

# Fixed seed for the whole benchmark (documented in the paper's Data Availability).
SEED = 20240501

# Alert budget for precision/recall reporting.
ALERT_BUDGET = 0.03
