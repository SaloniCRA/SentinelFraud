"""
SentinelFraud benchmark — five-system comparison (Table 2 + Figure 2).

Compares, on the labeled synthetic benchmark, over three-fold cross-validation:
  1. Deterministic engine   (fixed CONFIG weights, no training)
  2. Calibrated engine      (logistic regression over the five named signals)
  3. Logistic regression    (all eight features)
  4. Random forest          (all eight features)
  5. Gradient boosting      (all eight features)

Reports AUC and AUC-PR, plus precision / recall / F1 / FPR at a fixed 3% alert
budget. Also produces the cold-start curve (AUC vs. number of fraud labels) and
a ten-seed reproducibility check. Everything is seeded and deterministic.

Outputs: benchmark/results.json and benchmark/results.md.
Run: python benchmark/run.py   (or: npm run benchmark)
"""

from __future__ import annotations

import json
import os

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold

from config import ALERT_BUDGET, SEED
from engine import engine_score
from synth import SIGNAL_IDX, generate_dataset

HERE = os.path.dirname(os.path.abspath(__file__))
N_SPLITS = 3


def metrics_at_budget(y_true, scores, budget=ALERT_BUDGET):
    """Precision/recall/F1/FPR when the top `budget` fraction is alerted."""
    n = len(scores)
    k = max(1, int(round(budget * n)))
    order = np.argsort(scores)[::-1]
    alert = np.zeros(n, dtype=bool)
    alert[order[:k]] = True
    tp = int(np.sum(alert & (y_true == 1)))
    fp = int(np.sum(alert & (y_true == 0)))
    fn = int(np.sum(~alert & (y_true == 1)))
    tn = int(np.sum(~alert & (y_true == 0)))
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    return precision, recall, f1, fpr


def new_models():
    return {
        "Logistic regression": LogisticRegression(max_iter=1000, C=1.0),
        "Random forest": RandomForestClassifier(
            n_estimators=200, max_depth=8, random_state=SEED, n_jobs=-1
        ),
        "Gradient boosting": GradientBoostingClassifier(random_state=SEED),
    }


def evaluate(X, y):
    """Three-fold CV; returns per-model lists of (auc, aucpr, P, R, F1, FPR)."""
    skf = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=SEED)
    names = ["Deterministic engine", "Calibrated engine"] + list(new_models().keys())
    acc = {name: {"auc": [], "aucpr": [], "P": [], "R": [], "F1": [], "FPR": []} for name in names}

    for train_idx, test_idx in skf.split(X, y):
        Xtr, Xte = X[train_idx], X[test_idx]
        ytr, yte = y[train_idx], y[test_idx]

        preds = {}
        # 1. Deterministic engine — no training, score on the five signals.
        preds["Deterministic engine"] = engine_score(Xte[:, SIGNAL_IDX])
        # 2. Calibrated engine — logistic regression over the five signals only.
        cal = LogisticRegression(max_iter=1000).fit(Xtr[:, SIGNAL_IDX], ytr)
        preds["Calibrated engine"] = cal.predict_proba(Xte[:, SIGNAL_IDX])[:, 1]
        # 3-5. Trained models on all eight features.
        for name, model in new_models().items():
            model.fit(Xtr, ytr)
            preds[name] = model.predict_proba(Xte)[:, 1]

        for name, p in preds.items():
            acc[name]["auc"].append(roc_auc_score(yte, p))
            acc[name]["aucpr"].append(average_precision_score(yte, p))
            pr, rc, f1, fpr = metrics_at_budget(yte, p)
            acc[name]["P"].append(pr)
            acc[name]["R"].append(rc)
            acc[name]["F1"].append(f1)
            acc[name]["FPR"].append(fpr)
    return acc


def cold_start_curve(X, y):
    """AUC vs. number of fraud labels available for training (Fig 2a)."""
    rng = np.random.default_rng(SEED)
    idx = np.arange(len(y))
    rng.shuffle(idx)
    split = len(y) // 2
    tr, te = idx[:split], idx[split:]
    Xtr, ytr, Xte, yte = X[tr], y[tr], X[te], y[te]

    engine_auc = roc_auc_score(yte, engine_score(Xte[:, SIGNAL_IDX]))
    fraud_tr = np.where(ytr == 1)[0]
    legit_tr = np.where(ytr == 0)[0]

    label_counts = [5, 10, 15, 25, 50, 100, 200]
    curve = {"labels": [], "engine": [], "logreg": [], "random_forest": [], "grad_boost": []}
    for k in label_counts:
        if k > len(fraud_tr):
            break
        f_sub = fraud_tr[:k]
        # Balance-ish: use all fraud + 10x legit for a small training set.
        l_sub = legit_tr[: min(len(legit_tr), k * 10)]
        sub = np.concatenate([f_sub, l_sub])
        Xs, ys = Xtr[sub], ytr[sub]
        curve["labels"].append(k)
        curve["engine"].append(engine_auc)  # engine ignores labels
        curve["logreg"].append(
            roc_auc_score(yte, LogisticRegression(max_iter=1000).fit(Xs, ys).predict_proba(Xte)[:, 1])
        )
        curve["random_forest"].append(
            roc_auc_score(
                yte,
                RandomForestClassifier(n_estimators=200, max_depth=8, random_state=SEED)
                .fit(Xs, ys)
                .predict_proba(Xte)[:, 1],
            )
        )
        curve["grad_boost"].append(
            roc_auc_score(
                yte,
                GradientBoostingClassifier(random_state=SEED).fit(Xs, ys).predict_proba(Xte)[:, 1],
            )
        )
    return curve


