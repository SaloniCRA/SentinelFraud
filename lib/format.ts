/** Client-safe formatting helpers for the dashboard. */

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** UTC clock time, matching the engine's UTC-based hour logic. */
export function formatTimeUtc(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(11, 19)}Z`;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
