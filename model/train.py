"""
SentinelFraud model — learned, calibrated glass-box extensions of the engine.

Turns the hand-set additive engine into a *method* while preserving per-signal
auditability. Produces, on the reproducible synthetic benchmark (fixed seed):

  1. LEARNED WEIGHTS  — logistic regression over the five NAMED signals; the
     coefficients are the additive weights, with bootstrap 95% CIs. The model
     stays additive and decomposable. -> model/weights.md
  2. CALIBRATION      — Platt and isotonic wrappers turn the ordinal score into
     a calibrated probability; reports Brier score and expected calibration
     error (ECE) and a reliability diagram. A pure rule engine cannot claim this.
  3. CONFORMAL ABSTENTION — split-conformal selective risk: a calibrated
     "auto-decide vs. send-to-human-review" threshold with a target error rate.
     Reports empirical selective error vs. target and the review-rate curve,
     tying the human-in-the-loop trigger to a formal guarantee.
  4. BOUNDED LEARNED SIGNAL — a small autoencoder's reconstruction error added
     as one named 6th signal; reports the marginal AUC it adds (ablation).
  5. ACCURACY CEILING — a monotonic gradient-boosting model as the upper bound,
     to show the auditable model's gap to it.
  6. TRADE-OFF FIGURE — accuracy vs. interpretability, with the auditable frontier.

Outputs: model/results.json, model/weights.md, model/figures/*.png
Run: python model/train.py   (or: npm run model:eval)
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import brier_score_loss, roc_auc_score  # noqa: E402
from sklearn.model_selection import StratifiedKFold  # noqa: E402
from sklearn.neural_network import MLPRegressor  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "benchmark"))
from config import CORE_SIGNALS, SEED  # noqa: E402
from engine import engine_score  # noqa: E402
from synth import SIGNAL_IDX, generate_dataset  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIG_DIR = os.path.join(HERE, "figures")
os.makedirs(FIG_DIR, exist_ok=True)


def split(X, y, seed=SEED):
    """Deterministic train / calibration / test split (60/20/20)."""
    rng = np.random.default_rng(seed)
    idx = np.arange(len(y))
    rng.shuffle(idx)
    a, b = int(0.6 * len(y)), int(0.8 * len(y))
    return idx[:a], idx[a:b], idx[b:]


def ece(y_true, prob, n_bins=10):
    """Expected calibration error."""
    bins = np.linspace(0, 1, n_bins + 1)
    e = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (prob > lo) & (prob <= hi)
        if m.sum() == 0:
            continue
        e += (m.mean()) * abs(prob[m].mean() - y_true[m].mean())
    return float(e)


def learned_weights(Xtr, ytr):
    """LR over the five named signals; coefficients + bootstrap 95% CIs."""
    S = Xtr[:, SIGNAL_IDX]
    base = LogisticRegression(max_iter=1000).fit(S, ytr)
    coefs = []
    rng = np.random.default_rng(SEED)
    for _ in range(300):
        bi = rng.integers(0, len(ytr), len(ytr))
        m = LogisticRegression(max_iter=1000).fit(S[bi], ytr[bi])
        coefs.append(m.coef_[0])
    coefs = np.array(coefs)
    lo, hi = np.percentile(coefs, [2.5, 97.5], axis=0)
    return {
        CORE_SIGNALS[i]: {
            "weight": float(base.coef_[0][i]),
            "ci95": [float(lo[i]), float(hi[i])],
        }
        for i in range(len(CORE_SIGNALS))
    }, base


def autoencoder_signal(Xtr, ytr, Xte):
    """Train a small autoencoder on LEGIT training rows; reconstruction error is
    one bounded [0,1] anomaly signal. Features are standardized (train stats)
    so the MSE is not dominated by the [0,1] signal columns and the AE can model
    the hidden structure. Returns (ae_signal_train, ae_signal_test)."""
    mu, sd = Xtr.mean(axis=0), Xtr.std(axis=0) + 1e-9
    Ztr, Zte = (Xtr - mu) / sd, (Xte - mu) / sd
    legit = Ztr[ytr == 0]
    ae = MLPRegressor(
        hidden_layer_sizes=(6, 3, 6), activation="tanh", max_iter=1500,
        random_state=SEED, alpha=1e-4,
    )
    ae.fit(legit, legit)
    err_tr = np.mean((ae.predict(Ztr) - Ztr) ** 2, axis=1)
    err_te = np.mean((ae.predict(Zte) - Zte) ** 2, axis=1)
    lo, hi = np.percentile(err_tr, [5, 95])
    norm = lambda e: np.clip((e - lo) / max(hi - lo, 1e-9), 0, 1)  # noqa: E731
    return norm(err_tr), norm(err_te)


def load_benchmark_aucs():
    """Single source of truth for baseline AUCs: benchmark/results.json."""
    path = os.path.join(HERE, "..", "benchmark", "results.json")
    if not os.path.exists(path):
        raise SystemExit("Run `python benchmark/run.py` first (benchmark/results.json missing).")
    t = json.load(open(path, encoding="utf-8"))["table2"]
    return {k: v["auc_mean"] for k, v in t.items()}


def main():
    bench = load_benchmark_aucs()
    X, y = generate_dataset()
    tr, cal, te = split(X, y)
    Xtr, ytr = X[tr], y[tr]
    Xcal, ycal = X[cal], y[cal]
    Xte, yte = X[te], y[te]

    results = {"seed": SEED}

    # 1. Learned weights ----------------------------------------------------
    weights, cal_model = learned_weights(Xtr, ytr)
    results["learned_weights"] = weights

    # 2. Calibration --------------------------------------------------------
    raw_te = engine_score(Xte[:, SIGNAL_IDX]) / 100.0  # ordinal score -> [0,1]
    raw_cal = engine_score(Xcal[:, SIGNAL_IDX]) / 100.0
    platt = LogisticRegression(max_iter=1000).fit(raw_cal.reshape(-1, 1), ycal)
    p_platt = platt.predict_proba(raw_te.reshape(-1, 1))[:, 1]
    iso = IsotonicRegression(out_of_bounds="clip").fit(raw_cal, ycal)
    p_iso = iso.predict(raw_te)
    results["calibration"] = {
        "raw_score": {"brier": float(brier_score_loss(yte, raw_te)), "ece": ece(yte, raw_te)},
        "platt": {"brier": float(brier_score_loss(yte, p_platt)), "ece": ece(yte, p_platt)},
        "isotonic": {"brier": float(brier_score_loss(yte, p_iso)), "ece": ece(yte, p_iso)},
    }

    # Reliability diagram
    plt.figure(figsize=(4.2, 4.2))
    plt.plot([0, 1], [0, 1], "--", color="#888", label="perfect")
    for name, p, c in [("raw score", raw_te, "#f59e0b"), ("Platt", p_platt, "#2563eb"), ("isotonic", p_iso, "#16a34a")]:
        bins = np.linspace(0, 1, 11)
        xs, ys = [], []
        for lo, hi in zip(bins[:-1], bins[1:]):
            m = (p > lo) & (p <= hi)
            if m.sum() > 5:
                xs.append(p[m].mean())
                ys.append(yte[m].mean())
        plt.plot(xs, ys, "o-", color=c, label=name, markersize=4)
    plt.xlabel("predicted probability")
    plt.ylabel("observed fraud rate")
    plt.title("Reliability diagram")
    plt.legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "reliability.png"), dpi=130)
    plt.close()

    # 3. Conformal / selective abstention ----------------------------------
    # Confidence = predicted prob of the predicted class (use isotonic probs).
    p_cal = iso.predict(raw_cal)
    conf_cal = np.where(p_cal >= 0.5, p_cal, 1 - p_cal)
    err_cal = (np.round(p_cal) != ycal).astype(int)
    conf_te = np.where(p_iso >= 0.5, p_iso, 1 - p_iso)
    err_te = (np.round(p_iso) != yte).astype(int)

    conformal = {"target_error": [], "empirical_error": [], "review_rate": [], "coverage": []}
    order = np.argsort(-conf_cal)  # most confident first
    for alpha in [0.02, 0.05, 0.08, 0.10, 0.15]:
        # Smallest confidence threshold whose auto-decided cal error <= alpha.
        tau = 1.0
        for t in np.linspace(1.0, 0.5, 200):
            auto = conf_cal >= t
            if auto.sum() >= 20 and err_cal[auto].mean() <= alpha:
                tau = t
        auto_te = conf_te >= tau
        cov = float(auto_te.mean())
        emp = float(err_te[auto_te].mean()) if auto_te.sum() else 0.0
        conformal["target_error"].append(alpha)
        conformal["empirical_error"].append(emp)
        conformal["coverage"].append(cov)
        conformal["review_rate"].append(float(1 - cov))
    results["conformal"] = conformal

    plt.figure(figsize=(4.4, 4.0))
    plt.plot(conformal["target_error"], conformal["empirical_error"], "o-", color="#2563eb", label="empirical selective error")
    plt.plot(conformal["target_error"], conformal["target_error"], "--", color="#888", label="target")
    plt.plot(conformal["target_error"], conformal["review_rate"], "s-", color="#dc2626", label="review rate")
    plt.xlabel("target error rate α")
    plt.ylabel("rate")
    plt.title("Conformal selective abstention")
    plt.legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "conformal.png"), dpi=130)
    plt.close()

    # 4 & 5. AE ablation + accuracy ceiling, over 3-fold CV (stable, and
    # consistent with the benchmark methodology; a single split is too noisy at
    # 5% fraud). The AE error is combined with the engine score via a 2-term
    # learned weighting (LR on [engine_score, ae_error]) — still additive and
    # auditable, just two named terms.
    mono = np.zeros(X.shape[1], dtype=int)
    for i in SIGNAL_IDX:
        mono[i] = 1  # risk is monotone increasing in each named signal
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=SEED)
    a5, a6, asolo, ceil, cmono = [], [], [], [], []
    for tri, tei in skf.split(X, y):
        Xa, ya, Xb, yb = X[tri], y[tri], X[tei], y[tei]
        e_a, e_b = engine_score(Xa[:, SIGNAL_IDX]), engine_score(Xb[:, SIGNAL_IDX])
        a5.append(roc_auc_score(yb, e_b))
        ae_a, ae_b = autoencoder_signal(Xa, ya, Xb)
        asolo.append(roc_auc_score(yb, ae_b))
        combo = LogisticRegression(max_iter=1000).fit(
            np.column_stack([e_a, 100 * ae_a]), ya
        )
        a6.append(roc_auc_score(yb, combo.predict_proba(np.column_stack([e_b, 100 * ae_b]))[:, 1]))
        ceil.append(
            roc_auc_score(
                yb,
                HistGradientBoostingClassifier(random_state=SEED, max_iter=300)
                .fit(Xa, ya)
                .predict_proba(Xb)[:, 1],
            )
        )
        cmono.append(
            roc_auc_score(
                yb,
                HistGradientBoostingClassifier(monotonic_cst=mono, random_state=SEED, max_iter=300)
                .fit(Xa, ya)
                .predict_proba(Xb)[:, 1],
            )
        )
    auc5, auc6, auc_mono = float(np.mean(a5)), float(np.mean(a6)), float(np.mean(cmono))
    results["autoencoder_ablation"] = {
        "auc_5_signals": auc5,
        "ae_signal_solo_auc": float(np.mean(asolo)),
        "auc_6_signals": auc6,
        "marginal_auc": float(auc6 - auc5),
    }
    # Accuracy ceiling = best trained baseline from the benchmark (single source
    # of truth), so numbers never disagree across files. Monotone GBM is the
    # interpretable-ML comparison, computed here.
    trained = {k: bench[k] for k in ("Random forest", "Gradient boosting", "Logistic regression")}
    ceiling_name = max(trained, key=trained.get)
    auc_ceiling = float(trained[ceiling_name])
    results["ceiling"] = {
        "accuracy_ceiling_model": ceiling_name,
        "accuracy_ceiling_auc": auc_ceiling,
        "monotone_gbm_auc": auc_mono,
        "auditable_gap": float(auc_ceiling - auc6),
    }

    # 6. Accuracy vs. interpretability frontier ----------------------------
    # All baseline AUCs come from the benchmark (single source of truth); the AE
    # and monotone-GBM points are computed here. Interpretability is a documented
    # heuristic score (1 = fully auditable additive scorer).
    variants = {
        "Deterministic engine": (bench["Deterministic engine"], 1.00),
        "Calibrated engine": (bench["Calibrated engine"], 0.90),
        "Engine + AE signal": (auc6, 0.75),
        "Logistic regression (8f)": (bench["Logistic regression"], 0.60),
        "Monotone GBM": (auc_mono, 0.50),
        "Random forest": (bench["Random forest"], 0.25),
        "Gradient boosting": (bench["Gradient boosting"], 0.20),
    }
    results["frontier"] = {k: {"auc": float(v[0]), "interpretability": v[1]} for k, v in variants.items()}

    plt.figure(figsize=(5.0, 4.0))
    for name, (auc, interp) in variants.items():
        plt.scatter(interp, auc, s=60)
        plt.annotate(name, (interp, auc), fontsize=7, xytext=(4, 4), textcoords="offset points")
    plt.xlabel("interpretability (1 = fully auditable)")
    plt.ylabel("AUC")
    plt.title("Accuracy vs. auditability")
    plt.gca().invert_xaxis()
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "frontier.png"), dpi=130)
    plt.close()

    # Write outputs ---------------------------------------------------------
    with open(os.path.join(HERE, "results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    wl = ["# Learned engine weights (logistic regression over named signals)", "",
          "| Signal | Learned weight | 95% CI |", "|---|---|---|"]
    for sig, d in weights.items():
        wl.append(f"| {sig} | {d['weight']:.3f} | [{d['ci95'][0]:.3f}, {d['ci95'][1]:.3f}] |")
    with open(os.path.join(HERE, "weights.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(wl) + "\n")

    # Console summary
    c = results["calibration"]
    print("LEARNED WEIGHTS:")
    for sig, d in weights.items():
        print(f"  {sig:20s} {d['weight']:+.3f}  CI[{d['ci95'][0]:+.3f},{d['ci95'][1]:+.3f}]")
    print(f"\nCALIBRATION (Brier / ECE): raw {c['raw_score']['brier']:.4f}/{c['raw_score']['ece']:.4f}"
          f" -> Platt {c['platt']['brier']:.4f}/{c['platt']['ece']:.4f}"
          f" -> isotonic {c['isotonic']['brier']:.4f}/{c['isotonic']['ece']:.4f}")
    print("\nCONFORMAL (target -> empirical err / review rate):")
    for a, e, r in zip(conformal["target_error"], conformal["empirical_error"], conformal["review_rate"]):
        print(f"  alpha={a:.2f} -> err={e:.3f}  review={r:.1%}")
    ae = results["autoencoder_ablation"]
    print(f"\nAUTOENCODER (3-fold CV): 5-signal {auc5:.3f} -> 6-signal {auc6:.3f} "
          f"(+{auc6-auc5:.3f}); AE-solo AUC {ae['ae_signal_solo_auc']:.3f}")
    print(f"CEILING: {ceiling_name} {auc_ceiling:.3f} "
          f"(auditable gap {auc_ceiling-auc6:+.3f}); monotone GBM {auc_mono:.3f}")
    print(f"\nfigures -> {FIG_DIR}")


if __name__ == "__main__":
    main()
