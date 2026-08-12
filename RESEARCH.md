# RESEARCH.md — reproducing the paper's claims

Every empirical claim in the SentinelFraud paper maps to a script or test in
this repo. All randomness is seeded: the benchmark/model use `SEED = 20240501`
(`benchmark/config.py`); the synthetic transaction stream uses
`DEFAULT_SEED = 20260717` (`lib/generator.ts`). Results regenerate exactly.

## One-shot reproduction

```bash
npm ci
npm test                       # 81 unit tests incl. engine, parity, HITL, red-team
npm run redteam                # security/redteam-results.json (injection rate 0)
pip install -r benchmark/requirements.txt
npm run parity                 # benchmark engine == lib/fraud-engine.ts
npm run benchmark              # benchmark/results.{json,md} + figures/figure2.png  (Table 2, Fig 2)
npm run model:eval             # model/results.json + weights.md + figures/*.png    (calibration, conformal, frontier)
```

## Claim → artifact map

| Paper claim                                                     | Reproduced by                                                                                            | Key result                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **DR1** — deterministic, usable with no labels                  | `benchmark/run.py` (reproducibility), `tests/fraud-engine.test.ts` ("is deterministic")                  | engine AUC SD **0.0000**, flagged-set shift **0%** vs random forest **13.5%**                            |
| **DR2** — every point traces to a named signal                  | `RiskResult.contributions` (`lib/fraud-engine.ts`), `components/SignalBars.tsx`, `model/weights.md`      | score decomposes into per-signal points; learned weights table                                           |
| **DR3** — explanations that never gate the decision             | `lib/explain.ts`, `tests/explain.test.ts`                                                                | Gemini + deterministic template fallback; decision is always the engine's                                |
| **DR4** — agent-callable, identical to dashboard                | `mcp-server/` (stdio + remote), `tests/redteam.test.ts` (parity), `security/redteam.ts`                  | engine == dashboard store == MCP tools (parity `true`)                                                   |
| **DR5** — injection/tool-poisoning safe; human approves actions | `security/redteam.ts`, `lib/cases.ts`, `tests/cases.test.ts`, `mcp-server/tools.ts` (`EXPOSE_RAW_SCORE`) | injection success rate **0/9**; case state machine + audit log; raw score withheld across trust boundary |
| **H1** — engine wins under label scarcity                       | `benchmark/run.py` (`cold_start`)                                                                        | engine leads all trained models until **~25** fraud labels                                               |
| **Table 2** — accuracy comparison                               | `npm run benchmark` → `benchmark/results.md`                                                             | engine 0.753, calibrated 0.768, RF 0.783, GBM 0.784, LR 0.803 (3-fold CV)                                |
| **Figure 2** — cold-start + AUC-by-model                        | `benchmark/make_figures.py` → `benchmark/figures/figure2.png`                                            | —                                                                                                        |
| **§4 red-team** — injection defense                             | `npm run redteam` → `security/redteam-results.json`                                                      | 9 attacks, 0 changed, 0 explanation compromises, parity holds                                            |
| **Calibration** (glass-box gain)                                | `npm run model:eval` → `model/results.json`, `figures/reliability.png`                                   | Brier **0.235→0.045**, ECE **0.357→0.005** (Platt)                                                       |
| **Conformal abstention** (HITL guarantee)                       | `npm run model:eval` → `figures/conformal.png`                                                           | empirical selective error ≤ target; review rate rises as α tightens                                      |
| **Accuracy vs. auditability frontier**                          | `npm run model:eval` → `figures/frontier.png`                                                            | engine/calibrated-engine on the frontier; GBM/LR the accuracy ceiling                                    |

## Notes

- **Numbers are relative, on synthetic data.** The benchmark is synthetic by
  necessity (no public dataset carries the engine's named signals with labels).
  Real-data evaluation is future work; see `benchmark/README.md`.
- **The benchmark engine matches the shipped engine.** `benchmark/test_parity.py`
  fails CI if the Python benchmark weights drift from `lib/fraud-engine.ts`.
- The autoencoder extension (`model/train.py`) adds a bounded named signal; on
  this benchmark its marginal AUC is small (the signal is largely redundant with
  the named signals), reported honestly in `model/results.json`.