def reproducibility(X, y, n_runs=10):
    """Run-to-run variance on the SAME data: the engine is deterministic (zero
    variance, flags never change); the random forest is refit with different
    random seeds, so its AUC and its flagged set shift between runs."""
    rng = np.random.default_rng(SEED)
    idx = np.arange(len(y))
    rng.shuffle(idx)
    split = len(y) // 2
    tr, te = idx[:split], idx[split:]
    Xtr, ytr, Xte, yte = X[tr], y[tr], X[te], y[te]
    k = max(1, int(round(ALERT_BUDGET * len(yte))))

    def flagged_set(scores):
        return set(np.argsort(scores)[::-1][:k].tolist())

    # Engine: identical every run.
    engine_scores = engine_score(Xte[:, SIGNAL_IDX])
    engine_auc = roc_auc_score(yte, engine_scores)
    engine_flags = flagged_set(engine_scores)

    rf_aucs, rf_flag_sets = [], []
    for r in range(n_runs):
        rf = RandomForestClassifier(n_estimators=200, max_depth=8, random_state=1000 + r)
        rf.fit(Xtr, ytr)
        p = rf.predict_proba(Xte)[:, 1]
        rf_aucs.append(roc_auc_score(yte, p))
        rf_flag_sets.append(flagged_set(p))

    # Average symmetric difference of RF flagged sets between consecutive runs.
    shifts = []
    for a, b in zip(rf_flag_sets, rf_flag_sets[1:]):
        shifts.append(len(a ^ b) / (2 * k))
    return {
        "engine_auc": float(engine_auc),
        "engine_auc_sd": 0.0,
        "engine_flag_shift": 0.0,
        "engine_flags_identical": all(flagged_set(engine_score(Xte[:, SIGNAL_IDX])) == engine_flags for _ in range(3)),
        "rf_auc_sd": float(np.std(rf_aucs)),
        "rf_auc_range": [float(np.min(rf_aucs)), float(np.max(rf_aucs))],
        "rf_flag_shift": float(np.mean(shifts)) if shifts else 0.0,
    }


def summarize(acc):
    table = {}
    for name, m in acc.items():
        table[name] = {
            "auc_mean": float(np.mean(m["auc"])),
            "auc_sd": float(np.std(m["auc"])),
            "aucpr_mean": float(np.mean(m["aucpr"])),
            "precision": float(np.mean(m["P"])),
            "recall": float(np.mean(m["R"])),
            "f1": float(np.mean(m["F1"])),
            "fpr": float(np.mean(m["FPR"])),
        }
    return table


def main():
    X, y = generate_dataset()
    table = summarize(evaluate(X, y))
    results = {
        "seed": SEED,
        "n": int(len(y)),
        "fraud_rate": float(y.mean()),
        "cv_folds": N_SPLITS,
        "alert_budget": ALERT_BUDGET,
        "table2": table,
        "cold_start": cold_start_curve(X, y),
        "reproducibility": reproducibility(X, y),
    }

    with open(os.path.join(HERE, "results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    order = [
        "Deterministic engine",
        "Calibrated engine",
        "Random forest",
        "Gradient boosting",
        "Logistic regression",
    ]
    lines = [
        "# Benchmark results (regenerated, reproducible)",
        "",
        f"Synthetic benchmark: n={results['n']}, fraud={results['fraud_rate']:.2%}, "
        f"{N_SPLITS}-fold CV, seed={SEED}. Metrics at a {int(ALERT_BUDGET*100)}% alert budget.",
        "",
        "| Model | AUC (mean ± SD) | AUC-PR | Precision | Recall | F1 | FPR |",
        "|---|---|---|---|---|---|---|",
    ]
    for name in order:
        m = table[name]
        lines.append(
            f"| {name} | {m['auc_mean']:.3f} ± {m['auc_sd']:.3f} | {m['aucpr_mean']:.3f} | "
            f"{m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} | {m['fpr']:.3f} |"
        )
    rep = results["reproducibility"]
    lines += [
        "",
        f"Reproducibility (same data, 10 runs): engine AUC SD = {rep['engine_auc_sd']:.4f}, "
        f"flagged-set shift = {rep['engine_flag_shift']:.1%} (deterministic); "
        f"random forest AUC SD = {rep['rf_auc_sd']:.4f} "
        f"(range {rep['rf_auc_range'][0]:.3f}-{rep['rf_auc_range'][1]:.3f}), "
        f"flagged-set shift = {rep['rf_flag_shift']:.1%} between runs.",
    ]
    with open(os.path.join(HERE, "results.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
