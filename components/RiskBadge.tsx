import type { RiskBand } from '../lib/fraud-engine';

/**
 * Band badge — status color plus a text label and dot, so state is never
 * conveyed by color alone.
 */
const BADGE_STYLES: Record<RiskBand, { chip: string; dot: string }> = {
  low: { chip: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30', dot: 'bg-emerald-400' },
  medium: { chip: 'bg-amber-500/10 text-amber-400 ring-amber-500/30', dot: 'bg-amber-400' },
  high: { chip: 'bg-red-500/10 text-red-400 ring-red-500/30', dot: 'bg-red-400' },
};

export default function RiskBadge({ band }: { band: RiskBand }) {
  const style = BADGE_STYLES[band];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${style.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {band}
    </span>
  );
}
