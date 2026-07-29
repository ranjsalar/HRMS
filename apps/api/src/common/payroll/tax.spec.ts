import { Prisma } from "@prisma/client";
import { computeProgressiveTax, type TaxBracket } from "./tax";

const D = (v: number) => new Prisma.Decimal(v);

describe("computeProgressiveTax", () => {
  const brackets: TaxBracket[] = [
    { upToAmount: D(500000), ratePercent: D(3) },
    { upToAmount: D(1000000), ratePercent: D(5) },
    { upToAmount: null, ratePercent: D(10) },
  ];

  it("income entirely within the first bracket is taxed only at that bracket's rate", () => {
    const tax = computeProgressiveTax(D(300000), brackets);
    expect(tax.toFixed(2)).toBe("9000.00"); // 300000 * 3%
  });

  it("income exactly AT a bracket boundary is taxed fully within that bracket, not the next one", () => {
    const tax = computeProgressiveTax(D(500000), brackets);
    expect(tax.toFixed(2)).toBe("15000.00"); // 500000 * 3%, none spills into the 5% band
  });

  it("income crossing multiple brackets is taxed marginally, not at one flat rate", () => {
    // 500000 @ 3% = 15000, next 500000 (500000-1000000) @ 5% = 25000,
    // remaining 200000 (1000000-1200000) @ 10% = 20000. Total 60000.
    const tax = computeProgressiveTax(D(1200000), brackets);
    expect(tax.toFixed(2)).toBe("60000.00");
  });

  it("zero or negative taxable income owes zero tax", () => {
    expect(computeProgressiveTax(D(0), brackets).toFixed(2)).toBe("0.00");
    expect(computeProgressiveTax(D(-500), brackets).toFixed(2)).toBe("0.00");
  });

  it("a single flat-rate bracket (no bands) taxes the whole amount at that rate", () => {
    const flat: TaxBracket[] = [{ upToAmount: null, ratePercent: D(5) }];
    expect(computeProgressiveTax(D(1000000), flat).toFixed(2)).toBe("50000.00");
  });
});
