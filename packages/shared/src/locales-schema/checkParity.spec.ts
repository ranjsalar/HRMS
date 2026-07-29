import { checkLocaleParity } from "./checkParity";

describe("checkLocaleParity", () => {
  it("passes when all locales share the same keys", () => {
    const result = checkLocaleParity({
      en: { leave: { submit: "Submit" } },
      ar: { leave: { submit: "إرسال" } },
      ku: { leave: { submit: "ناردن" } },
    });
    expect(result.ok).toBe(true);
    expect(result.missingByLocale).toEqual({});
  });

  it("reports keys missing from a locale", () => {
    const result = checkLocaleParity({
      en: { leave: { submit: "Submit", cancel: "Cancel" } },
      ar: { leave: { submit: "إرسال" } },
      ku: { leave: { submit: "ناردن", cancel: "هەڵوەشاندنەوە" } },
    });
    expect(result.ok).toBe(false);
    expect(result.missingByLocale).toEqual({ ar: ["leave.cancel"] });
  });
});
