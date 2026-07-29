import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
}

interface HolidayBody {
  id: string;
  name: string;
  date: string;
  companyId: string | null;
}

describe("Holidays (e2e)", () => {
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
    // System-wide (companyId: null) fixture rows are NOT scoped to any
    // createdCompanyIds entry — deleted separately here, matched by the
    // runId embedded in their name, so this never touches the real
    // seeded system calendar (database/seeds/holidays.ts).
    try {
      await superadmin.holiday.deleteMany({
        where: { companyId: null, name: { contains: runId } },
      });
    } catch {
      // non-fatal
    }
    for (const companyId of createdCompanyIds) {
      try {
        await superadmin.holiday.deleteMany({ where: { companyId } });
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

  async function loginAndGetToken(email: string, password: string): Promise<string> {
    const res = await request(server()).post("/auth/login").send({ email, password }).expect(200);
    const body = res.body as LoginResponseBody;
    if (body.status !== "ok") {
      throw new Error(`Unexpected login status "${body.status}"`);
    }
    return body.accessToken!;
  }

  function daysFromNow(days: number): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  describe("upcoming holidays: system-wide + company override, future-only, sorted, tenant-isolated", () => {
    let companyId: string;
    let employeeToken: string;
    let otherCompanyToken: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Holidays E2E Co ${runId}`, city: "Duhok" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const otherCompany = await superadmin.company.create({
        data: { name: `Holidays E2E Other Co ${runId}`, city: "Duhok" },
      });
      createdCompanyIds.push(otherCompany.id);

      const employeeEmail = `holidays-emp-${runId}@e2e.test`;
      const password = "employee-password-holidays";
      await superadmin.user.create({
        data: {
          companyId,
          email: employeeEmail,
          passwordHash: await passwordService.hash(password),
          role: "employee",
          mustChangePassword: false,
        },
      });

      const otherEmail = `holidays-other-${runId}@e2e.test`;
      await superadmin.user.create({
        data: {
          companyId: otherCompany.id,
          email: otherEmail,
          passwordHash: await passwordService.hash(password),
          role: "employee",
          mustChangePassword: false,
        },
      });

      await superadmin.rolePermission.createMany({
        data: [...buildRolePermissionRows(companyId), ...buildRolePermissionRows(otherCompany.id)],
        skipDuplicates: true,
      });

      // Past (excluded), two future company-specific, one future
      // system-wide, one future row belonging to the OTHER company only.
      await superadmin.holiday.createMany({
        data: [
          { companyId, name: "Past Company Holiday", date: daysFromNow(-5), recurring: false },
          { companyId, name: "Near Company Holiday", date: daysFromNow(10), recurring: false },
          { companyId, name: "Far Company Holiday", date: daysFromNow(20), recurring: false },
          {
            companyId: null,
            name: `System Holiday ${runId}`,
            date: daysFromNow(15),
            recurring: true,
          },
          {
            companyId: otherCompany.id,
            name: "Other Company Only Holiday",
            date: daysFromNow(12),
            recurring: false,
          },
        ],
      });

      employeeToken = await loginAndGetToken(employeeEmail, password);
      otherCompanyToken = await loginAndGetToken(otherEmail, password);
    });

    it("returns only future holidays, sorted ascending, mixing company-specific and system-wide", async () => {
      // limit:3, not a larger number — the real seeded system-wide 2026
      // holiday calendar also lives in this dev DB (see
      // database/seeds/holidays.ts) and IS legitimately visible here too;
      // a larger limit would pick up real entries beyond these 3
      // fixtures (they're just far enough out — Iraq Independence Day
      // etc. — not to be among the nearest 3). Asserting exact equality
      // on exactly the nearest 3 sidesteps that without being fragile.
      const res = await request(server())
        .get("/holidays/upcoming")
        .query({ limit: 3 })
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);

      const holidays = res.body as HolidayBody[];
      const names = holidays.map((h) => h.name);

      expect(names).not.toContain("Past Company Holiday");
      expect(names).not.toContain("Other Company Only Holiday");
      expect(names).toEqual([
        "Near Company Holiday",
        `System Holiday ${runId}`,
        "Far Company Holiday",
      ]);

      const dates = holidays.map((h) => new Date(h.date).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
    });

    it("respects the limit query parameter", async () => {
      const res = await request(server())
        .get("/holidays/upcoming")
        .query({ limit: 1 })
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);

      const holidays = res.body as HolidayBody[];
      expect(holidays).toHaveLength(1);
      expect(holidays[0].name).toBe("Near Company Holiday");
    });

    it("defaults to a small limit when none is provided", async () => {
      const res = await request(server())
        .get("/holidays/upcoming")
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);

      expect((res.body as HolidayBody[]).length).toBeLessThanOrEqual(5);
    });

    it("a caller in a different company never sees this company's holiday, only their own + system-wide", async () => {
      const res = await request(server())
        .get("/holidays/upcoming")
        .query({ limit: 10 })
        .set("Authorization", `Bearer ${otherCompanyToken}`)
        .expect(200);

      const names = (res.body as HolidayBody[]).map((h) => h.name);
      expect(names).toContain("Other Company Only Holiday");
      expect(names).toContain(`System Holiday ${runId}`); // system-wide is visible to every tenant
      expect(names).not.toContain("Near Company Holiday");
      expect(names).not.toContain("Far Company Holiday");
    });

    it("requires authentication", async () => {
      await request(server()).get("/holidays/upcoming").expect(401);
    });
  });
});
