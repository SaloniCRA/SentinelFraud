# Benchmark results (regenerated, reproducible)

Synthetic benchmark: n=8000, fraud=5.42%, 3-fold CV, seed=20240501. Metrics at a 3% alert budget.

| Model | AUC (mean ± SD) | AUC-PR | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|
| Deterministic engine | 0.753 ± 0.010 | 0.147 | 0.208 | 0.115 | 0.148 | 0.025 |
| Calibrated engine | 0.768 ± 0.014 | 0.177 | 0.246 | 0.136 | 0.175 | 0.024 |
| Random forest | 0.783 ± 0.010 | 0.232 | 0.312 | 0.173 | 0.223 | 0.022 |
| Gradient boosting | 0.784 ± 0.012 | 0.203 | 0.287 | 0.159 | 0.205 | 0.023 |
| Logistic regression | 0.803 ± 0.006 | 0.251 | 0.354 | 0.196 | 0.252 | 0.020 |

Reproducibility (same data, 10 runs): engine AUC SD = 0.0000, flagged-set shift = 0.0% (deterministic); random forest AUC SD = 0.0019 (range 0.768-0.773), flagged-set shift = 13.5% between runs.
