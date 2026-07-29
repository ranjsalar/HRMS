import { checkLocaleParity } from "@hrms/shared";
import en from "./en/emails.json";
import ar from "./ar/emails.json";
import ku from "./ku/emails.json";

// Was pure step-1 scaffolding, unused by any code until step 8.5
// (NotificationsService now genuinely renders from these three files) —
// no test ever verified they stayed in sync with each other. Same
// mechanism as apps/web/src/locales/locale-parity.spec.ts, applied to the
// backend's own i18n directory for the first time.
describe("backend email i18n — locale parity", () => {
  it("en/ar/ku emails.json share exactly the same keys", () => {
    const result = checkLocaleParity({ en, ar, ku });
    expect(result.missingByLocale).toEqual({});
    expect(result.ok).toBe(true);
  });
});
