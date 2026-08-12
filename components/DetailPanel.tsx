'use client';

import { useEffect, useState } from 'react';
import type { ScoredRecord } from '../lib/store';
import type { CaseState } from '../lib/cases';
import { formatMoney, formatTimeUtc } from '../lib/format';
import RiskBadge from './RiskBadge';
import SignalBars from './SignalBars';
import AgentView from './AgentView';

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

const CASE_LABELS: Record<CaseState, { text: string; chip: string }> = {
  open: { text: 'Open', chip: 'bg-slate-700/50 text-slate-300 ring-slate-600' },
  analyst_review: { text: 'In review', chip: 'bg-sky-500/10 text-sky-400 ring-sky-500/30' },
  confirmed_fraud: { text: 'Confirmed fraud', chip: 'bg-red-500/10 text-red-400 ring-red-500/30' },
  dismissed: { text: 'Dismissed', chip: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30' },
};

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
  onCaseChange,
}: {
  record: ScoredRecord;
  onClose: () => void;
  onCaseChange?: () => void;
}) {
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState(false);
  const [caseState, setCaseState] = useState<CaseState | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  // Opening the panel moves the case into analyst_review (and tells us its
  // current state if it was already decided).
  useEffect(() => {
    // The parent keys this panel by transaction id, so it remounts per
    // selection and caseState starts fresh — no manual reset needed here.
    const controller = new AbortController();
    fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: tx.id, action: 'review' }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { case: { state: CaseState } }) => setCaseState(data.case.state))
      .catch(() => {
        /* no server case (e.g. non-flagged) — decision controls stay hidden */
      });
    return () => controller.abort();
  }, [tx.id]);

  const decide = (action: 'confirm' | 'dismiss') => {
    setSubmitting(true);
    fetch('/api/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: tx.id, action }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { case: { state: CaseState } }) => {
        setCaseState(data.case.state);
        onCaseChange?.();
      })
      .catch(() => setError(true))
      .finally(() => setSubmitting(false));
  };

  const decided = caseState === 'confirmed_fraud' || caseState === 'dismissed';

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
        {caseState ? (
          <span
            className={`ml-auto self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${CASE_LABELS[caseState].chip}`}
          >
            {CASE_LABELS[caseState].text}
          </span>
        ) : null}
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
          value={`${enrichment.bin.bank}${enrichment.bin.country ? ` (${enrichment.bin.country})` : ''}`}
        />
        {enrichment.ip.country || tx.ip ? (
          <Field
            label="Origin IP"
            value={`${tx.ip ?? 'unknown'}${enrichment.ip.country ? ` · ${enrichment.ip.country}` : ''}${
              enrichment.ip.anonymized ? ' · proxy/VPN' : ''
            }${enrichment.ip.isp ? ` · ${enrichment.ip.isp}` : ''}`}
          />
        ) : null}
        {enrichment.email.domain ? (
          <Field
            label="Email domain"
            value={`${enrichment.email.domain}${
              enrichment.email.disposable
                ? ' · disposable'
                : enrichment.email.freeProvider
                  ? ' · free provider'
                  : ''
            }`}
          />
        ) : null}
      </dl>

      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500">
          Signal Contributions
        </h3>
        <div className="mt-2">
          <SignalBars contributions={result.contributions} score={result.score} />
        </div>
        {result.reasons.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {result.reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-md border border-slate-700/80 bg-slate-800/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-300"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
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
      </div>

      <AgentView record={record} />

      <div className="mt-auto border-t border-slate-800 pt-4">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500">Analyst Decision</h3>
        {decided ? (
          <p className="mt-2 text-sm text-slate-300">
            Case {caseState === 'confirmed_fraud' ? 'confirmed as fraud' : 'dismissed'} by analyst.
            No further action pending.
          </p>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => decide('confirm')}
                disabled={submitting}
                className="flex-1 rounded-md bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm Fraud
              </button>
              <button
                onClick={() => decide('dismiss')}
                disabled={submitting}
                className="flex-1 rounded-md bg-slate-700/40 px-3 py-2 text-sm font-semibold text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              AI-assisted summary of engine signals — verify before acting. A confirm/dismiss
              decision is required from a human analyst before any account action (hold, block,
              cardholder contact) is taken.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
