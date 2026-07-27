/**
 * SentinelFraud — geo distance / impossible-travel helpers.
 *
 * Pure and network-free. Computes great-circle distance between two points
 * and the implied travel speed between a user's consecutive transactions.
 * The engine's impossible-travel signal consumes `impliedTravel()` output.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface TravelEstimate {
  distanceKm: number;
  elapsedMinutes: number;
  /** Implied average speed in km/h to cover the distance in the elapsed time. */
  impliedKmh: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two lat/lon points, in kilometers. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Implied travel between a user's previous and current transaction locations.
 * Returns null when either location is unknown or time did not advance
 * (so a missing/degenerate reading never fabricates a fraud signal).
 */
export function impliedTravel(
  prev: (GeoPoint & { timestamp: number }) | null,
  curr: GeoPoint & { timestamp: number },
): TravelEstimate | null {
  if (!prev) return null;
  const elapsedMs = curr.timestamp - prev.timestamp;
  if (elapsedMs <= 0) return null;

  const distanceKm = haversineKm(prev, curr);
  const elapsedMinutes = elapsedMs / 60_000;
  const impliedKmh = distanceKm / (elapsedMs / 3_600_000);
  return {
    distanceKm: Math.round(distanceKm),
    elapsedMinutes: Math.round(elapsedMinutes),
    impliedKmh: Math.round(impliedKmh),
  };
}
