import { LockoutService } from "./lockout.service";

describe("LockoutService", () => {
  const service = new LockoutService();
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("does not lock out below the threshold", () => {
    for (let attempts = 0; attempts < 4; attempts++) {
      const result = service.recordFailure(attempts, now);
      expect(result.lockedUntil).toBeNull();
    }
  });

  it("locks out starting at the 5th consecutive failure", () => {
    const result = service.recordFailure(4, now); // -> 5th attempt
    expect(result.failedLoginAttempts).toBe(5);
    expect(result.lockedUntil).not.toBeNull();
    expect(result.lockedUntil!.getTime() - now.getTime()).toBe(1 * 60 * 1000);
  });

  it("doubles the lockout duration for each attempt past the threshold", () => {
    const attempt6 = service.recordFailure(5, now);
    const attempt7 = service.recordFailure(6, now);
    const attempt8 = service.recordFailure(7, now);

    expect(attempt6.lockedUntil!.getTime() - now.getTime()).toBe(2 * 60 * 1000);
    expect(attempt7.lockedUntil!.getTime() - now.getTime()).toBe(4 * 60 * 1000);
    expect(attempt8.lockedUntil!.getTime() - now.getTime()).toBe(8 * 60 * 1000);
  });

  it("caps the lockout duration at 24 hours", () => {
    const manyAttempts = service.recordFailure(100, now);
    expect(manyAttempts.lockedUntil!.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("isLocked is true while lockedUntil is in the future", () => {
    const lockedUntil = new Date(now.getTime() + 60_000);
    expect(service.isLocked(lockedUntil, now)).toBe(true);
  });

  it("isLocked is false once lockedUntil has passed", () => {
    const lockedUntil = new Date(now.getTime() - 1);
    expect(service.isLocked(lockedUntil, now)).toBe(false);
  });

  it("isLocked is false when lockedUntil is null", () => {
    expect(service.isLocked(null, now)).toBe(false);
  });
});
