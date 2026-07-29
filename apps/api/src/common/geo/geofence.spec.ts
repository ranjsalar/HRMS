import {
  type Coordinates,
  haversineDistanceMeters,
  isPlausibleCoordinate,
  isWithinGeofence,
} from "./geofence";

// Matches the constant inside geofence.ts — kept separate (not imported)
// so this helper is derived independently of the code under test.
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Destination point due north of `origin` at exactly `distanceMeters`, via
 * direct spherical trigonometry (not the haversine formula under test).
 * For a due-north bearing this reduces to a pure latitude offset — used to
 * construct points at precisely known distances for the boundary tests.
 */
function pointNorthOf(origin: Coordinates, distanceMeters: number): Coordinates {
  const latRad = (origin.lat * Math.PI) / 180;
  const destLatRad = latRad + distanceMeters / EARTH_RADIUS_METERS;
  return { lat: (destLatRad * 180) / Math.PI, lng: origin.lng };
}

describe("haversineDistanceMeters", () => {
  it("returns 0 for identical points", () => {
    const p = { lat: 36.19, lng: 44.01 };
    expect(haversineDistanceMeters(p, p)).toBeCloseTo(0, 6);
  });

  it("matches a well-known reference distance (1 degree of latitude ≈ 111.2 km)", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(111195, -2);
  });

  it("is symmetric", () => {
    const a = { lat: 36.19, lng: 44.01 };
    const b = { lat: 36.2, lng: 44.02 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

describe("isWithinGeofence — boundary behavior", () => {
  // Erbil Citadel, an arbitrary real-world center point.
  const center: Coordinates = { lat: 36.1911, lng: 44.0092 };
  const radiusMeters = 150;

  it("a point exactly on the boundary counts as within (inclusive <=)", () => {
    const onBoundary = pointNorthOf(center, radiusMeters);
    // Sanity-check the constructed point is genuinely ~radiusMeters away
    // before trusting it as a boundary fixture.
    expect(haversineDistanceMeters(onBoundary, center)).toBeCloseTo(radiusMeters, 1);
    expect(isWithinGeofence(onBoundary, center, radiusMeters)).toBe(true);
  });

  it("a point 1m inside the boundary is within", () => {
    const justInside = pointNorthOf(center, radiusMeters - 1);
    expect(isWithinGeofence(justInside, center, radiusMeters)).toBe(true);
  });

  it("a point 1m outside the boundary is NOT within", () => {
    const justOutside = pointNorthOf(center, radiusMeters + 1);
    expect(isWithinGeofence(justOutside, center, radiusMeters)).toBe(false);
  });

  it("the center point itself is always within", () => {
    expect(isWithinGeofence(center, center, radiusMeters)).toBe(true);
  });

  it("a point far outside the radius is not within", () => {
    const farAway = { lat: center.lat + 1, lng: center.lng };
    expect(isWithinGeofence(farAway, center, radiusMeters)).toBe(false);
  });
});

describe("isPlausibleCoordinate", () => {
  it.each([
    [90, 180],
    [-90, -180],
    [36.19, 44.01],
    [0, 45],
  ])("accepts valid lat=%p lng=%p", (lat, lng) => {
    expect(isPlausibleCoordinate(lat, lng)).toBe(true);
  });

  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [NaN, 0],
    [0, NaN],
    [0, 0],
  ])("rejects implausible lat=%p lng=%p", (lat, lng) => {
    expect(isPlausibleCoordinate(lat, lng)).toBe(false);
  });
});
