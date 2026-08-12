import { formatPercent } from '../lib/format';

export interface TrendPoint {
  flaggedRate: number;
  avgRisk: number;
}

function Sparkline({ values, max, color }: { values: number[]; max: number; color: string }) {
  const W = 300;
  const H = 60;
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full">
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="10" fill="#64748b">
          collecting…
        </text>
      </svg>
    );
  }
  const step = W / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 6) - 3).toFixed(1)}`)
    .join(' ');
  const area = `0,${H} ${pts} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none">
      <polygon points={area} fill={color} fillOpacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

/** Session time-series of flagged rate and average risk. */
export default function TrendsPanel({ series }: { series: TrendPoint[] }) {
  const flagged = series.map((p) => p.flaggedRate);
  const risk = series.map((p) => p.avgRisk);
  const latest = series[series.length - 1];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Flagged rate
          </h3>
          <span className="text-lg font-semibold tabular-nums text-red-400">
            {latest ? formatPercent(latest.flaggedRate) : '—'}
          </span>
        </div>
        <div className="mt-2">
          <Sparkline values={flagged} max={Math.max(0.2, ...flagged)} color="#f87171" />
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Average risk
          </h3>
          <span className="text-lg font-semibold tabular-nums text-amber-400">
            {latest ? latest.avgRisk.toFixed(1) : '—'}
          </span>
        </div>
        <div className="mt-2">
          <Sparkline values={risk} max={100} color="#fbbf24" />
        </div>
      </div>
    </div>
  );
}
