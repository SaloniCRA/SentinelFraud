# SentinelFraud benchmark & model

Reproducible, seeded benchmark that regenerates the paper's Table 2 and Figure 2,
plus the learned/calibrated glass-box extensions (calibration, conformal
abstention, autoencoder ablation, accuracy ceiling, and the accuracy-vs-
auditability frontier).

Everything is Python (scikit-learn) and fully deterministic from `SEED = 20240501`.
The Python engine (`engine.py`) mirrors the five core weights of the shipped
TypeScript engine (`lib/fraud-engine.ts`); `test_parity.py` fails if they drift.

## Run

```bash
pip install -r benchmark/requirements.txt   # numpy scipy scikit-learn pandas matplotlib
python benchmark/test_parity.py             # engine ↔ lib/fraud-engine.ts parity
python benchmark/run.py                      # Table 2 + cold-start + reproducibility -> results.json/.md
python benchmark/make_figures.py             # Figure 2 -> figures/figure2.png
python model/train.py                        # calibration, conformal, ablation, ceiling, frontier
```

Or via npm: `npm run benchmark`, `npm run model:eval`, `npm run parity`.

## What the benchmark is (and is not)

- **Synthetic, by necessity.** As the paper notes, no public dataset carries the
  engine's named signals (country, BIN, velocity) with confirmed labels, so we
  build a labeled synthetic benchmark: ~8,000 transactions, ~5% fraud, eight
  features. Fraud depends on the engine's five (partly observed) signals **plus
  three hidden drivers the engine cannot see**, interactions, and noise — so
  trained models that use all eight features can win. The test does **not** favor
  the engine.
- **Relative, not field, numbers.** These are controlled comparisons on synthetic
  data. They support the paper's claims about reproducibility, cold-start value,
  calibration, and selective abstention — not real-world fraud performance.

## Real data (future work)

To run the same comparison on real labeled data, drop a CSV into
`benchmark/data/` (git-ignored) and map its columns onto the five core signals
where available. Two public options:

- **IEEE-CIS Fraud Detection** (Kaggle) — has card, some geo, and time fields.
- **ULB creditcard.csv** (Kaggle) — PCA-anonymized; the engine's *named* signals
  cannot be computed from it, so it is only usable for calibration/threshold
  studies, not a signal-level comparison.

Do **not** commit datasets. The real-data evaluation is scoped as future work in
the paper: public datasets lack the engine's named signals, so a naïve head-to-
head would be misleading; the value of the real-data step is calibration and
cold-start behavior on live chargeback labels.
