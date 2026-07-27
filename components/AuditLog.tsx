'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry, CaseState } from '../lib/cases';
import { formatTimeUtc } from '../lib/format';

interface CasesResponse {
  audit: AuditEntry[];
  summary: { total: number; byState: Record<CaseState, number> };
}

const ACTION_TONE: Record<string, string> = {
  open: 'text-slate-400',
  begin_review: 'text-sky-400',
  confirm_fraud: 'text-red-400',
  dismiss: 'text-emerald-400',
};

function actionTone(action: string): string {
  if (action.startsWith('propose:')) return 'text-amber-400';
  return ACTION_TONE[action] ?? 'text-slate-300';
}

/**
 * Live audit trail of analyst decisions and agent proposals. Polls /api/cases
 * so it reflects Confirm/Dismiss actions and any MCP `propose_action` calls.
 * `refreshKey` lets the parent force an immediate refresh after an action.
 */
export default function AuditLog({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<CasesResponse | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetch('/api/cases', { signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((d: CasesResponse) => setData(d))
      .catch(() => {
        /* transient; keep last state */
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
  }, [load, refreshKey]);

  const summary = data?.summary;

  return (
    <aside className="flex w-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-5 lg:w-80 lg:shrink-0">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        Case Audit Log
      </h2>

      {summary ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <span className="rounded bg-slate-800/60 px-2 py-1 text-slate-300">
            Open <span className="font-semibold tabular-nums">{summary.byState.open}</span>
          </span>
          <span className="rounded bg-slate-800/60 px-2 py-1 text-sky-300">
            In review{' '}
            <span className="font-semibold tabular-nums">{summary.byState.analyst_review}</span>
          </span>
          <span className="rounded bg-slate-800/60 px-2 py-1 text-red-300">
            Confirmed{' '}
            <span className="font-semibold tabular-nums">{summary.byState.confirmed_fraud}</span>
          </span>
          <span className="rounded bg-slate-800/60 px-2 py-1 text-emerald-300">
            Dismissed{' '}
            <span className="font-semibold tabular-nums">{summary.byState.dismissed}</span>
          </span>
        </div>
      ) : null}

      <div className="max-h-[calc(100vh-20rem)] overflow-auto">
        {!data || data.audit.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            No case activity yet. Open a flagged alert and confirm or dismiss it.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.audit.map((entry, i) => (
              <li
                key={`${entry.transactionId}-${entry.at}-${i}`}
                className="rounded-md border border-slate-800 bg-slate-800/40 px-2.5 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold ${actionTone(entry.action)}`}>
                    {entry.action.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {formatTimeUtc(entry.at)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-slate-400">
                  <span className="font-mono">{entry.transactionId}</span>
                  <span className="text-slate-500">{entry.actor}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
