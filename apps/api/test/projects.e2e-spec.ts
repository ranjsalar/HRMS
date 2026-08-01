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

interface LoginResponseBody {
  status: string;
  accessToken?: string;
  pendingToken?: string;
}

interface ProjectResponseBody {
  id: string;
  companyId: string;
  name: string;
  status: string;
  createdBy: string | null;
}

interface ProjectWithMembersResponseBody extends ProjectResponseBody {
  members: { employeeId: string; employee: { id: string; fullName: string } }[];
}

interface AuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
}

describe("Projects module — Project + ProjectMember CRUD (e2e)", () => {
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
        await superadmin.auditLog.deleteMany({ where: { companyId } });
        await superadmin.taskTimeEntry.deleteMany({ where: { companyId } });
        await superadmin.task.deleteMany({ where: { companyId } });
        await superadmin.projectMember.deleteMany({ where: { companyId } });
        await superadmin.project.deleteMany({ where: { companyId } });
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

  // company_admin mandates 2FA (TwoFactorService.roleRequiresTwoFactor)
  // regardless of the User.twoFaEnabled flag — admin fixtures below
  // pre-enroll a known TOTP secret and this helper completes the verify
  // step with a freshly generated code, same pattern as
  // employee-management.e2e-spec.ts. manager/employee fixtures have no
  // totpSecret and log in immediately.
  async function loginAndGetToken(
    email: string,
    password: string,
    totpSecret?: string,
  ): Promise<string> {
    const res = await request(server()).post("/auth/login").send({ email, password }).expect(200);
    const body = res.body as LoginResponseBody;

    if (body.status === "ok") {
      return body.accessToken!;
    }

    if (body.status === "2fa_required" && totpSecret) {
      const code = authenticator.generate(totpSecret);
      const verifyRes = await request(server())
        .post("/auth/2fa/verify")
        .send({ pendingToken: body.pendingToken, code })
        .expect(200);
      return (verifyRes.body as LoginResponseBody).accessToken!;
    }

    throw new Error(`Unexpected login status "${body.status}"`);
  }

  describe("Three-tier scope model — admin/manager/employee", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let employeeToken: string;
    let employeeAId: string; // in deptA — manager manages deptA, this employee has a login
    let employeeBId: string; // in deptB — out of the manager's scope
    let projectAId: string; // has a member from deptA — visible to the manager
    let projectBId: string; // has only a member from deptB — NOT visible to the manager

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Projects E2E Co ${runId}`, city: "Slemani" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Engineering" } }),
        superadmin.department.create({ data: { companyId, name: "Sales" } }),
      ]);

      const adminEmail = `projadmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-456";
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

      const managerEmail = `projmanager-${runId}@e2e.test`;
      const managerPassword = "manager-password-456";
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
          fullName: "Projects Manager",
          nationalId: encryptField("PROJ-MGR-NATIONAL-ID"),
          jobTitle: "Engineering Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "700000.00",
        },
      });

      const employeeEmail = `projemployee-${runId}@e2e.test`;
      const employeePassword = "employee-password-456";
      const employeeUser = await superadmin.user.create({
        data: {
          companyId,
          email: employeeEmail,
          passwordHash: await passwordService.hash(employeePassword),
          role: "employee",
          mustChangePassword: false,
        },
      });
      const employeeA = await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeUser.id,
          fullName: "In Engineering",
          nationalId: encryptField("PROJ-EMP-A-NATIONAL-ID"),
          jobTitle: "Engineer",
          departmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeAId = employeeA.id;

      const employeeB = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "In Sales",
          nationalId: encryptField("PROJ-EMP-B-NATIONAL-ID"),
          jobTitle: "Sales Rep",
          departmentId: deptB.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeBId = employeeB.id;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeToken = await loginAndGetToken(employeeEmail, employeePassword);

      // Project A: a real member from deptA (the manager's managed
      // department) — should be visible/editable to the manager and
      // visible to employeeA (a member).
      const projectARes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Platform Rebuild" })
        .expect(201);
      projectAId = (projectARes.body as ProjectResponseBody).id;
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeAId })
        .expect(201);

      // Project B: only a member from deptB — outside the manager's scope
      // and NOT visible to employeeA.
      const projectBRes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Regional Sales Push" })
        .expect(201);
      projectBId = (projectBRes.body as ProjectResponseBody).id;
      await request(server())
        .post(`/projects/${projectBId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeBId })
        .expect(201);
    });

    it("company_admin sees ALL projects, regardless of membership", async () => {
      const res = await request(server())
        .get("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const ids = (res.body as ProjectResponseBody[]).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([projectAId, projectBId]));
    });

    it("company_admin can view a project's members via the detail route", async () => {
      const res = await request(server())
        .get(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const body = res.body as ProjectWithMembersResponseBody;
      expect(body.members.map((m) => m.employeeId)).toEqual([employeeAId]);
    });

    it("company_admin can update a project", async () => {
      const res = await request(server())
        .patch(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "active" })
        .expect(200);
      expect((res.body as ProjectResponseBody).status).toBe("active");
    });

    it("adding the same employee twice is rejected with a 409, not a silent duplicate", async () => {
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeAId })
        .expect(409);
    });

    it("wrote a real AuditLog row for the project create, attributed to the admin", async () => {
      const logs = await superadmin.auditLog.findMany({
        where: { companyId, entity: "Project", entityId: projectAId, action: "create" },
      });
      expect(logs.length).toBe(1);
      const log = logs[0] as AuditLogRow;
      expect(log.action).toBe("create");
    });

    it("manager (own_department, default grant) sees ONLY the project with a member from their managed department", async () => {
      const res = await request(server())
        .get("/projects")
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      const ids = (res.body as ProjectResponseBody[]).map((p) => p.id);
      expect(ids).toContain(projectAId);
      expect(ids).not.toContain(projectBId);
    });

    it("manager CANNOT view the out-of-scope project directly by id (404, existence not revealed)", async () => {
      await request(server())
        .get(`/projects/${projectBId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(404);
    });

    it("manager (own_department, default edit grant) CAN update the in-scope project", async () => {
      const res = await request(server())
        .patch(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ description: "Manager-authored update" })
        .expect(200);
      expect((res.body as ProjectResponseBody & { description: string }).description).toBe(
        "Manager-authored update",
      );
    });

    it("manager CANNOT update the out-of-scope project (404, matches the read boundary)", async () => {
      await request(server())
        .patch(`/projects/${projectBId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ description: "Should never apply" })
        .expect(404);
    });

    it("manager CANNOT create a project without an explicit opt-in grant (403) — admin-only by default, same precedent as employees:create", async () => {
      await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ name: "Should be rejected" })
        .expect(403);
    });

    it("manager CAN create a project once explicitly granted projects:create at own_department scope", async () => {
      await superadmin.rolePermission.create({
        data: {
          companyId,
          role: "manager",
          module: "projects",
          action: "create",
          scope: "own_department",
        },
      });

      const res = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ name: "Manager-created project" })
        .expect(201);
      const body = res.body as ProjectResponseBody;
      expect(body.companyId).toBe(companyId);
    });

    it("employee (self) sees ONLY the project they're a member of", async () => {
      const res = await request(server())
        .get("/projects")
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);
      const ids = (res.body as ProjectResponseBody[]).map((p) => p.id);
      expect(ids).toContain(projectAId);
      expect(ids).not.toContain(projectBId);
    });

    it("employee CANNOT view the project they're not a member of (404)", async () => {
      await request(server())
        .get(`/projects/${projectBId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(404);
    });

    it("employee CANNOT create a project (403 — no default grant at all)", async () => {
      await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ name: "Should be rejected" })
        .expect(403);
    });

    it("employee CANNOT archive a project (403 — no default projects:delete grant)", async () => {
      await request(server())
        .delete(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(403);
    });

    // The default employee grant is `projects:edit` at `self` scope (seeded
    // in step 2, in anticipation of Task status/time-entry edits in a later
    // step) — so RbacGuard itself lets this request through. The real
    // guarantee is the SERVICE explicitly rejecting `self` scope for every
    // project-mutation method, proven here rather than assumed: a grant
    // that exists for a future purpose must not silently also authorize
    // something it was never meant to.
    it("employee CANNOT update a project even though they hold projects:edit at self scope (service-level block, not just missing RBAC)", async () => {
      const res = await request(server())
        .patch(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ description: "Should never apply" })
        .expect(403);
      expect((res.body as { message: string }).message).toMatch(/cannot edit projects/i);
    });

    it("employee CANNOT add or remove project members, for the same reason", async () => {
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ employeeId: employeeBId })
        .expect(403);

      await request(server())
        .delete(`/projects/${projectAId}/members/${employeeAId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(403);
    });

    it("admin can remove a member, and the project reflects it afterward", async () => {
      await request(server())
        .delete(`/projects/${projectAId}/members/${employeeAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(204);

      const res = await request(server())
        .get(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect((res.body as ProjectWithMembersResponseBody).members).toHaveLength(0);

      // Re-add for the archive test below, which doesn't care about
      // membership but keeps this project consistent for anything reading
      // it afterward.
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeAId })
        .expect(201);
    });

    it("admin archives a project — soft, status becomes cancelled, the row survives", async () => {
      await request(server())
        .delete(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(204);

      const row = await superadmin.project.findUniqueOrThrow({ where: { id: projectAId } });
      expect(row.status).toBe("cancelled");

      // Still readable afterward — archiving is not a hard delete.
      await request(server())
        .get(`/projects/${projectAId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
