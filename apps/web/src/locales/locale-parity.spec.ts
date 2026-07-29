import { checkLocaleParity } from "@hrms/shared";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ar from "./ar.json";
import ku from "./ku.json";

// Catches translation-key drift the moment a screen adds a key to one
// locale and forgets the other two — runs as part of the normal `pnpm
// test`, not a separate manual step someone has to remember to invoke.
describe("locale key parity (en/ar/ku)", () => {
  it("every key present in one locale is present in all three", () => {
    const result = checkLocaleParity({ en, ar, ku });
    expect(result.missingByLocale).toEqual({});
    expect(result.ok).toBe(true);
  });
});
