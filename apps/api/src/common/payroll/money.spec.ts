import { Prisma } from "@prisma/client";
import { roundCurrency } from "./money";

const D = (v: string) => new Prisma.Decimal(v);

describe("roundCurrency", () => {
  it("IQD rounds to whole dinars, not 2 decimal places", () => {
    expect(roundCurrency(D("3187500.49"), "IQD").toFixed(0)).toBe("3187500");
    expect(roundCurrency(D("3187500.50"), "IQD").toFixed(0)).toBe("3187501"); // half-up
  });

  it("USD rounds to 2 decimal places (cents)", () => {
    expect(roundCurrency(D("1000.554"), "USD").toFixed(2)).toBe("1000.55");
    expect(roundCurrency(D("1000.555"), "USD").toFixed(2)).toBe("1000.56"); // half-up
  });

  it("rounds half up, not half-to-even (banker's rounding) — 0.5 always rounds away from zero at the rounding digit", () => {
    // decimal.js half-to-even would round 2.5 -> 2 (down, to the even
    // neighbor); half-up rounds 2.5 -> 3, always.
    expect(roundCurrency(D("2.5"), "IQD").toFixed(0)).toBe("3");
    expect(roundCurrency(D("50.005"), "USD").toFixed(2)).toBe("50.01");
    expect(roundCurrency(D("50.015"), "USD").toFixed(2)).toBe("50.02");
  });

  it("does not mutate the input Decimal (immutable, matching decimal.js semantics)", () => {
    const original = D("100.006");
    roundCurrency(original, "USD");
    expect(original.toFixed(3)).toBe("100.006");
  });
});
