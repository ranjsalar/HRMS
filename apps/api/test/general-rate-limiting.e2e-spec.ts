// Overrides the shared .env.test value (1000/60s — set high specifically
// so it never interferes with other e2e files' real traffic) BEFORE
// importing AppModule, so THIS file's own dedicated app instance boots
// with a small enough limit to actually prove the general throttle
// fires, without needing hundreds of requests. A direct process.env
// assignment (not dotenv) takes effect here because Jest resets the
// module registry per test file — setup-env.ts's own load already ran
// and set "1000" by the time this file's top-level code runs, and this
// plain assignment overrides it for this file only.
process.env.GENERAL_API_RATE_LIMIT = "8";

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Proves two things the unit-level reasoning in DECISIONS.md
 * ("Infrastructure pass, item 4") claims but doesn't verify on its own:
 * (1) the app-wide "generalApi" throttle genuinely fires on an ordinary,
 * non-auth route — GeneralApiThrottlerGuard isn't a no-op; (2) it's
 * bound ONLY by GENERAL_API_RATE_LIMIT, not accidentally also
 * constrained by AuthController's much stricter "authLogin"/
 * "authStrict" limits (5-10/60s) — the exact over-restriction bug this
 * guard's filtering was written to prevent. If that filtering were ever
 * removed or broken, this test would start failing at request 5-10
 * instead of 8, catching the regression.
 */
describe("General app-wide rate limiting (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function server(): Parameters<typeof request>[0] {
    return app.getHttpServer() as Parameters<typeof request>[0];
  }

  it("a public, non-auth-specific route allows exactly GENERAL_API_RATE_LIMIT (8) requests, then a real 429 — not throttled early by authLogin/authStrict, not left unthrottled either", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await request(server()).get("/health").expect(200);
    }

    const throttled = await request(server()).get("/health").expect(429);
    expect((throttled.body as { message: string }).message).toMatch(/Too Many Requests/i);
  }, 15000);
});
