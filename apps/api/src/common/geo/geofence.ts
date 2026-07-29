const EARTH_RADIUS_METERS = 6_371_000;

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points, in meters, via the haversine
 * formula. Earth modeled as a sphere (mean radius) — sub-meter ellipsoid
 * accuracy isn't needed for "is this employee near their branch." See
 * DECISIONS.md.
 */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/** Inclusive boundary — a point exactly `radiusMeters` away counts as within. */
export function isWithinGeofence(
  point: Coordinates,
  center: Coordinates,
  radiusMeters: number,
): boolean {
  return haversineDistanceMeters(point, center) <= radiusMeters;
}

/**
 * Real-world coordinate bounds, not GPS-spoofing detection (deliberately
 * out of scope for v1 — see DECISIONS.md). Rejects values that cannot
 * possibly be real coordinates: out-of-range lat/lng, non-finite numbers,
 * and exact (0, 0) "null island," the classic sentinel a device reports
 * when it fails to acquire a fix rather than a real location.
 */
export function isPlausibleCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}
