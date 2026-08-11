"""
Parity test: the Python benchmark engine must use the SAME core weights and
band thresholds as the shipped TypeScript engine (lib/fraud-engine.ts).

This guards against the drift that existed before (the old standalone red-team
model used different weights than the deployed engine). Run:
    python benchmark/test_parity.py
Exits non-zero on any mismatch.
"""

from __future__ import annotations

import os
import re
import sys

import numpy as np

from config import BANDS, CORE_WEIGHTS
from engine import engine_score

TS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib", "fraud-engine.ts")

# Map TS CONFIG.weights keys -> benchmark CORE_WEIGHTS keys.
TS_TO_PY = {
    "amountAnomaly": "amount_anomaly",
    "newCountry": "new_country",
    "velocity": "velocity",
    "oddHour": "odd_hour",
    "binGeoMismatch": "bin_geo_mismatch",
}


def parse_ts_config(text: str) -> tuple[dict, dict]:
    def num(key: str) -> int:
        m = re.search(rf"{key}\s*:\s*(\d+)", text)
        if not m:
            raise AssertionError(f"could not find {key} in fraud-engine.ts")
        return int(m.group(1))

    weights = {TS_TO_PY[k]: num(k) for k in TS_TO_PY}
    # Band thresholds live under `bands: { medium: N, high: N }`.
    bands_block = re.search(r"bands:\s*\{(.*?)\}", text, re.DOTALL).group(1)
    bands = {"medium": int(re.search(r"medium:\s*(\d+)", bands_block).group(1)),
             "high": int(re.search(r"high:\s*(\d+)", bands_block).group(1))}
    return weights, bands


def main() -> int:
    text = open(TS_PATH, encoding="utf-8").read()
    ts_weights, ts_bands = parse_ts_config(text)

    failures = []
    if ts_weights != CORE_WEIGHTS:
        failures.append(f"weight mismatch: TS {ts_weights} != benchmark {CORE_WEIGHTS}")
    if ts_bands != BANDS:
        failures.append(f"band mismatch: TS {ts_bands} != benchmark {BANDS}")

    # Numeric spot check of the additive formula.
    sig = np.array([[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [0.5, 0, 0.2, 0, 1]], dtype=float)
    expected = np.minimum(100.0, sig @ np.array(list(CORE_WEIGHTS.values()), dtype=float))
    if not np.allclose(engine_score(sig), expected):
        failures.append("engine_score does not match the weighted-sum formula")

    if failures:
        for f in failures:
            print("PARITY FAIL:", f)
        return 1
    print("PARITY OK: benchmark engine matches lib/fraud-engine.ts")
    print(f"  weights {CORE_WEIGHTS}")
    print(f"  bands   {BANDS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
