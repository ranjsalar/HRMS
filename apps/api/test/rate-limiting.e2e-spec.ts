import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";

/**
 * A DEDICATED app instance/file, not folded into security.e2e-spec.ts —
 * deliberately. ThrottlerModule's default storage is in-memory PER APP
 * INSTANCE, keyed per (controller, handler, IP) — sharing an app instance
 * with other auth-hitting tests would make this file's own request counts
 * bleed into (and potentially 429) unrelated tests running later in the
 * same file, or vice versa. One file, one app, one concern.
 */
describe("Auth rate limiting (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  const createdCompanyIds: string[] = [];
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    superadmin = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_SUPERADMIN_URL } },
    });
    passwordService = new PasswordService();
  });

  afterAll(async () => {
    for (const companyId of createdCompanyIds) {
      try {
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.user.deleteMany({ where: { companyId } });
        await superadmin.company.delete({ where: { id: companyId } });
      } catch {
        // non-fatal — dev DB, unique runId prevents future collisions
      }
    }
    await superadmin.$disconnect();
    await app.close();
  });

  function server(): Parameters<typeof request>[0] {
    return app.getHttpServer() as Parameters<typeof request>[0];
  }

  describe("POST /auth/login — IP throttle (10/60s) coexists with the existing per-account lockout (5 consecutive failures)", () => {
    let companyId: string;
    let email: string;
    let password: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `RateLimit E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(companyId);

      email = `ratelimit-${runId}@e2e.test`;
      password = "the-real-password-123";
      await superadmin.user.create({
        data: {
          companyId,
          email,
          passwordHash: await passwordService.hash(password),
          role: "employee",
          mustChangePassword: false,
        },
      });

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });
    });

    it("5 wrong-password attempts against a REAL account lock it (LockoutService, step 3) — still ordinary 401s, throttle budget untouched by the app's own business logic", async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await request(server())
          .post("/auth/login")
          .send({ email, password: "definitely-wrong" })
          .expect(401);
        expect((res.body as { message: string }).message).toBe("Invalid email or password");
      }

      const row = await superadmin.user.findFirstOrThrow({ where: { email } });
      expect(row.failedLoginAttempts).toBe(5);
      expect(row.lockedUntil).not.toBeNull();
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // The account is now locked — but this is STILL the same generic
      // 401, deliberately: lockout state is never revealed to the caller,
      // account-existence-hiding same as everywhere else in this module.
      await request(server()).post("/auth/login").send({ email, password }).expect(401);
    });

    it("continuing to hit the SAME endpoint (from the same IP, same 60s window) trips the IP throttle at the 11th request total — a real 429, not another 401", async () => {
      // The previous test already sent 6 requests to this route from this
      // IP (5 wrong-password attempts + 1 more against the now-locked
      // account) — 6 of the 10-per-60s budget already spent. 4 more here
      // bring the cumulative total to exactly 10 (still allowed); the
      // 11th (below) must be throttled.
      for (let attempt = 1; attempt <= 4; attempt++) {
        await request(server())
          .post("/auth/login")
          .send({ email: `nobody-${attempt}-${runId}@e2e.test`, password: "whatever" })
          .expect(401);
      }

      const throttled = await request(server())
        .post("/auth/login")
        .send({ email: `nobody-overflow-${runId}@e2e.test`, password: "whatever" })
        .expect(429);
      expect((throttled.body as { message: string }).message).toMatch(/Too Many Requests/i);
    });
  });

  describe("POST /auth/password-reset/request — IP throttle (5/60s), the only defense this endpoint has (no account-level lockout applies to it)", () => {
    it("allows 5 requests, throttles the 6th with a real 429", async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await request(server())
          .post("/auth/password-reset/request")
          .send({ email: `reset-throttle-${attempt}-${runId}@e2e.test` })
          .expect(200);
      }

      const throttled = await request(server())
        .post("/auth/password-reset/request")
        .send({ email: `reset-throttle-overflow-${runId}@e2e.test` })
        .expect(429);
      expect((throttled.body as { message: string }).message).toMatch(/Too Many Requests/i);
    });
  });

  describe("POST /auth/2fa/verify — IP throttle (5/60s), the only defense against brute-forcing a 6-digit TOTP code within the pendingToken's TTL", () => {
    it("allows 5 requests, throttles the 6th with a real 429", async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await request(server())
          .post("/auth/2fa/verify")
          .send({ pendingToken: "not-a-real-token", code: `00000${attempt}`.slice(-6) })
          .expect(401);
      }

      const throttled = await request(server())
        .post("/auth/2fa/verify")
        .send({ pendingToken: "not-a-real-token", code: "999999" })
        .expect(429);
      expect((throttled.body as { message: string }).message).toMatch(/Too Many Requests/i);
    });
  });
});
