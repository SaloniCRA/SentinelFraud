# SentinelFraud

Real-time fraud detection dashboard — a production-grade demo of a fintech SOC tool.
A deterministic rule engine scores a live stream of synthetic transactions, Google
Gemini writes plain-English alert explanations, and the same engine is exposed to
MCP clients (e.g. Claude Desktop) via a custom MCP server.

## Quickstart

```bash
npm install
cp .env.example .env.local   # optional — the app runs fully without a key
npm run dev                  # http://localhost:3000
```

`GEMINI_API_KEY` is the only key the project can use, and it is **optional**: with
no key (or any Gemini failure/rate limit) explanations fall back to a deterministic
template built from the engine's signal reasons.

## Scripts

| Script                 | What it does                                             |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Streaming dashboard at http://localhost:3000             |
| `npm test`             | Vitest unit tests (engine, generator, BIN, explanations) |
| `npm run build`        | Production Next.js build                                 |
| `npm run mcp`          | Start the MCP server on stdio                            |
| `npm run lint`         | ESLint over app, components, lib, mcp-server, tests      |
| `npm run format:check` | Prettier check (CI gate); `npm run format` to fix        |
| `npm run typecheck`    | `tsc --noEmit`                                           |

## Architecture

```
                       ┌────────────────────────────┐
  binlist.net (free) ──► lib/bin-lookup.ts (cached) │
                       └─────────────┬──────────────┘
                                     ▼
 lib/generator.ts ──► lib/store.ts ──► lib/fraud-engine.ts (pure, deterministic)
  (seeded PRNG)        (in-memory)          │
                                            ▼
        ┌──────────────────┬────────────────┴────────────┐
        ▼                  ▼                             ▼
 POST /api/score    POST /api/explain ──► lib/explain.ts (Gemini + template)
        │                  │
        └──── app/ dashboard (polls every ~1.5s) ────────┘

 mcp-server/index.ts imports the SAME lib/ modules and exposes them as MCP tools.
```

- **`lib/fraud-engine.ts`** — pure scoring module. Five weighted signals (amount
  z-score anomaly, new country, velocity, odd hour, BIN/geo mismatch) produce a
  0–100 score, a `low`/`medium`/`high` band, and machine-readable reasons. All
  thresholds live in the `CONFIG` object at the top of the file.
- **`lib/generator.ts`** — 8 seeded users with baselines; seedable PRNG
  (mulberry32) makes every run reproducible. ~10% of transactions are fraudulent:
  large amounts, foreign countries, card-testing bursts, 3am timestamps.
- **`lib/bin-lookup.ts`** — free `lookup.binlist.net` enrichment (issuing bank +
  country), cached in-memory by BIN. Any failure returns
  `{ bank: 'Unknown', country: null }`; it never throws.
- **`lib/explain.ts`** — Gemini (`gemini-2.5-flash`) explanations with a
  deterministic template fallback, cached by transaction id.
- **Dashboard** — `/` streams scored transactions into a live table (new row every
  ~1.5s), stat cards on top, and a detail panel with signals + AI explanation for
  flagged (medium/high) rows.
- **MCP server** — `mcp-server/index.ts` (stdio) exposes `score_transaction`,
  `list_flagged_transactions`, `explain_alert`, and `get_fraud_stats`.

## API routes

- `POST /api/score` — empty body: generate, enrich, and score the next stream
  transaction. With `{ "transaction": { ... } }`: strictly validate, then enrich
  and score the supplied transaction.
- `POST /api/explain` — `{ "transactionId": "txn-00042" }` (or a full
  `transaction` object) returns `{ explanation, source, score, band, reasons }`.
  `source` is `"gemini"` or `"template"`.

## MCP server for Claude Desktop

Add this to your `claude_desktop_config.json` (adjust the path if the repo lives
elsewhere), then restart Claude Desktop:

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

On macOS/Linux drop the `cmd`/`/c` wrapper and use
`"command": "npx", "args": ["tsx", "/path/to/SentinelFraud/mcp-server/index.ts"]`.

The MCP server automatically loads `.env.local` from the repo root, so if your
`GEMINI_API_KEY` lives there, no extra configuration is needed. Alternatively,
add `"env": { "GEMINI_API_KEY": "<your key>" }` to the server entry — an
explicit environment variable always takes precedence.

## Testing

`npm test` runs deterministic Vitest suites: normal transactions score low, huge
amounts score high, foreign countries add the right signal, velocity bursts flag,
scores stay within 0–100, the seeded generator reproduces identical batches, BIN
lookup never throws, and explanations fall back cleanly without a key. These tests
are the CI "Run Tests" gate.

## CI/CD

`.github/workflows/ci.yml` ("SentinelFraud CI/CD") mirrors a real pipeline graph:

```
code-quality ──► test ──────────┐
      └────────► security-scan ─┴─► build ──► deploy (main only)
```

1. **code-quality** — ESLint, Prettier check, `tsc --noEmit`
2. **test** — Vitest
3. **security-scan** — `npm audit --audit-level=high` + gitleaks secret scan
4. **build** — `next build`
5. **deploy** — Vercel CLI, only on `main`, using the `VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` repository secrets; prints the
   deployment URL to the logs and job summary.

Action versions are pinned and workflow `permissions` are minimal
(`contents: read`).

## Security & Governance

- **Prompt-injection defense (structured-fields-only prompting).** Prompts to
  Gemini are assembled exclusively from validated, structured fields. Free-text
  fields (merchant names) are allowlist-sanitized and length-capped before they
  can appear in a prompt, and the prompt instructs the model to treat field
  values as data, not instructions. Client-supplied `reasons` are never accepted:
  the server re-derives signals with its own engine before explaining. Model
  output is treated as untrusted display text — control characters stripped,
  length capped, rendered as plain text (never HTML).
- **Secret handling.** The only secret is `GEMINI_API_KEY`, read from environment
  variables (`.env.local` locally, GitHub/Vercel secrets in CI/CD). Nothing is
  hardcoded; `.gitignore` excludes all env files, and the CI gitleaks job scans
  history for accidental secrets.
- **Human-approval steps.** SentinelFraud is decision support, not an enforcement
  system: high-risk alerts explicitly require analyst confirmation before any
  account action (holds, blocks, cardholder contact) is taken. The UI reinforces
  this on every AI-assisted explanation.
- **Graceful error handling.** BIN lookup never throws (safe fallback + cache);
  Gemini failures, timeouts, and rate limits fall back to a deterministic
  template; the dashboard shows a reconnecting state and keeps working; MCP tool
  errors are returned as structured tool results rather than crashing the server.

## Notes & limitations

- State (stream history, stats, caches) is in-memory per process — perfect for a
  demo, replaced by a real store in production.
- The dashboard and the MCP server run separate stream instances; the MCP batch
  is deterministic (fixed seed + fixed genesis clock) so tool results are stable.
- binlist.net rate-limits aggressively; the cache keeps requests to a handful of
  distinct BINs, and failures degrade to `country: null` (the BIN/geo signal
  simply doesn't fire).
