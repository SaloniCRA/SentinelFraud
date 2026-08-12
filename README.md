# SentinelFraud

An **auditable, agent-callable fraud-detection platform**. A deterministic,
per-signal-decomposable rule engine scores a live transaction stream; Google
Gemini writes plain-English alert explanations (with a template fallback); the
**same engine** is exposed to AI agents over the Model Context Protocol — both a
local stdio server and an **authenticated remote server** — behind a trust
boundary; and every flagged transaction enters a **human-in-the-loop** case
workflow. A reproducible Python benchmark + learned/calibrated glass-box model
back the research claims.

> The scoring core is deliberately transparent. The contribution is the
> architecture: fraud detection an agent can call and a person can still audit,
> with authentication, a trust boundary, and human approval built in.

## Quickstart

```bash
npm install
cp .env.example .env.local   # optional — the app runs fully without any key
npm run dev                  # http://localhost:3000
```

`GEMINI_API_KEY` is optional (explanations fall back to a deterministic
template). `MCP_AUTH_TOKEN` is only needed for the remote MCP server.

## Scripts

| Script                                        | What it does                                                         |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                                 | SOC dashboard at http://localhost:3000 (Live / Cases / Map / Trends) |
| `npm test`                                    | Vitest unit tests (engine, enrichment, scoring, cases, red-team, …)  |
| `npm run build`                               | Production Next.js build                                             |
| `npm run mcp`                                 | Local stdio MCP server (Claude Desktop)                              |
| `npm run mcp:remote`                          | Authenticated remote MCP server (Streamable HTTP)                    |
| `npm run redteam`                             | Security red-team → `security/redteam-results.json`                  |
| `npm run benchmark`                           | Python benchmark → Table 2, Figure 2 (`benchmark/`)                  |
| `npm run model:eval`                          | Learned weights, calibration, conformal, frontier (`model/`)         |
| `npm run parity`                              | Assert the benchmark engine matches `lib/fraud-engine.ts`            |
| `npm run lint` / `format:check` / `typecheck` | CI quality gates                                                     |

## Architecture

```
        binlist.net        ip-api.com       bundled lists
             │                 │                 │
             ▼                 ▼                 ▼
      lib/enrichment/{bin, ip, email, geo}  ──►  EnrichmentBundle
                                                    │
 lib/generator.ts ─► lib/scoring.ts ─► lib/fraud-engine.ts  (pure, deterministic,
   (seeded PRNG)      (per-user state)   9 named signals)     per-signal breakdown
                          │
      ┌───────────────────┼───────────────────────────┬──────────────────┐
      ▼                   ▼                             ▼                  ▼
 app/ dashboard    POST /api/score            mcp-server/index.ts   mcp-server/remote.ts
 (Live/Cases/      POST /api/explain          (stdio, trusted)      (Streamable HTTP,
  Map/Trends)      GET/POST /api/cases        5 MCP tools           bearer auth + trust
                                                                     boundary, 5 MCP tools)
```

The dashboard, HTTP API, and both MCP servers import the **one** engine, so all
surfaces score identically (enforced by `tests/redteam.test.ts` parity).

## The engine (`lib/fraud-engine.ts`)

Pure and deterministic: `score(x) = min(100, Σ wᵢ·aᵢ(x))` over **nine** bounded
`[0,1]` named signals; every score returns a `contributions[]` breakdown so it
decomposes exactly into its signals. All weights/thresholds live in one `CONFIG`.

| #   | Signal            | Fires when                                     |
| --- | ----------------- | ---------------------------------------------- |
| 1   | amount anomaly    | z-score of amount vs the user's mean/stdev     |
| 2   | new country       | transaction country ≠ usual country            |
| 3   | velocity          | > N transactions in a short window             |
| 4   | odd hour          | far outside the user's active hours (UTC)      |
| 5   | BIN/geo mismatch  | card-issuing country ≠ transaction country     |
| 6   | IP/geo mismatch   | origin-IP country ≠ card country               |
| 7   | anonymizer        | origin IP is proxy / VPN / hosting             |
| 8   | email risk        | disposable or newly-seen email domain          |
| 9   | impossible travel | implied km/h between consecutive txns too high |

## Enrichment sources (all free / keyless)

| Source        | Module                    | Provides                                    | Terms / fallback                                                            |
| ------------- | ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| binlist.net   | `lib/enrichment/bin.ts`   | issuing bank + country                      | free, keyless; failure → `{bank:'Unknown', country:null}`                   |
| ip-api.com    | `lib/enrichment/ip.ts`    | IP country, lat/lon, proxy/VPN/hosting, ISP | free, keyless (non-commercial); demo IPs resolve offline; failure → neutral |
| bundled lists | `lib/enrichment/email.ts` | disposable / free email domains             | offline, deterministic                                                      |
| haversine     | `lib/enrichment/geo.ts`   | impossible-travel speed                     | pure, offline                                                               |

