import { Injectable } from "@nestjs/common";

// Lockout starts after this many consecutive failed attempts.
const LOCKOUT_THRESHOLD = 5;
// Backoff doubles per attempt past the threshold, capped so a mistyped
// password late at night doesn't lock someone out for days.
const BASE_LOCKOUT_MINUTES = 1;
const MAX_LOCKOUT_MINUTES = 60 * 24; // 24 hours

export interface LockoutDecision {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

@Injectable()
export class LockoutService {
  isLocked(lockedUntil: Date | null, now: Date = new Date()): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
  }

  /**
   * Called after a failed password check. Returns the new attempt count
   * and, once the threshold is crossed, an exponentially growing
   * lockedUntil: attempt 5 → 1 min, 6 → 2 min, 7 → 4 min, ... capped at
   * MAX_LOCKOUT_MINUTES.
   */
  recordFailure(previousAttempts: number, now: Date = new Date()): LockoutDecision {
    const failedLoginAttempts = previousAttempts + 1;

    if (failedLoginAttempts < LOCKOUT_THRESHOLD) {
      return { failedLoginAttempts, lockedUntil: null };
    }

    const attemptsPastThreshold = failedLoginAttempts - LOCKOUT_THRESHOLD;
    const minutes = Math.min(
      BASE_LOCKOUT_MINUTES * 2 ** attemptsPastThreshold,
      MAX_LOCKOUT_MINUTES,
    );
    const lockedUntil = new Date(now.getTime() + minutes * 60 * 1000);

    return { failedLoginAttempts, lockedUntil };
  }
}
