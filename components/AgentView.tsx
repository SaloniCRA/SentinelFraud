'use client';

import { useState } from 'react';
import type { ScoredRecord } from '../lib/store';

/**
 * Shows the EXACT JSON an MCP client receives for this transaction, making the
 * agent-callable thesis tangible. Toggling "authenticated" reveals the raw
 * score; unauthenticated callers (outside the merchant's trust boundary) get
 * band + reasons only — the threshold-oracle defense of Section 4.
 */
export default function AgentView({ record }: { record: ScoredRecord }) {
  const [authed, setAuthed] = useState(false);
  const { transaction, result } = record;

  const payload = authed
    ? {
        transactionId: transaction.id,
        score: result.score,
        band: result.band,
        reasons: result.reasons,
      }
    : { transactionId: transaction.id, band: result.band, reasons: result.reasons };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500">
          Agent view (MCP tool result)
        </h3>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={authed}
            onChange={(e) => setAuthed(e.target.checked)}
            className="h-3 w-3 accent-sky-500"
          />
          authenticated
        </label>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-700/80 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-300">
        {JSON.stringify(payload, null, 2)}
      </pre>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        {authed
          ? 'Authenticated merchant agent: full result including the raw score.'
          : 'Unauthenticated caller: band + reasons only — the raw score is withheld so the engine cannot be probed as a threshold oracle.'}
      </p>
    </div>
  );
}
