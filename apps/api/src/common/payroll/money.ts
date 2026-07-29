import { Prisma } from "@prisma/client";

// Alias purely for readability at call sites — this IS Prisma.Decimal,
// the decimal.js instance every Decimal-typed Prisma field already
// returns, not a separate money type.
export type Money = Prisma.Decimal;

export type Currency = "IQD" | "USD";

// IQD payroll amounts are practically always whole dinars in this market
// (fils subdivisions aren't used in day-to-day payroll); USD keeps the
// usual 2 decimal places (cents). Both round HALF UP — the simplest,
// least-surprising convention for a payslip, deliberately not "round half
// to even" (banker's rounding), which would be an unexpected surprise on
// a document someone is trying to reconcile by hand.
const CURRENCY_DECIMAL_PLACES: Record<Currency, number> = { IQD: 0, USD: 2 };

/**
 * THE single rounding point for payroll money. Every intermediate figure
 * in the calculation pipeline (hourly/daily rate, overtime pay, tax
 * bracket amounts, social security) stays at full Decimal precision —
 * nothing is rounded until it becomes a value that will actually be
 * displayed/stored (gross, deductions). Rounding at every intermediate
 * step instead is exactly the "cent/dinar drift across a payroll run" this
 * function exists to prevent — see DECISIONS.md and
 * calculate-payslip.ts's rounding-boundary test.
 */
export function roundCurrency(amount: Money, currency: Currency): Money {
  return amount.toDecimalPlaces(CURRENCY_DECIMAL_PLACES[currency], Prisma.Decimal.ROUND_HALF_UP);
}
