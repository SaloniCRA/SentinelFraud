'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FraudCase, CaseState } from '../lib/cases';
import RiskBadge from './RiskBadge';
import { formatMoney } from '../lib/format';

const STATE_LABEL: Record<CaseState, { text: string; chip: string }> = {
  open: { text: 'Open', chip: 'bg-slate-700/50 text-slate-300 ring-slate-600' },
  analyst_review: { text: 'In review', chip: 'bg-sky-500/10 text-sky-400 ring-sky-500/30' },
  confirmed_fraud: { text: 'Confirmed', chip: 'bg-red-500/10 text-red-400 ring-red-500/30' },
  dismissed: { text: 'Dismissed', chip: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30' },
};

/** Actionable queue of analyst cases with inline confirm / dismiss. */
export default function CaseQueue({ onCaseChange }: { onCaseChange?: () => void }) {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetch('/api/cases', { signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: { cases: FraudCase[] }) => setCases(d.cases))
      .catch(() => {
        /* transient */
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), 3_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const decide = (transactionId: string, action: 'confirm' | 'dismiss') => {
    setBusy(transactionId);
    fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, action }),
    })
      .then(() => {
        load();
        onCaseChange?.();
      })
      .finally(() => setBusy(null));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="max-h-[calc(100vh-16rem)] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Band</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  No cases yet. Flagged transactions open a case automatically.
                </td>
              </tr>
            ) : (
              cases.map((c) => {
                const decided = c.state === 'confirmed_fraud' || c.state === 'dismissed';
                return (
                  <tr key={c.transactionId} className="border-b border-slate-800/60">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                      {c.transactionId}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{c.userId}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {formatMoney(c.amount, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">
                      {c.score}
                    </td>
                    <td className="px-4 py-2.5">
                      <RiskBadge band={c.band} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${STATE_LABEL[c.state].chip}`}
                      >
                        {STATE_LABEL[c.state].text}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {decided ? (
                        <span className="block text-right text-xs text-slate-500">—</span>
                      ) : (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => decide(c.transactionId, 'confirm')}
                            disabled={busy === c.transactionId}
                            className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/25 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => decide(c.transactionId, 'dismiss')}
                            disabled={busy === c.transactionId}
                            className="rounded-md bg-slate-700/40 px-2 py-1 text-xs font-semibold text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700/70 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
