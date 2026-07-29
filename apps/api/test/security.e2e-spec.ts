import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { TokenService } from "../src/modules/auth/token.service";
import { encryptField } from "../src/common/crypto/field-encryption";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
}

interface EmployeeResponseBody {
  id: string;
}

/**
 * Live HTTP proof for the three items flagged this step:
 *   1. MustChangePasswordGuard blocks everything except /auth/password/change
 *   2. Password-reset tokens are genuinely single-use (passwordHash-fingerprint binding)
 *   3. A manager's own_department scope blocks cross-department access,
 *      even when the target employee's id is known
 *
 * Fixture data is created directly against the Super Admin (BYPASSRLS)
 * connection — the same connection the company/admin creation CLI uses,
 * for the same reason (there's no tenant session to SET LOCAL to before a
 * Company row exists).
 */
describe("Security (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  let tokenService: TokenService;
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

    // Real TokenService, not a reimplementation — ConfigService with no
    // internalConfig falls back to process.env, already populated by
    // ConfigModule during app.init() above (same .env.test the running
    // app itself uses).
    tokenService = new TokenService(new JwtService(), new ConfigService());

    superadmin = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_SUPERADMIN_URL } },
    });
    passwordService = new PasswordService();
  });

  afterAll(async () => {
    // Best-effort cleanup, in FK-safe order — a failure here shouldn't
    // fail the suite (the runId suffix already keeps re-runs from
    // colliding either way).
    for (const companyId of createdCompanyIds) {
      try {
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.employee.updateMany({ where: { companyId }, data: { userId: null } });
        await superadmin.user.deleteMany({ where: { companyId } });
        await superadmin.employee.deleteMany({ where: { companyId } });
        await superadmin.department.deleteMany({ where: { companyId } });
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

  describe("MustChangePasswordGuard", () => {
    const email = `mcp-${runId}@e2e.test`;
    const tempPassword = "temp-password-e2e-123";
    let accessToken: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `MCP E2E Co ${runId}`, city: "Slemani" },
      });
      createdCompanyIds.push(company.id);
      const passwordHash = await passwordService.hash(tempPassword);
      await superadmin.user.create({
        data: {
          companyId: company.id,
          email,
          passwordHash,
          role: "manager", // manager: no mandatory 2FA, simpler to exercise this guard in isolation
          mustChangePassword: true,
        },
      });

      const login = await request(server())
        .post("/auth/login")
        .send({ email, password: tempPassword })
        .expect(200);
      const body = login.body as LoginResponseBody;
      expect(body.status).toBe("ok"); // no 2FA required for manager
      accessToken = body.accessToken!;
    });

    it("blocks GET /auth/me while mustChangePassword is true", async () => {
      await request(server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(403);
    });

    it("blocks POST /auth/logout while mustChangePassword is true", async () => {
      await request(server())
        .post("/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(403);
    });

    it("allows POST /auth/password/change (the one exempt endpoint)", async () => {
      await request(server())
        .post("/auth/password/change")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: tempPassword, newPassword: "a-real-password-456" })
        .expect(200);
    });

    it("unblocks everything else with the SAME access token once cleared (proves no stale-claim bug)", async () => {
      await request(server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
    });
  });

  describe("Password reset single-use", () => {
    const email = `reset-${runId}@e2e.test`;
    const originalPassword = "original-password-123";

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Reset E2E Co ${runId}`, city: "Erbil" },
      });
      createdCompanyIds.push(company.id);
      const passwordHash = await passwordService.hash(originalPassword);
      await superadmin.user.create({
        data: {
          companyId: company.id,
          email,
          passwordHash,
          role: "employee",
          mustChangePassword: false,
        },
      });
    });

    it("first use of a reset token succeeds; replaying the identical token afterward fails", async () => {
      await request(server()).post("/auth/password-reset/request").send({ email }).expect(200);

      const user = await superadmin.user.findFirstOrThrow({ where: { email } });
      const token = tokenService.issuePasswordResetToken(user.id, user.passwordHash);

      await request(server())
        .post("/auth/password-reset/confirm")
        .send({ token, newPassword: "brand-new-password-789" })
        .expect(200);

      await request(server())
        .post("/auth/password-reset/confirm")
        .send({ token, newPassword: "yet-another-password-000" })
        .expect(401);
    });
  });

  describe("Department-scoped access control (Manager, own_department)", () => {
    let managerAccessToken: string;
    let employeeInManagedDept: { id: string };
    let employeeInOtherDept: { id: string };

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Dept E2E Co ${runId}`, city: "Duhok" },
      });
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId: company.id, name: "Weaving" } }),
        superadmin.department.create({ data: { companyId: company.id, name: "Quality" } }),
      ]);

      employeeInManagedDept = await superadmin.employee.create({
        data: {
          companyId: company.id,
          fullName: "In Managed Dept",
          nationalId: encryptField(`E2E-${runId}-A`),
          jobTitle: "Weaver",
          departmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "500000.00",
        },
      });
      employeeInOtherDept = await superadmin.employee.create({
        data: {
          companyId: company.id,
          fullName: "In Other Dept",
          nationalId: encryptField(`E2E-${runId}-B`),
          jobTitle: "Inspector",
          departmentId: deptB.id,
          hireDate: new Date(),
          salaryBase: "500000.00",
        },
      });

      const managerPassword = "manager-password-321";
      const managerPasswordHash = await passwordService.hash(managerPassword);
      const managerEmail = `manager-${runId}@e2e.test`;
      const managerUser = await superadmin.user.create({
        data: {
          companyId: company.id,
          email: managerEmail,
          passwordHash: managerPasswordHash,
          role: "manager",
          mustChangePassword: false,
        },
      });
      // The manager's OWN Employee row is what carries managedDepartmentId
      // — that's what EmployeesService consults to resolve "their"
      // department, not anything on the User row.
      await superadmin.employee.create({
        data: {
          companyId: company.id,
          userId: managerUser.id,
          fullName: "The Manager",
          nationalId: encryptField(`E2E-${runId}-MGR`),
          jobTitle: "Floor Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "700000.00",
        },
      });

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(company.id),
        skipDuplicates: true,
      });

      const login = await request(server())
        .post("/auth/login")
        .send({ email: managerEmail, password: managerPassword })
        .expect(200);
      const loginBody = login.body as LoginResponseBody;
      expect(loginBody.status).toBe("ok");
      managerAccessToken = loginBody.accessToken!;
    });

    it("manager's employee list includes only employees in their managed department", async () => {
      const res = await request(server())
        .get("/employees")
        .set("Authorization", `Bearer ${managerAccessToken}`)
        .expect(200);

      const ids = (res.body as EmployeeResponseBody[]).map((e) => e.id);
      expect(ids).toContain(employeeInManagedDept.id);
      expect(ids).not.toContain(employeeInOtherDept.id);
    });

    it("GET /employees/:id for an employee OUTSIDE the managed department returns 404 even though the caller knows the exact id", async () => {
      await request(server())
        .get(`/employees/${employeeInOtherDept.id}`)
        .set("Authorization", `Bearer ${managerAccessToken}`)
        .expect(404);
    });

    it("GET /employees/:id for an employee INSIDE the managed department succeeds", async () => {
      const res = await request(server())
        .get(`/employees/${employeeInManagedDept.id}`)
        .set("Authorization", `Bearer ${managerAccessToken}`)
        .expect(200);

      expect((res.body as EmployeeResponseBody).id).toBe(employeeInManagedDept.id);
    });
  });
});
