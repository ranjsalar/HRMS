const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** JS Date.getUTCDay() values: 0=Sun, 1=Mon, ..., 6=Sat. */
export function isWeekendDay(date: Date, weekendDays: readonly number[]): boolean {
  return weekendDays.includes(date.getUTCDay());
}

/** UTC calendar-date key (YYYY-MM-DD), used both for holiday-set membership and for iterating day-by-day without local-timezone drift. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Inclusive day count from `start` to `end`, excluding weekends (per the
 * company's configured `weekendDays`) and any date present in
 * `holidayDateKeys`. Everything is normalized to UTC calendar dates before
 * comparing — leave request dates arrive as date-only ISO strings
 * ("2026-01-05"), which `new Date(...)` already parses as UTC midnight, so
 * this avoids the classic bug where a local-timezone read of that same
 * instant lands on the previous/next calendar day.
 */
export function countWorkingDays(
  start: Date,
  end: Date,
  weekendDays: readonly number[],
  holidayDateKeys: ReadonlySet<string>,
): number {
  const cursor = utcMidnight(start);
  const endUtc = utcMidnight(end);
  if (endUtc < cursor) {
    throw new Error("end date must not be before start date");
  }

  let count = 0;
  while (cursor <= endUtc) {
    if (!isWeekendDay(cursor, weekendDays) && !holidayDateKeys.has(toDateKey(cursor))) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Prorates an annual leave entitlement for the calendar `year` a given
 * employee's `hireDate` falls in. Employed the whole target year (hired in
 * an earlier year) -> full `daysPerYear`. Not yet hired in the target year
 * -> 0. Hired partway through the target year -> `daysPerYear *
 * (daysRemainingInYearFromHireDateInclusive / daysInYear)`, rounded to 2
 * decimal places (matches `LeaveBalance.balance`'s `Decimal(6,2)`). Uses
 * calendar days (not working days) as the proration unit — simplest
 * defensible formula, and correctly accounts for leap years via the actual
 * day count between two UTC instants rather than a hardcoded 365. See
 * DECISIONS.md.
 */
export function prorateAnnualDays(daysPerYear: number, hireDate: Date, year: number): number {
  const hireYear = hireDate.getUTCFullYear();
  if (hireYear > year) return 0;
  if (hireYear < year) return daysPerYear;

  const yearStart = Date.UTC(year, 0, 1);
  const yearEndExclusive = Date.UTC(year + 1, 0, 1);
  const daysInYear = Math.round((yearEndExclusive - yearStart) / MS_PER_DAY);

  const hireUtc = Date.UTC(
    hireDate.getUTCFullYear(),
    hireDate.getUTCMonth(),
    hireDate.getUTCDate(),
  );
  const daysRemaining = Math.round((yearEndExclusive - hireUtc) / MS_PER_DAY);

  const prorated = (daysPerYear * daysRemaining) / daysInYear;
  return Math.round(prorated * 100) / 100;
}
