import type { ScoredRecord } from '../lib/store';
import type { RiskBand } from '../lib/fraud-engine';

const BAND_COLOR: Record<RiskBand, string> = {
  low: '#34d399',
  medium: '#fbbf24',
  high: '#f87171',
};
const BAND_RANK: Record<RiskBand, number> = { low: 0, medium: 1, high: 2 };

interface Node {
  lat: number;
  lon: number;
  count: number;
  band: RiskBand;
  country: string | null;
}

/**
 * Equirectangular world scatter of transaction ORIGINS (by IP geolocation),
 * sized by count and colored by worst band at that location. Pure inline SVG —
 * no tiles, no external lib — so it renders offline.
 */
export default function GeoPanel({ records }: { records: ScoredRecord[] }) {
  const byLoc = new Map<string, Node>();
  for (const r of records) {
    const { lat, lon, country } = r.enrichment.ip;
    if (lat == null || lon == null) continue;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const node = byLoc.get(key) ?? { lat, lon, count: 0, band: 'low' as RiskBand, country };
    node.count += 1;
    if (BAND_RANK[r.result.band] > BAND_RANK[node.band]) node.band = r.result.band;
    byLoc.set(key, node);
  }
  const nodes = [...byLoc.values()];
  const project = (lat: number, lon: number) => ({ x: lon + 180, y: 90 - lat });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Transaction Origins
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          {(['low', 'medium', 'high'] as RiskBand[]).map((b) => (
            <span key={b} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: BAND_COLOR[b] }} />
              {b}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 360 180"
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label="World map of transaction origins"
        >
          <rect x="0" y="0" width="360" height="180" fill="#0b1220" rx="4" />
          {/* graticule */}
          {[30, 60, 90, 120, 150, 210, 240, 270, 300, 330].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="180" stroke="#1e293b" strokeWidth="0.4" />
          ))}
          {[45, 90, 135].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="360" y2={y} stroke="#1e293b" strokeWidth="0.4" />
          ))}
          <line x1="180" y1="0" x2="180" y2="180" stroke="#334155" strokeWidth="0.5" />
          <line x1="0" y1="90" x2="360" y2="90" stroke="#334155" strokeWidth="0.5" />
          {nodes.map((n, i) => {
            const { x, y } = project(n.lat, n.lon);
            const r = 1.6 + Math.min(4, Math.sqrt(n.count));
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={BAND_COLOR[n.band]}
                  fillOpacity={0.75}
                  stroke="#0b1220"
                  strokeWidth="0.4"
                />
                {n.country ? (
                  <text x={x + r + 1} y={y + 2} fontSize="4.5" fill="#94a3b8">
                    {n.country}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {nodes.length === 0
          ? 'No geolocated origins yet — let the stream run.'
          : `${nodes.length} distinct origin${nodes.length === 1 ? '' : 's'} from ${records.length} recent transactions.`}
      </p>
    </div>
  );
}
