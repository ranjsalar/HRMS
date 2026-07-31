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
interface EnrollResponseBody {
  secret: string;
  otpauthUri: string;
}
interface CompanyListItem {
  id: string;
  name: string;
  city: string;
  status: string;
  employeeCount: number;
  createdAt: string;
}
interface CreateCompanyResponseBody {
  company: { id: string; name: string; city: string; status: string; createdAt: string };
  admin: { id: string; email: string };
  temporaryPassword: string;
}
interface MailDevEmailSummary {
  id: string;
  subject: string;
  to: { address: string }[];
  from: { address: string }[];
}

/**
 * Real, run-against-the-dev-stack proof for the Super Admin dashboard's
 * three backend endpoints: the RBAC boundary (a company_admin token must
 * get a clean 403, not just a missing UI), the full create-company flow
 * (temp password identical on-screen vs. emailed, real MailDev delivery,
 * the freshly created admin actually logging in end-to-end through
 * mandatory 2FA enrollment and password change), and suspend/reactivate
 * actively blocking login with an honest error — not just relying on RLS,
 * which doesn't even apply at login time (see AuthService.
 * rejectIfCompanyNotActive). See DECISIONS.md.
 */
describe("SuperAdmin dashboard (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  const createdCompanyIds: string[] = [];
  const createdSuperadminUserIds: string[] = [];
  const runId = Date.now().toString(36);

  let superadminToken: string;
  let companyAdminToken: string; // an ordinary tenant company_admin — used for the RBAC-boundary tests

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

    // A real superadmin session — 2FA pre-enrolled directly in fixture
    // data (same shortcut employee-management.e2e-spec.ts uses for
    // company_admin fixtures), since exercising ENROLLMENT itself is
    // what the "freshly created company admin" test below is for.
    const saEmail = `superadmin-actor-${runId}@e2e.test`;
    const saPassword = "superadmin-actor-password-123";
    const saTotpSecret = authenticator.generateSecret();
    const saUser = await superadmin.user.create({
      data: {
        companyId: null,
        email: saEmail,
        passwordHash: await passwordService.hash(saPassword),
        role: "superadmin",
        mustChangePassword: false,
        twoFaEnabled: true,
        twoFaSecret: encryptField(saTotpSecret),
      },
    });
    createdSuperadminUserIds.push(saUser.id);

    const saLogin = await request(server())
      .post("/auth/login")
      .send({ email: saEmail, password: saPassword })
      .expect(200);
    const saLoginBody = saLogin.body as LoginResponseBody;
    expect(saLoginBody.status).toBe("2fa_required");
    const saVerify = await request(server())
      .post("/auth/2fa/verify")
      .send({ pendingToken: saLoginBody.pendingToken, code: authenticator.generate(saTotpSecret) })
      .expect(200);
    superadminToken = (saVerify.body as LoginResponseBody).accessToken!;

    // An ordinary company_admin, for the RBAC-boundary tests only.
    const caCompany = await superadmin.company.create({
      data: { name: `SuperAdmin RBAC Boundary Co ${runId}`, city: "Erbil" },
    });
    createdCompanyIds.push(caCompany.id);
    const caEmail = `rbac-boundary-admin-${runId}@e2e.test`;
    const caPassword = "rbac-boundary-password-123";
    const caTotpSecret = authenticator.generateSecret();
    await superadmin.user.create({
      data: {
        companyId: caCompany.id,
        email: caEmail,
        passwordHash: await passwordService.hash(caPassword),
        role: "company_admin",
        mustChangePassword: false,
        twoFaEnabled: true,
        twoFaSecret: encryptField(caTotpSecret),
      },
    });
    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(caCompany.id),
      skipDuplicates: true,
    });
    const caLogin = await request(server())
      .post("/auth/login")
      .send({ email: caEmail, password: caPassword })
      .expect(200);
    const caLoginBody = caLogin.body as LoginResponseBody;
    expect(caLoginBody.status).toBe("2fa_required");
    const caVerify = await request(server())
      .post("/auth/2fa/verify")
      .send({ pendingToken: caLoginBody.pendingToken, code: authenticator.generate(caTotpSecret) })
      .expect(200);
    companyAdminToken = (caVerify.body as LoginResponseBody).accessToken!;
  }, 30000);

  afterAll(async () => {
    for (const companyId of createdCompanyIds) {
      try {
        await superadmin.auditLog.deleteMany({ where: { companyId } });
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.user.deleteMany({ where: { companyId } });
        await superadmin.company.delete({ where: { id: companyId } });
      } catch {
        // non-fatal — dev DB, unique runId prevents future collisions
      }
    }
    for (const userId of createdSuperadminUserIds) {
      try {
        await superadmin.refreshToken.deleteMany({ where: { userId } });
        await superadmin.user.delete({ where: { id: userId } });
      } catch {
        // non-fatal
      }
    }
    await superadmin.$disconnect();
    await app.close();
  });

  function server(): Parameters<typeof request>[0] {
    return app.getHttpServer() as Parameters<typeof request>[0];
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
    const body = (await res.json()) as { text: string };
    return body.text;
  }

  async function deleteEmail(id: string): Promise<void> {
    await fetch(`${MAILDEV_URL}/api/email/${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  describe("RBAC boundary — a company_admin token must be refused, not just lack a UI entry point", () => {
    it("GET /superadmin/companies -> 403 for a company_admin", async () => {
      await request(server())
        .get("/superadmin/companies")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .expect(403);
    });

    it("POST /superadmin/companies -> 403 for a company_admin", async () => {
      await request(server())
        .post("/superadmin/companies")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: `Should Never Be Created ${runId}`,
          city: "Erbil",
          adminName: "Nobody",
          adminEmail: `nobody-${runId}@e2e.test`,
        })
        .expect(403);
    });

    it("PATCH /superadmin/companies/:id/status -> 403 for a company_admin", async () => {
      await request(server())
        .patch(`/superadmin/companies/${createdCompanyIds[0]}/status`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ status: "suspended" })
        .expect(403);
    });

    it("all three -> 401 for no token at all (not even authenticated)", async () => {
      await request(server()).get("/superadmin/companies").expect(401);
      await request(server()).post("/superadmin/companies").send({}).expect(401);
      await request(server())
        .patch(`/superadmin/companies/${createdCompanyIds[0]}/status`)
        .send({ status: "suspended" })
        .expect(401);
    });
  });

  describe("GET /superadmin/companies", () => {
    it("lists companies with name, city, status, employee count, created date", async () => {
      const res = await request(server())
        .get("/superadmin/companies")
        .set("Authorization", `Bearer ${superadminToken}`)
        .expect(200);

      const list = res.body as CompanyListItem[];
      const found = list.find((c) => c.id === createdCompanyIds[0]);
      expect(found).toBeDefined();
      expect(found).toMatchObject({
        city: "Erbil",
        status: "active",
        employeeCount: 0,
      });
      expect(typeof found!.createdAt).toBe("string");
    });
  });

  describe("POST /superadmin/companies — full create-company-and-admin flow", () => {
    let created: CreateCompanyResponseBody;
    const adminEmail = `real-flow-admin-${runId}@e2e.test`;
    const companyName = `SuperAdmin Real Flow Co ${runId}`;

    it("creates the company and its first company_admin, returning the temp password exactly once", async () => {
      const res = await request(server())
        .post("/superadmin/companies")
        .set("Authorization", `Bearer ${superadminToken}`)
        .send({
          name: companyName,
          city: "Duhok",
          adminName: "Real Flow Admin",
          adminEmail,
        })
        .expect(201);

      created = res.body as CreateCompanyResponseBody;
      createdCompanyIds.push(created.company.id);

      expect(created.company.name).toBe(companyName);
      expect(created.admin.email).toBe(adminEmail);
      expect(created.temporaryPassword.length).toBeGreaterThan(20);
    });

    it("rejects a second company with the same name", async () => {
      await request(server())
        .post("/superadmin/companies")
        .set("Authorization", `Bearer ${superadminToken}`)
        .send({
          name: companyName,
          city: "Duhok",
          adminName: "X",
          adminEmail: `dup-${runId}@e2e.test`,
        })
        .expect(409);
    });

    it("emails the SAME password value shown on screen — not a regenerated one", async () => {
      const mail = await findEmailTo(adminEmail);
      expect(mail.subject).toBe(`Your HRMS account for ${companyName}`);
      expect(mail.from[0].address).toBe("no-reply@hrms.test");

      const text = await fetchEmailText(mail.id);
      expect(text).toContain(`Temporary password: ${created.temporaryPassword}`);
      expect(text).toContain(`Email: ${adminEmail}`);
      expect(text).toContain("http://localhost:3000/login");

      await deleteEmail(mail.id);
    });

    it("a company creation writes an audit log entry", async () => {
      const entry = await superadmin.auditLog.findFirst({
        where: { companyId: created.company.id, action: "create", entity: "Company" },
      });
      expect(entry).not.toBeNull();
    });

    // The real proof: the freshly created admin can actually log in (with
    // the exact emailed/displayed password), complete MANDATORY 2FA
    // enrollment (company_admin requires it — see TwoFactorService), then
    // the MANDATORY password change (mustChangePassword was set true at
    // creation), and use the system normally afterward.
    it("the new admin can log in with the temp password, enroll 2FA, change their password, and use the system", async () => {
      const login = await request(server())
        .post("/auth/login")
        .send({ email: adminEmail, password: created.temporaryPassword })
        .expect(200);
      const loginBody = login.body as LoginResponseBody;
      expect(loginBody.status).toBe("2fa_enrollment_required");

      const enroll = await request(server())
        .post("/auth/2fa/enroll")
        .send({ pendingToken: loginBody.pendingToken })
        .expect(200);
      const { secret } = enroll.body as EnrollResponseBody;

      const enable = await request(server())
        .post("/auth/2fa/enable")
        .send({ pendingToken: loginBody.pendingToken, code: authenticator.generate(secret) })
        .expect(200);
      const session = enable.body as LoginResponseBody;
      expect(session.status).toBe("ok");
      expect(session.mustChangePassword).toBe(true);
      const provisionalToken = session.accessToken!;

      // Blocked from everything except password/change while mustChangePassword is true.
      await request(server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .expect(403);

      await request(server())
        .post("/auth/password/change")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .send({
          currentPassword: created.temporaryPassword,
          newPassword: "a-real-chosen-password-999",
        })
        .expect(200);

      // Same access token now unblocked (no stale-claim bug), and the
      // account behaves like any other normal, functioning session.
      const me = await request(server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${provisionalToken}`)
        .expect(200);
      expect((me.body as { role: string }).role).toBe("company_admin");

      // Logging in AGAIN now requires the new password, not the old temp one.
      const reLogin = await request(server())
        .post("/auth/login")
        .send({ email: adminEmail, password: "a-real-chosen-password-999" })
        .expect(200);
      expect((reLogin.body as LoginResponseBody).status).toBe("2fa_required");

      await request(server())
        .post("/auth/login")
        .send({ email: adminEmail, password: created.temporaryPassword })
        .expect(401);
    }, 20000);
  });

  describe("PATCH /superadmin/companies/:id/status — suspend actively blocks login", () => {
    let company: { id: string };
    const email = `suspend-target-${runId}@e2e.test`;
    const password = "suspend-target-password-123";

    beforeAll(async () => {
      company = await superadmin.company.create({
        data: { name: `SuperAdmin Suspend E2E Co ${runId}`, city: "Slemani" },
      });
      createdCompanyIds.push(company.id);
      await superadmin.user.create({
        data: {
          companyId: company.id,
          email,
          passwordHash: await passwordService.hash(password),
          role: "employee", // no 2FA requirement — isolates the suspend check from the 2FA flow
          mustChangePassword: false,
        },
      });
    });

    it("company starts active and login works", async () => {
      await request(server()).post("/auth/login").send({ email, password }).expect(200);
    });

    it("suspending the company writes an audit entry and rejects new logins with a clear, specific message", async () => {
      const res = await request(server())
        .patch(`/superadmin/companies/${company.id}/status`)
        .set("Authorization", `Bearer ${superadminToken}`)
        .send({ status: "suspended" })
        .expect(200);
      expect((res.body as { status: string }).status).toBe("suspended");

      const auditEntry = await superadmin.auditLog.findFirst({
        where: { companyId: company.id, action: "suspend", entity: "Company" },
      });
      expect(auditEntry).not.toBeNull();

      const loginRes = await request(server())
        .post("/auth/login")
        .send({ email, password })
        .expect(401);
      expect((loginRes.body as { message: string }).message).toMatch(/suspended/i);
    });

    it("reactivating restores login, and writes its own audit entry", async () => {
      await request(server())
        .patch(`/superadmin/companies/${company.id}/status`)
        .set("Authorization", `Bearer ${superadminToken}`)
        .send({ status: "active" })
        .expect(200);

      const auditEntry = await superadmin.auditLog.findFirst({
        where: { companyId: company.id, action: "reactivate", entity: "Company" },
      });
      expect(auditEntry).not.toBeNull();

      await request(server()).post("/auth/login").send({ email, password }).expect(200);
    });

    it("rejects 'archived' as a status value on this endpoint — out of scope for this pass", async () => {
      await request(server())
        .patch(`/superadmin/companies/${company.id}/status`)
        .set("Authorization", `Bearer ${superadminToken}`)
        .send({ status: "archived" })
        .expect(400);
    });

    it("a genuinely archived company (set directly, outside this endpoint) also blocks login", async () => {
      await superadmin.company.update({ where: { id: company.id }, data: { status: "archived" } });
      const loginRes = await request(server())
        .post("/auth/login")
        .send({ email, password })
        .expect(401);
      expect((loginRes.body as { message: string }).message).toMatch(/no longer active/i);
      // restore, so afterAll cleanup's assumptions about this company stay simple
      await superadmin.company.update({ where: { id: company.id }, data: { status: "active" } });
    });
  });
});
