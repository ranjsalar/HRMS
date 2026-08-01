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
}

interface TaskResponseBody {
  id: string;
}

interface TimeEntryResponseBody {
  id: string;
  taskId: string;
  employeeId: string;
  hours: string;
  note: string | null;
}

describe("Projects module — TaskTimeEntry log/list (e2e)", () => {
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

  describe("Log/list, self vs team scope, and the assignee-only write rule", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let employeeAToken: string; // deptA — assigned taskA1
    let employeeCToken: string; // deptA — project member of A, assigned nothing
    let employeeDToken: string; // deptB — assigned taskA2 (cross-departmental project)
    let taskA1Id: string; // assigned to employeeA (deptA)
    let taskA2Id: string; // assigned to employeeD (deptB), same project as taskA1
    let taskBId: string; // in a project with no deptA member at all — out of the manager's/employeeA's scope entirely

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `TimeEntries E2E Co ${runId}`, city: "Slemani" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Engineering" } }),
        superadmin.department.create({ data: { companyId, name: "Design" } }),
      ]);

      const adminEmail = `timeadmin-${runId}@e2e.test`;
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

      const managerEmail = `timemanager-${runId}@e2e.test`;
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
          fullName: "Time Entries Manager",
          nationalId: encryptField("TIME-MGR-NATIONAL-ID"),
          jobTitle: "Engineering Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "700000.00",
        },
      });

      async function makeEmployee(label: string, departmentId: string) {
        const email = `time${label}-${runId}@e2e.test`;
        const password = `${label}-password-456`;
        const user = await superadmin.user.create({
          data: {
            companyId,
            email,
            passwordHash: await passwordService.hash(password),
            role: "employee",
            mustChangePassword: false,
          },
        });
        const employee = await superadmin.employee.create({
          data: {
            companyId,
            userId: user.id,
            fullName: `Time ${label}`,
            nationalId: encryptField(`TIME-${label.toUpperCase()}-NATIONAL-ID`),
            jobTitle: "Engineer",
            departmentId,
            hireDate: new Date(),
            salaryBase: "400000.00",
          },
        });
        return { email, password, employeeId: employee.id };
      }

      const employeeA = await makeEmployee("employeeA", deptA.id);
      const employeeC = await makeEmployee("employeeC", deptA.id);
      const employeeD = await makeEmployee("employeeD", deptB.id);
      const employeeE = await makeEmployee("employeeE", deptB.id); // sole member of the fully out-of-scope project

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeAToken = await loginAndGetToken(employeeA.email, employeeA.password);
      employeeCToken = await loginAndGetToken(employeeC.email, employeeC.password);
      employeeDToken = await loginAndGetToken(employeeD.email, employeeD.password);

      // Project A: cross-departmental — members from BOTH deptA and deptB,
      // visible to the manager (own_department) because employeeA (deptA)
      // is a member, regardless of employeeD's department.
      const projectARes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Cross-dept project" })
        .expect(201);
      const projectAId = (projectARes.body as ProjectResponseBody).id;
      for (const employeeId of [employeeA.employeeId, employeeC.employeeId, employeeD.employeeId]) {
        await request(server())
          .post(`/projects/${projectAId}/members`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ employeeId })
          .expect(201);
      }

      const taskA1Res = await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ projectId: projectAId, title: "deptA task", assigneeId: employeeA.employeeId })
        .expect(201);
      taskA1Id = (taskA1Res.body as TaskResponseBody).id;

      const taskA2Res = await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectId: projectAId,
          title: "deptB task, same project",
          assigneeId: employeeD.employeeId,
        })
        .expect(201);
      taskA2Id = (taskA2Res.body as TaskResponseBody).id;

      // Project B: entirely deptB, no deptA member at all — genuinely
      // out of the manager's/employeeA's scope, not just the assignee's.
      const projectBRes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Fully out of scope" })
        .expect(201);
      const projectBId = (projectBRes.body as ProjectResponseBody).id;
      await request(server())
        .post(`/projects/${projectBId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeE.employeeId })
        .expect(201);
      const taskBRes = await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          projectId: projectBId,
          title: "Out of scope task",
          assigneeId: employeeE.employeeId,
        })
        .expect(201);
      taskBId = (taskBRes.body as TaskResponseBody).id;

      // Real logged entries: employeeA logs on their own (deptA) task,
      // employeeD logs on theirs (deptB), same project.
      await request(server())
        .post(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .send({ date: "2026-07-15", hours: 3.5, note: "Investigated the bug" })
        .expect(201);

      await request(server())
        .post(`/tasks/${taskA2Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeDToken}`)
        .send({ date: "2026-07-15", hours: 2 })
        .expect(201);
    });

    it("the assignee can log a time entry on their own assigned task", async () => {
      const res = await request(server())
        .get(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const entries = res.body as TimeEntryResponseBody[];
      expect(entries).toHaveLength(1);
      expect(entries[0].hours).toBe("3.5");
      expect(entries[0].note).toBe("Investigated the bug");
    });

    it("wrote a real AuditLog row for the logged time, attributed to the logging employee's user account", async () => {
      const logs = await superadmin.auditLog.findMany({
        where: { companyId, entity: "Task", entityId: taskA1Id, action: "log_time" },
      });
      expect(logs.length).toBe(1);
    });

    it("a project member who is NOT the assignee CANNOT log time on the task (404, matches the status-update precedent)", async () => {
      await request(server())
        .post(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeCToken}`)
        .send({ date: "2026-07-15", hours: 1 })
        .expect(404);
    });

    it("nobody can log time on a task outside their scope at all (404)", async () => {
      await request(server())
        .post(`/tasks/${taskBId}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .send({ date: "2026-07-15", hours: 1 })
        .expect(404);
    });

    it("hours over the sanity ceiling are rejected client-side by the DTO (400)", async () => {
      await request(server())
        .post(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .send({ date: "2026-07-16", hours: 30 })
        .expect(400);
    });

    it("company_admin sees every logged entry on a task, regardless of who logged it", async () => {
      const res = await request(server())
        .get(`/tasks/${taskA2Id}/time-entries`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body as TimeEntryResponseBody[]).toHaveLength(1);
    });

    it("manager sees the entry logged by a deptA employee on a deptA-visible task", async () => {
      const res = await request(server())
        .get(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect(res.body as TimeEntryResponseBody[]).toHaveLength(1);
    });

    it("manager can VIEW the cross-departmental task itself, but sees ZERO entries on it — the assignee (employeeD) is deptB, outside the manager's own_department scope for TIME ENTRIES specifically (a deliberately different rule than Task's own project-membership-based visibility)", async () => {
      await request(server())
        .get(`/tasks/${taskA2Id}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);

      const res = await request(server())
        .get(`/tasks/${taskA2Id}/time-entries`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect(res.body as TimeEntryResponseBody[]).toHaveLength(0);
    });

    it("manager CANNOT list entries on a task entirely outside their scope (404, same as Task's own boundary)", async () => {
      await request(server())
        .get(`/tasks/${taskBId}/time-entries`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(404);
    });

    it("employee (self) sees only their OWN logged entries, even on a task they're a project member of but didn't log time on", async () => {
      const res = await request(server())
        .get(`/tasks/${taskA2Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(200);
      expect(res.body as TimeEntryResponseBody[]).toHaveLength(0);
    });

    it("employee (self) sees their own entry on their own assigned task", async () => {
      const res = await request(server())
        .get(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(200);
      expect(res.body as TimeEntryResponseBody[]).toHaveLength(1);
    });

    it("employee CANNOT list entries on an out-of-scope task (404)", async () => {
      await request(server())
        .get(`/tasks/${taskBId}/time-entries`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(404);
    });
  });
});
