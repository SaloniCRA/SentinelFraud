'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScoredRecord } from '../lib/store';
import { isFlagged } from '../lib/fraud-engine';
import { formatPercent } from '../lib/format';
import StatCard from './StatCard';
import TransactionTable from './TransactionTable';
import DetailPanel from './DetailPanel';
import AuditLog from './AuditLog';
import CaseQueue from './CaseQueue';
import GeoPanel from './GeoPanel';
import TrendsPanel, { type TrendPoint } from './TrendsPanel';

const POLL_INTERVAL_MS = 1_500;
const MAX_TABLE_ROWS = 60;
const MAX_SERIES = 120;

type View = 'live' | 'cases' | 'map' | 'trends';
const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'cases', label: 'Cases' },
  { id: 'map', label: 'Map' },
  { id: 'trends', label: 'Trends' },
];

interface Totals {
  count: number;
  flagged: number;
  scoreSum: number;
}

export default function Dashboard() {
  const [records, setRecords] = useState<ScoredRecord[]>([]);
  const [totals, setTotals] = useState<Totals>({ count: 0, flagged: 0, scoreSum: 0 });
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [selected, setSelected] = useState<ScoredRecord | null>(null);
  const [view, setView] = useState<View>('live');
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(true);
  const [caseRefresh, setCaseRefresh] = useState(0);
  const inFlight = useRef(false);
  const totalsRef = useRef(totals);

  const ingest = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/score', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const record = (await res.json()) as ScoredRecord;
      const next: Totals = {
        count: totalsRef.current.count + 1,
        flagged: totalsRef.current.flagged + (isFlagged(record.result) ? 1 : 0),
        scoreSum: totalsRef.current.scoreSum + record.result.score,
      };
      totalsRef.current = next;
      setRecords((prev) => [record, ...prev].slice(0, MAX_TABLE_ROWS));
      setTotals(next);
      setSeries((s) =>
        [
          ...s,
          { flaggedRate: next.flagged / next.count, avgRisk: next.scoreSum / next.count },
        ].slice(-MAX_SERIES),
      );
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => void ingest(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, ingest]);

  const stats = useMemo(
    () => ({
      total: totals.count,
      flagged: totals.flagged,
      flaggedRate: totals.count === 0 ? 0 : totals.flagged / totals.count,
      avgRisk: totals.count === 0 ? 0 : totals.scoreSum / totals.count,
    }),
    [totals],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-sky-400" fill="currentColor" aria-hidden>
            <path d="M12 2 4 5.5v5.1c0 5 3.4 9.7 8 11.4 4.6-1.7 8-6.4 8-11.4V5.5L12 2Zm0 2.2 6 2.6v3.8c0 4-2.6 7.9-6 9.4-3.4-1.5-6-5.4-6-9.4V6.8l6-2.6Zm-1 10.3-2.3-2.3-1.4 1.4L11 17.3l6-6-1.4-1.4-4.6 4.6Z" />
          </svg>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              SentinelFraud
              <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-slate-400">
                demo
              </span>
            </h1>
            <p className="text-xs text-slate-500">Real-time transaction risk monitoring</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className={`h-2 w-2 rounded-full ${
                !connected ? 'bg-red-400' : paused ? 'bg-slate-500' : 'animate-pulse bg-emerald-400'
              }`}
              aria-hidden
            />
            {!connected ? 'Reconnecting' : paused ? 'Paused' : 'Live'}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            {paused ? 'Resume stream' : 'Pause stream'}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Summary statistics">
        <StatCard label="Total Transactions" value={stats.total.toLocaleString('en-US')} />
        <StatCard
          label="Flagged"
          value={stats.flagged.toLocaleString('en-US')}
          sub="medium + high risk"
          accent={stats.flagged > 0 ? 'text-red-400' : 'text-slate-100'}
        />
        <StatCard label="Flagged Rate" value={formatPercent(stats.flaggedRate)} />
        <StatCard label="Average Risk" value={stats.avgRisk.toFixed(1)} sub="score / 100" />
      </section>

      <nav
        className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
        aria-label="Views"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-current={view === v.id}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              view === v.id
                ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view === 'live' ? (
        <main className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <TransactionTable
              records={records}
              selectedId={selected?.transaction.id ?? null}
              onSelect={setSelected}
            />
          </div>
          {selected ? (
            <DetailPanel
              key={selected.transaction.id}
              record={selected}
              onClose={() => setSelected(null)}
              onCaseChange={() => setCaseRefresh((n) => n + 1)}
            />
          ) : null}
        </main>
      ) : null}

      {view === 'cases' ? (
        <main className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <CaseQueue onCaseChange={() => setCaseRefresh((n) => n + 1)} />
          </div>
          <AuditLog refreshKey={caseRefresh} />
        </main>
      ) : null}

      {view === 'map' ? <GeoPanel records={records} /> : null}

      {view === 'trends' ? <TrendsPanel series={series} /> : null}
    </div>
  );
}