Every source has an in-memory cache, a timeout, and a safe fallback — none ever
throws, and a missing enrichment degrades to a neutral (non-fraud-biasing) value.

## MCP servers

Five tools: `score_transaction`, `list_flagged_transactions`, `explain_alert`,
`get_fraud_stats`, and `propose_action` (records an agent proposal for human
confirmation — never executes).

**Local (stdio)** for Claude Desktop — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sentinelfraud": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "tsx",
        "C:\\Users\\salbh\\Projects\\SentinelFraud\\mcp-server\\index.ts"
      ]
    }
  }
}
```

(macOS/Linux: `"command": "npx", "args": ["tsx", "/path/to/mcp-server/index.ts"]`.)
The stdio server is trusted and returns raw scores.

**Remote (authenticated)** — `npm run mcp:remote`, then connect any MCP client:

```
URL:    http://localhost:8848/mcp
Header: Authorization: Bearer <MCP_AUTH_TOKEN>   (defaults to "sentinel-dev-token" if unset)
```

The remote server rejects unauthenticated calls with **401**, rate-limits per
token, and by default returns **band + reasons only** (raw score withheld) so the
engine cannot be probed as a threshold oracle. To swap the bearer check for full
**OAuth 2.1**, put the server behind an OAuth-aware gateway (e.g. a Cloudflare
Workers OAuth provider or an API gateway) that validates the token and forwards
the request; the tool boundary and raw-score redaction stay unchanged. Set
`EXPOSE_RAW_SCORE=true` only for a trusted deployment.

## Benchmark & model (`benchmark/`, `model/`)

Reproducible Python (scikit-learn), seed `20240501`. `npm run benchmark`
regenerates Table 2 (five-system comparison, 3-fold CV), the cold-start curve,
and Figure 2. `npm run model:eval` adds the learned additive weights (logistic
regression over the named signals, with CIs), probability calibration
(Platt/isotonic, Brier + ECE + reliability diagram), a split-conformal
selective-abstention layer (coverage-guaranteed auto-decide vs. human-review),
a monotone-GBM interpretable variant, and the accuracy-vs-auditability frontier.
See `RESEARCH.md` for the full claim→script map, and `benchmark/README.md` for
the real-data (future-work) path.

## Testing & CI

`npm test` runs the deterministic Vitest suites (they gate CI). The GitHub
Actions pipeline (`.github/workflows/ci.yml`) mirrors a real graph:

```
code-quality ─► test ─► redteam ─┐
      └───────► security-scan ───┴─► build ─► deploy (main only)
```

- **code-quality** — ESLint, Prettier, `tsc --noEmit`
- **test** — Vitest (incl. dashboard/API/MCP parity)
- **redteam** — `npm run redteam` (fails if injection-success-rate > 0) + engine parity
- **security-scan** — `npm audit --audit-level=high` + gitleaks
- **build** — `next build`
- **deploy** — Vercel, `main` only. Action versions pinned; `permissions: contents: read`.

## Security & Governance

- **Authenticated agent boundary.** The remote MCP server requires a bearer
  token (401 otherwise), rate-limits callers, and hides the raw score across the
  trust boundary — "agent-callable" means _the merchant's own authenticated
  agent_, not the public. Full OAuth 2.1 slots in at the gateway.
- **Prompt-injection & tool-poisoning defense.** Gemini prompts are built only
  from validated, structured fields; free-text (merchant) is allow-list
  sanitized and length-capped; the server re-derives signals so a caller cannot
  inject a fake reason; model output is capped and rendered as plain text. The
  red-team (`npm run redteam`) confirms 0/9 injection success and no explanation
  compromise against the real engine.
- **Human-in-the-loop.** Flagged transactions open a case
  (`open → analyst_review → confirmed_fraud | dismissed`) with an append-only
  audit log; the `propose_action` MCP tool only records a suggestion — a person
  confirms any account action. Confirmed/dismissed outcomes become calibration
  labels.
- **Secret handling.** Only secrets are `GEMINI_API_KEY` and `MCP_AUTH_TOKEN`,
  read from env; `.gitignore` excludes all env files; CI gitleaks scans history.
- **Graceful failure.** Enrichment never throws; Gemini failures fall back to
  templates; MCP errors return structured results.

## Notes & limitations

- State is in-memory per process (demo); production needs a durable store.
- The benchmark is synthetic; its numbers are relative, not field performance.
  Real-data calibration and a human explanation study are future work.
