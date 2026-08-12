import type { SignalContribution } from '../lib/fraud-engine';

const SIGNAL_LABELS: Record<string, string> = {
  'amount-anomaly': 'Amount anomaly',
  'new-country': 'New country',
  velocity: 'Velocity',
  'odd-hour': 'Odd hour',
  'bin-geo-mismatch': 'BIN / geo mismatch',
  'ip-geo-mismatch': 'IP / geo mismatch',
  'ip-anonymizer': 'Anonymizing network',
  'email-risk': 'Email risk',
  'impossible-travel': 'Impossible travel',
};

/**
 * Horizontal bar per signal showing its weighted point contribution to the
 * score — the score visibly decomposing into named signals (DR2).
 */
export default function SignalBars({
  contributions,
  score,
}: {
  contributions?: SignalContribution[];
  score: number;
}) {
  if (!contributions || contributions.length === 0) {
    return <p className="text-xs text-slate-500">No signals contributed to this score.</p>;
  }
  const sorted = [...contributions].sort((a, b) => b.points - a.points);
  const max = Math.max(...sorted.map((c) => c.points), 1);
  const sum = sorted.reduce((acc, c) => acc + c.points, 0);

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((c) => (
        <div key={`${c.signal}-${c.reason}`}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300">{SIGNAL_LABELS[c.signal] ?? c.signal}</span>
            <span className="tabular-nums text-slate-400">+{c.points}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-500"
              style={{ width: `${(c.points / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <p className="mt-1 text-[11px] text-slate-500">
        Signals sum to {sum}
        {sum > 100 ? `, capped at 100` : ''} → score <span className="tabular-nums">{score}</span>.
      </p>
    </div>
  );
}
