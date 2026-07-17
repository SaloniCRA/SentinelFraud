import { isFlagged } from '../lib/fraud-engine';
import type { ScoredRecord } from '../lib/store';
import { formatMoney, formatTimeUtc } from '../lib/format';
import RiskBadge from './RiskBadge';

const BAR_COLORS = { low: 'bg-emerald-400', medium: 'bg-amber-400', high: 'bg-red-400' } as const;

function ScoreCell({ score, band }: { score: number; band: keyof typeof BAR_COLORS }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="w-7 text-right tabular-nums">{score}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${BAR_COLORS[band]}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function TransactionTable({
  records,
  selectedId,
  onSelect,
}: {
  records: ScoredRecord[];
  selectedId: string | null;
  onSelect: (record: ScoredRecord) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="max-h-[calc(100vh-16rem)] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Merchant</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 text-right font-medium">Risk</th>
              <th className="px-4 py-3 font-medium">Band</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  Waiting for transactions…
                </td>
              </tr>
            ) : (
              records.map((record) => {
                const { transaction: tx, result } = record;
                const flagged = isFlagged(result);
                const rowTone =
                  result.band === 'high'
                    ? 'border-l-2 border-l-red-500 bg-red-500/[0.07] hover:bg-red-500/[0.12]'
                    : result.band === 'medium'
                      ? 'border-l-2 border-l-amber-500/70 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]'
                      : 'border-l-2 border-l-transparent hover:bg-slate-800/40';
                return (
                  <tr
                    key={tx.id}
                    onClick={flagged ? () => onSelect(record) : undefined}
                    title={flagged ? 'Open alert details' : undefined}
                    className={`row-enter border-b border-slate-800/60 ${rowTone} ${
                      flagged ? 'cursor-pointer' : ''
                    } ${selectedId === tx.id ? 'ring-1 ring-inset ring-sky-500/60' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">
                      {formatTimeUtc(tx.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{tx.userId}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-slate-200">{tx.merchant}</span>
                      <span className="ml-2 text-xs text-slate-500">{tx.category}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {formatMoney(tx.amount, tx.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{tx.country}</td>
                    <td className="px-4 py-2.5">
                      <ScoreCell score={result.score} band={result.band} />
                    </td>
                    <td className="px-4 py-2.5">
                      <RiskBadge band={result.band} />
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
