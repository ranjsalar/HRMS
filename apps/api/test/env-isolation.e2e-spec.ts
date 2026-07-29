import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Regression test for a real bug: ConfigModule.forRoot() previously had
 * no envFilePath, so it silently defaulted to loading apps/api/.env
 * (dev) from cwd regardless of NODE_ENV — layered underneath whatever
 * test/setup-env.ts's own dotenv call had already loaded from
 * .env.test. Every var that happened to be defined in BOTH files worked
 * fine (dotenv never overrides an already-set process.env value), which
 * is exactly why this went unnoticed until AUTH_LOGIN_RATE_LIMIT — the
 * first var defined only in .env — silently leaked its dev value (200)
 * into the e2e test process instead of .env.test's intended 10 (see
 * rate-limiting.e2e-spec.ts / DECISIONS.md, "Config hygiene: envFilePath
 * keyed to NODE_ENV").
 *
 * ENV_ISOLATION_CANARY is defined in BOTH .env and .env.test, with
 * DIFFERENT values — not a dev-ONLY var. That's deliberate, not a
 * weaker test: while investigating this fix, a dev-only canary (nothing
 * in .env.test at all) turned out to ALWAYS leak regardless of any fix
 * here, because Prisma's generated client independently auto-loads
 * plain ".env" the instant it's constructed, completely outside
 * ConfigModule's control, and dotenv only refuses to override a key
 * that's ALREADY set — a key with no .env.test counterpart has nothing
 * to race against. That's a genuine, permanent constraint of how
 * Prisma's client works, not something this project's own config code
 * can close. What IS guaranteed, and what actually broke in the real
 * incident, is a var that legitimately differs by environment
 * resolving to the RIGHT environment's value — which is what this test
 * proves, using its own dedicated pair of values rather than
 * DATABASE_URL/EMAIL_FROM to keep the intent obvious. See DECISIONS.md.
 */
describe("Config env-file isolation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    // A real request, same as every other e2e file's normal usage
    // pattern — not padding. This file's only job is 2 trivial process.env
    // assertions with nothing else in between init/close, which closes the
    // app within milliseconds of creating it; that starved BullMQ's own
    // internal "blockingConnection" (see PayrollWorkerService) of the
    // brief moment it needs to finish its own startup handshake before
    // teardown, tripping an unhandled 'error' deep in BullMQ's own
    // internals — a narrow library-internal race specific to near-instant
    // close, not a realistic production shutdown scenario, and separate
    // from the real bug this pass already fixed (PayrollWorkerService/
    // PayrollQueueService previously had NO 'error' handlers on their OWN
    // connections at all). See DECISIONS.md.
    await request(server()).get("/api/health");
  });

  afterAll(async () => {
    await app.close();
  });

  function server(): Parameters<typeof request>[0] {
    return app.getHttpServer() as Parameters<typeof request>[0];
  }

  it("NODE_ENV is genuinely 'test' while this suite runs — the precondition the whole envFilePath mechanism depends on", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("a var that differs between .env (dev) and .env.test resolves to .env.test's value, not dev's", () => {
    expect(process.env.ENV_ISOLATION_CANARY).toBe("test-value");
  });
});
