import { Prisma } from "@prisma/client";
import type { Money } from "./money";

export interface TaxBracket {
  /** null = unbounded (the top bracket). */
  upToAmount: Money | null;
  ratePercent: Money;
}

/**
 * Standard progressive/marginal tax: each bracket's rate applies only to
 * the slice of `taxableAmount` that falls within that bracket's band, not
 * the whole amount. Brackets MUST already be sorted ascending by their
 * bound (lowest `upToAmount` first, the unbounded `null` bracket last) —
 * this function trusts that ordering rather than re-sorting, since the
 * caller (PayrollRulesService) already reads them out of the DB via
 * `orderBy: { order: "asc" }`.
 */
export function computeProgressiveTax(
  taxableAmount: Money,
  brackets: readonly TaxBracket[],
): Money {
  if (taxableAmount.lessThanOrEqualTo(0)) {
    return new Prisma.Decimal(0);
  }

  let remaining = taxableAmount;
  let bandFloor = new Prisma.Decimal(0);
  let tax = new Prisma.Decimal(0);

  for (const bracket of brackets) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const bandWidth =
      bracket.upToAmount === null
        ? remaining
        : Prisma.Decimal.min(remaining, bracket.upToAmount.minus(bandFloor));

    if (bandWidth.greaterThan(0)) {
      tax = tax.plus(bandWidth.times(bracket.ratePercent).dividedBy(100));
      remaining = remaining.minus(bandWidth);
    }

    if (bracket.upToAmount !== null) {
      bandFloor = bracket.upToAmount;
    }
  }

  return tax;
}
