'use client';

import { useEffect, useState } from 'react';
import type { ScoredRecord } from '../lib/store';
import { formatMoney, formatTimeUtc } from '../lib/format';
import RiskBadge from './RiskBadge';

interface ExplainResponse {
  transactionId: string;
  explanation: string;
  source: 'gemini' | 'template';
}

const SCORE_TONE = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-red-400',
} as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

export default function DetailPanel({
  record,
  onClose,
}: {
  record: ScoredRecord;
  onClose: () => void;
}) {
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState(false);
  const { transaction: tx, result, enrichment } = record;

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: tx.id, transaction: tx }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: ExplainResponse) => setExplain(data))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setError(true);
      });
    return () => controller.abort();
  }, [tx]);

  return (
    <aside className="flex w-full flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/80 p-5 lg:w-96 lg:shrink-0">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Alert Detail
          </h2>
          <p className="mt-1 font-mono text-xs text-slate-500">{tx.id}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Close
        </button>
      </div>

      <div className="flex items-center gap-4">
        <span className={`text-4xl font-bold tabular-nums ${SCORE_TONE[result.band]}`}>
          {result.score}
        </span>
        <div className="flex flex-col gap-1">
          <RiskBadge band={result.band} />
          <span className="text-xs text-slate-500">risk score / 100</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Amount" value={formatMoney(tx.amount, tx.currency)} />
        <Field label="Time" value={formatTimeUtc(tx.timestamp)} />
        <Field label="User" value={tx.userId} />
        <Field label="Country" value={tx.country} />
        <Field label="Merchant" value={tx.merchant} />
        <Field label="Category" value={tx.category} />
        <Field label="Card BIN" value={tx.cardBin} />
        <Field
          label="Issuer"
          value={`${enrichment.bank}${enrichment.country ? ` (${enrichment.country})` : ''}`}
        />
      </dl>

      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500">Signal Reasons</h3>
        {result.reasons.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No individual signals fired.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {result.reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-md border border-slate-700/80 bg-slate-800/60 px-2.5 py-1.5 font-mono text-xs text-slate-300"
              >
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-slate-500">
            Analyst Explanation
          </h3>
          {explain ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                explain.source === 'gemini'
                  ? 'bg-sky-500/10 text-sky-400 ring-sky-500/30'
                  : 'bg-slate-700/40 text-slate-300 ring-slate-600'
              }`}
            >
              {explain.source === 'gemini' ? 'Gemini' : 'Rule-based fallback'}
            </span>
          ) : null}
        </div>
        <div className="mt-2 rounded-lg border border-slate-700/80 bg-slate-800/40 p-3 text-sm leading-relaxed text-slate-200">
          {error ? (
            <span className="text-slate-400">
              Explanation unavailable. Try reopening the alert.
            </span>
          ) : explain ? (
            explain.explanation
          ) : (
            <span className="animate-pulse text-slate-400">Generating explanation…</span>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          AI-assisted summary of engine signals — verify before acting. High-risk alerts require
          analyst confirmation before any account action is taken.
        </p>
      </div>
    </aside>
  );
}
