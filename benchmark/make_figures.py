"""
Figure 2 for the paper, from benchmark/results.json:
  (a) AUC vs. number of fraud labels available for training (cold-start).
  (b) Full-data AUC by model (three-fold CV, mean ± SD).
Run: python benchmark/make_figures.py  (after benchmark/run.py)
"""

from __future__ import annotations

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIG_DIR = os.path.join(HERE, "figures")
os.makedirs(FIG_DIR, exist_ok=True)


def main():
    r = json.load(open(os.path.join(HERE, "results.json"), encoding="utf-8"))
    cs = r["cold_start"]
    t2 = r["table2"]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.5, 4.0))

    # (a) cold-start
    ax1.plot(cs["labels"], cs["engine"], "k--", label="Deterministic engine (no labels)")
    ax1.plot(cs["labels"], cs["logreg"], "o-", label="Logistic regression")
    ax1.plot(cs["labels"], cs["random_forest"], "s-", label="Random forest")
    ax1.plot(cs["labels"], cs["grad_boost"], "^-", label="Gradient boosting")
    ax1.set_xlabel("fraud labels available for training")
    ax1.set_ylabel("AUC")
    ax1.set_title("(a) Cold-start: AUC vs. fraud labels")
    ax1.legend(fontsize=7)

    # (b) full-data AUC by model
    order = ["Deterministic engine", "Calibrated engine", "Random forest",
             "Gradient boosting", "Logistic regression"]
    means = [t2[m]["auc_mean"] for m in order]
    sds = [t2[m]["auc_sd"] for m in order]
    colors = ["#0ea5e9", "#22c55e", "#a855f7", "#f97316", "#ef4444"]
    ax2.bar(range(len(order)), means, yerr=sds, capsize=4, color=colors)
    ax2.set_xticks(range(len(order)))
    ax2.set_xticklabels([m.replace(" ", "\n") for m in order], fontsize=7)
    ax2.set_ylabel("AUC")
    ax2.set_ylim(0.6, 0.85)
    ax2.set_title("(b) Full-data AUC by model")

    fig.tight_layout()
    out = os.path.join(FIG_DIR, "figure2.png")
    fig.savefig(out, dpi=130)
    print("wrote", out)


if __name__ == "__main__":
    main()
