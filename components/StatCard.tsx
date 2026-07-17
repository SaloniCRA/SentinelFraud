/** Stat tile: hero number with a recessive label, per SOC dashboard idiom. */
export default function StatCard({
  label,
  value,
  sub,
  accent = 'text-slate-100',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}
