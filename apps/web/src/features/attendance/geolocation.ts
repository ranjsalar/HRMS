export type GeoResult =
  | { status: "ok"; lat: number; lng: number }
  | { status: "denied" }
  | { status: "unavailable" };

/**
 * Never rejects — a clock-in/out must still be able to proceed (without
 * coordinates) when geolocation is missing, denied, or times out. The
 * backend already treats missing lat/lng as "nothing to geofence-check,"
 * not an error (see AttendanceService.evaluateGeofence), so this mirrors
 * that same non-blocking posture on the client.
 */
export function getGeoResult(): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({ status: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ status: "ok", lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        resolve(
          error.code === error.PERMISSION_DENIED ? { status: "denied" } : { status: "unavailable" },
        ),
      { timeout: 5000, maximumAge: 0 },
    );
  });
}
