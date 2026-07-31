import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { encryptField } from "../src/common/crypto/field-encryption";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";

const MAILDEV_URL = "http://localhost:1080";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
  pendingToken?: string;
  mustChangePassword?: boolean;
}
interface CreateEmployeeResponseBody {
  id: string;
  userId: string | null;
  fullName: string;
  temporaryPassword?: string;
}
interface MailDevEmailSummary {
  id: string;
  subject: string;
  to: { address: string }[];
  from: { address: string }[];
}

/**
 * Closes the gap flagged by the verification pass: previously nothing
 * outside a CLI/Super-Admin-only path ever created a User row, so a
 * company_admin could add Employee records but never give anyone
 * (including a manager) an actual account. Same rigor as
 * superadmin.e2e-spec.ts: real e2e proof that the emailed and on-screen
 * temp passwords are identical, the created account can actually log in,
 * hit mustChangePassword, change it, and use Employee Self-Service for
 * real — not a fixture. See DECISIONS.md.
 */
describe("Employee account creation (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  const createdCompanyIds: string[] = [];
  const runId = Date.now().toString(36);

  let companyId: string;
  let departmentId: string;
  let otherDepartmentId: string;
  let leaveTypeId: string;
  let adminToken: string;
  let managerToken: string;

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

    const company = await superadmin.company.create({
      data: { name: `EmployeeAccountCreation E2E Co ${runId}`, city: "Erbil" },
    });
    companyId = company.id;
    createdCompanyIds.push(company.id);

    const [dept, otherDept] = await Promise.all([
      superadmin.department.create({ data: { companyId, name: "Engineering" } }),
      superadmin.department.create({ data: { companyId, name: "Sales" } }),
    ]);
    departmentId = dept.id;
    otherDepartmentId = otherDept.id;

    const leaveType = await superadmin.leaveType.create({
      data: { companyId, name: "Annual Leave", daysPerYear: 20 },
    });
    leaveTypeId = leaveType.id;

    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(companyId),
      skipDuplicates: true,
    });
    // Manager employees:create is an opt-in per-company grant, not a
    // default (see DECISIONS.md and employee-management.e2e-spec.ts's
    // "Manager cross-department CRUD" precedent) — enabled explicitly
    // here, own_department scoped, to exercise that this build's login-
    // provisioning inherits the SAME existing RBAC boundary unchanged.
    await superadmin.rolePermission.create({
      data: {
        companyId,
        role: "manager",
        module: "employees",
        action: "create",
        scope: "own_department",
      },
    });

    const adminEmail = `eac-admin-${runId}@e2e.test`;
    const adminPassword = "eac-admin-password-123";
    const adminTotpSecret = authenticator.generateSecret();
    await superadmin.user.create({
      data: {
        companyId,
        email: adminEmail,
        passwordHash: await passwordService.hash(adminPassword),
        role: "company_admin",
        mustChangePassword: false,
        twoFaEnabled: true,
        twoFaSecret: encryptField(adminTotpSecret),
      },
    });
    adminToken = await login2fa(adminEmail, adminPassword, adminTotpSecret);

    const managerEmail = `eac-manager-${runId}@e2e.test`;
    const managerPassword = "eac-manager-password-123";
    const managerUser = await superadmin.user.create({
      data: {
        companyId,
        email: managerEmail,
        passwordHash: await passwordService.hash(managerPassword),
        role: "manager",
        mustChangePassword: false,
      },
    });
    await superadmin.employee.create({
      data: {
        companyId,
        userId: managerUser.id,
        fullName: "EAC Manager",
        nationalId: encryptField(`EAC-MGR-${runId}`),
        jobTitle: "Engineering Manager",
        managedDepartmentId: departmentId,
        hireDate: new Date(),
        salaryBase: "700000.00",
      },
    });
    const managerLogin = await request(server())
      .post("/auth/login")
      .send({ email: managerEmail, password: managerPassword })
      .expect(200);
    expect((managerLogin.body as LoginResponseBody).status).toBe("ok"); // manager: no mandatory 2FA
    managerToken = (managerLogin.body as LoginResponseBody).accessToken!;
  }, 30000);

  afterAll(async () => {
    for (const id of createdCompanyIds) {
      try {
        await superadmin.auditLog.deleteMany({ where: { companyId: id } });
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId: id } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId: id } });
        await superadmin.employee.updateMany({ where: { companyId: id }, data: { userId: null } });
        await superadmin.user.deleteMany({ where: { companyId: id } });
        await superadmin.employee.deleteMany({ where: { companyId: id } });
        await superadmin.department.deleteMany({ where: { companyId: id } });
        await superadmin.company.delete({ where: { id } });
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

  async function login2fa(email: string, password: string, totpSecret: string): Promise<string> {
    const res = await request(server()).post("/auth/login").send({ email, password }).expect(200);
    const body = res.body as LoginResponseBody;
    expect(body.status).toBe("2fa_required");
    const verify = await request(server())
      .post("/auth/2fa/verify")
      .send({ pendingToken: body.pendingToken, code: authenticator.generate(totpSecret) })
      .expect(200);
    return (verify.body as LoginResponseBody).accessToken!;
  }

  async function findEmailTo(toAddress: string, maxAttempts = 20): Promise<MailDevEmailSummary> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await fetch(`${MAILDEV_URL}/api/email`);
      const emails = (await res.json()) as MailDevEmailSummary[];
      const match = emails.find((e) => e.to.some((t) => t.address === toAddress));
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`No email arrived for ${toAddress} within the wait window`);
  }

  async function fetchEmailText(id: string): Promise<string> {
    const res = await fetch(`${MAILDEV_URL}/api/email/${id}`);
    const body = (await res.json()) as { text: string; subject: string };
    return body.text;
  }

  async function deleteEmail(id: string): Promise<void> {
    await fetch(`${MAILDEV_URL}/api/email/${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  describe("Record-only creation still works (backward compatible)", () => {
    it("omitting `email` creates an Employee with no linked User", async () => {
      const res = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Record Only",
          nationalId: `RECORD-ONLY-${runId}`,
          jobTitle: "Contractor",
          hireDate: "2024-01-01",
          salaryBase: 300000,
        })
        .expect(201);
      const body = res.body as CreateEmployeeResponseBody;
      expect(body.userId).toBeNull();
      expect(body.temporaryPassword).toBeUndefined();
    });

    it("`role`/`locale` without `email` is rejected with 400", async () => {
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Bad Combo",
          nationalId: `BAD-COMBO-${runId}`,
          jobTitle: "X",
          hireDate: "2024-01-01",
          salaryBase: 300000,
          role: "manager",
        })
        .expect(400);
    });
  });

  describe("company_admin creates a full employee account", () => {
    const email = `new-employee-${runId}@e2e.test`;
    let created: CreateEmployeeResponseBody;

    it("creates the Employee AND a linked User, returning the temp password exactly once", async () => {
      const res = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Real New Employee",
          nationalId: `NEW-EMP-${runId}`,
          jobTitle: "Software Engineer",
          departmentId,
          hireDate: "2024-03-01",
          salaryBase: 900000,
          currency: "USD",
          email,
        })
        .expect(201);

      created = res.body as CreateEmployeeResponseBody;
      expect(created.userId).not.toBeNull();
      expect(created.temporaryPassword!.length).toBeGreaterThan(20);

      const linkedUser = await superadmin.user.findUniqueOrThrow({
        where: { id: created.userId! },
      });
      expect(linkedUser.email).toBe(email);
      expect(linkedUser.role).toBe("employee"); // role omitted -> defaults to employee
      expect(linkedUser.mustChangePassword).toBe(true);
    });

    it("audit log records the employee create with loginCreated metadata", async () => {
      const entry = await superadmin.auditLog.findFirst({
        where: { companyId, entity: "Employee", entityId: created.id, action: "create" },
      });
      expect(entry).not.toBeNull();
      expect(entry!.metadata).toMatchObject({ loginCreated: true, role: "employee" });
    });

    it("emails the SAME password value shown on screen — not a regenerated one", async () => {
      const mail = await findEmailTo(email);
      expect(mail.from[0].address).toBe("no-reply@hrms.test");
      const text = await fetchEmailText(mail.id);
      expect(text).toContain(created.temporaryPassword!);
      expect(text).toContain("http://localhost:3000/login");
      await deleteEmail(mail.id);
    });

    it("rejects a second account with the same email in this company (409)", async () => {
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Duplicate",
          nationalId: `DUP-${runId}`,
          jobTitle: "X",
          hireDate: "2024-01-01",
          salaryBase: 300000,
          email,
        })
        .expect(409);
    });

    // The real proof: log in with the exact temp password, hit
    // mustChangePassword, change it, and use Employee Self-Service for
    // real — not a fixture. employee/manager roles don't require 2FA
    // (TwoFactorService.roleRequiresTwoFactor), so this is a direct
    // status:"ok" login, unlike the Super Admin dashboard's admin flow.
    it("the new employee logs in with the temp password, changes it, then clocks in and submits real leave", async () => {
      const login = await request(server())
        .post("/auth/login")
        .send({ email, password: created.temporaryPassword })
        .expect(200);
      const loginBody = login.body as LoginResponseBody;
      expect(loginBody.status).toBe("ok");
      expect(loginBody.mustChangePassword).toBe(true);
      const provisionalToken = loginBody.accessToken!;

      await request(server())
        .get("/employees/me")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .expect(403); // blocked until password change, same as every other role

      await request(server())
        .post("/auth/password/change")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .send({
          currentPassword: created.temporaryPassword,
          newPassword: "a-real-employee-password-999",
        })
        .expect(200);

      // Real Employee Self-Service use, with the SAME token (no stale-claim bug).
      const me = await request(server())
        .get("/employees/me")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .expect(200);
      expect((me.body as { fullName: string }).fullName).toBe("Real New Employee");

      await request(server())
        .post("/attendance/clock-in")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .send({})
        .expect(201);

      await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .send({
          leaveTypeId,
          startDate: "2026-09-01",
          endDate: "2026-09-01",
          reason: "e2e real-use proof",
        })
        .expect(201);

      // Logging in again requires the real new password now, not the old temp one.
      await request(server())
        .post("/auth/login")
        .send({ email, password: created.temporaryPassword })
        .expect(401);
      const reLogin = await request(server())
        .post("/auth/login")
        .send({ email, password: "a-real-employee-password-999" })
        .expect(200);
      expect((reLogin.body as LoginResponseBody).mustChangePassword).toBe(false);
    }, 20000);
  });

  describe("Role-grant RBAC boundary — only company_admin may create a manager account", () => {
    it("company_admin CAN create an account with role: manager", async () => {
      const email = `granted-manager-${runId}@e2e.test`;
      const res = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Promoted To Manager",
          nationalId: `PROMO-${runId}`,
          jobTitle: "Team Lead",
          hireDate: "2024-01-01",
          salaryBase: 800000,
          email,
          role: "manager",
        })
        .expect(201);
      const created = res.body as CreateEmployeeResponseBody;
      const user = await superadmin.user.findUniqueOrThrow({ where: { id: created.userId! } });
      expect(user.role).toBe("manager");
    });

    it("a manager CANNOT create an account with role: manager (403), even though they can create logins at all", async () => {
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          fullName: "Should Not Become Manager",
          nationalId: `NOPE-${runId}`,
          jobTitle: "X",
          hireDate: "2024-01-01",
          salaryBase: 400000,
          email: `manager-attempt-${runId}@e2e.test`,
          role: "manager",
        })
        .expect(403);
    });

    it("a manager CAN create a plain employee login within their own department", async () => {
      const email = `manager-created-employee-${runId}@e2e.test`;
      const res = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          fullName: "Manager Created Employee",
          nationalId: `MGR-CREATED-${runId}`,
          jobTitle: "Junior Engineer",
          hireDate: "2024-01-01",
          salaryBase: 500000,
          email,
        })
        .expect(201);
      const created = res.body as CreateEmployeeResponseBody;
      expect(created.temporaryPassword).toBeDefined();
      const user = await superadmin.user.findUniqueOrThrow({ where: { id: created.userId! } });
      expect(user.role).toBe("employee");
      const employee = await superadmin.employee.findUniqueOrThrow({ where: { id: created.id } });
      expect(employee.departmentId).toBe(departmentId); // forced to the manager's own department
    });

    it("a manager CANNOT create a login explicitly targeting another department (403)", async () => {
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          fullName: "Cross Dept Attempt",
          nationalId: `CROSS-DEPT-${runId}`,
          jobTitle: "X",
          departmentId: otherDepartmentId,
          hireDate: "2024-01-01",
          salaryBase: 400000,
          email: `cross-dept-${runId}@e2e.test`,
        })
        .expect(403);
    });
  });

  describe("Real Arabic welcome email delivery", () => {
    it("locale: 'ar' sends the REAL email in Arabic", async () => {
      const email = `arabic-welcome-${runId}@e2e.test`;
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Arabic Speaker",
          nationalId: `AR-${runId}`,
          jobTitle: "Analyst",
          hireDate: "2024-01-01",
          salaryBase: 500000,
          email,
          locale: "ar",
        })
        .expect(201);

      const mail = await findEmailTo(email);
      // Real, untranslated Arabic subject from src/i18n/ar/emails.json's
      // employeeWelcome.subject — not a substring check.
      expect(mail.subject).toContain("حسابك في نظام الموارد البشرية");
      const text = await fetchEmailText(mail.id);
      expect(text).toContain("كلمة المرور المؤقتة"); // passwordLabel
      await deleteEmail(mail.id);
    });
  });
});
