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
  projectId: string;
  title: string;
  status: string;
  assigneeId: string | null;
}

describe("Projects module — Task CRUD (e2e)", () => {
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

  describe("Three-tier scope model + the employee status-only allow-list", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let employeeToken: string; // employeeA — deptA, assigned taskA1
    let otherEmployeeToken: string; // employeeC — deptA, project member but NOT assigned anything
    let employeeAId: string;
    let employeeCId: string;
    let projectAId: string; // deptA member — in the manager's scope
    let projectBId: string; // deptB member only — outside the manager's scope
    let taskA1Id: string; // in projectA, assigned to employeeA
    let taskBId: string; // in projectB

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Tasks E2E Co ${runId}`, city: "Slemani" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Engineering" } }),
        superadmin.department.create({ data: { companyId, name: "Sales" } }),
      ]);

      const adminEmail = `taskadmin-${runId}@e2e.test`;
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

      const managerEmail = `taskmanager-${runId}@e2e.test`;
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
          fullName: "Tasks Manager",
          nationalId: encryptField("TASK-MGR-NATIONAL-ID"),
          jobTitle: "Engineering Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "700000.00",
        },
      });

      const employeeAEmail = `taskemployeeA-${runId}@e2e.test`;
      const employeeAPassword = "employeeA-password-456";
      const employeeAUser = await superadmin.user.create({
        data: {
          companyId,
          email: employeeAEmail,
          passwordHash: await passwordService.hash(employeeAPassword),
          role: "employee",
          mustChangePassword: false,
        },
      });
      const employeeA = await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeAUser.id,
          fullName: "Task Assignee",
          nationalId: encryptField("TASK-EMP-A-NATIONAL-ID"),
          jobTitle: "Engineer",
          departmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeAId = employeeA.id;

      const employeeCEmail = `taskemployeeC-${runId}@e2e.test`;
      const employeeCPassword = "employeeC-password-456";
      const employeeCUser = await superadmin.user.create({
        data: {
          companyId,
          email: employeeCEmail,
          passwordHash: await passwordService.hash(employeeCPassword),
          role: "employee",
          mustChangePassword: false,
        },
      });
      const employeeC = await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeCUser.id,
          fullName: "Task Bystander",
          nationalId: encryptField("TASK-EMP-C-NATIONAL-ID"),
          jobTitle: "Engineer",
          departmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeCId = employeeC.id;

      const employeeB = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "In Sales",
          nationalId: encryptField("TASK-EMP-B-NATIONAL-ID"),
          jobTitle: "Sales Rep",
          departmentId: deptB.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeToken = await loginAndGetToken(employeeAEmail, employeeAPassword);
      otherEmployeeToken = await loginAndGetToken(employeeCEmail, employeeCPassword);

      const projectARes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Project A" })
        .expect(201);
      projectAId = (projectARes.body as ProjectResponseBody).id;
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeAId })
        .expect(201);
      await request(server())
        .post(`/projects/${projectAId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeCId })
        .expect(201);

      const projectBRes = await request(server())
        .post("/projects")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Project B" })
        .expect(201);
      projectBId = (projectBRes.body as ProjectResponseBody).id;
      await request(server())
        .post(`/projects/${projectBId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeB.id })
        .expect(201);

      const taskA1Res = await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ projectId: projectAId, title: "Build the thing", assigneeId: employeeAId })
        .expect(201);
      taskA1Id = (taskA1Res.body as TaskResponseBody).id;

      const taskBRes = await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ projectId: projectBId, title: "Sell the thing" })
        .expect(201);
      taskBId = (taskBRes.body as TaskResponseBody).id;
    });

    it("company_admin sees ALL tasks, regardless of project or assignment", async () => {
      const res = await request(server())
        .get("/tasks")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const ids = (res.body as TaskResponseBody[]).map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([taskA1Id, taskBId]));
    });

    it("company_admin can create a task, assign it, and update its status via the general route", async () => {
      const res = await request(server())
        .patch(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "in_progress" })
        .expect(200);
      expect((res.body as TaskResponseBody).status).toBe("in_progress");
    });

    it("wrote a real AuditLog row for the task create, attributed to the admin", async () => {
      const logs = await superadmin.auditLog.findMany({
        where: { companyId, entity: "Task", entityId: taskA1Id, action: "create" },
      });
      expect(logs.length).toBe(1);
    });

    it("manager (own_department) sees ONLY tasks in a project with a member from their managed department", async () => {
      const res = await request(server())
        .get("/tasks")
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      const ids = (res.body as TaskResponseBody[]).map((t) => t.id);
      expect(ids).toContain(taskA1Id);
      expect(ids).not.toContain(taskBId);
    });

    it("manager CANNOT view or update the out-of-scope task (404)", async () => {
      await request(server())
        .get(`/tasks/${taskBId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(404);
      await request(server())
        .patch(`/tasks/${taskBId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ status: "done" })
        .expect(404);
    });

    it("manager CAN reassign and update an in-scope task via the general route", async () => {
      const res = await request(server())
        .patch(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ assigneeId: employeeCId })
        .expect(200);
      expect((res.body as TaskResponseBody).assigneeId).toBe(employeeCId);

      // Reassign back to employeeA for the rest of the suite.
      await request(server())
        .patch(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ assigneeId: employeeAId })
        .expect(200);
    });

    it("employee (self) sees a task assigned to them AND a task in a project they're a member of, but not an out-of-scope task", async () => {
      // employeeA: assigned taskA1 directly.
      const asAssignee = await request(server())
        .get("/tasks")
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);
      const assigneeIds = (asAssignee.body as TaskResponseBody[]).map((t) => t.id);
      expect(assigneeIds).toContain(taskA1Id);
      expect(assigneeIds).not.toContain(taskBId);

      // employeeC: a member of projectA, NOT assigned taskA1 — still sees
      // it, per the plan's "project member OR assignee" view rule.
      const asMember = await request(server())
        .get("/tasks")
        .set("Authorization", `Bearer ${otherEmployeeToken}`)
        .expect(200);
      const memberIds = (asMember.body as TaskResponseBody[]).map((t) => t.id);
      expect(memberIds).toContain(taskA1Id);
      expect(memberIds).not.toContain(taskBId);
    });

    it("employee CANNOT create a task (403 — no default grant at all)", async () => {
      await request(server())
        .post("/tasks")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ projectId: projectAId, title: "Should be rejected" })
        .expect(403);
    });

    it("employee CANNOT delete a task (403 — no default projects:delete grant)", async () => {
      await request(server())
        .delete(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(403);
    });

    it("employee CANNOT edit task details via the general route, even on their own assigned task (service-level block, matching Project's precedent)", async () => {
      const res = await request(server())
        .patch(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ title: "Should never apply" })
        .expect(403);
      expect((res.body as { message: string }).message).toMatch(/cannot edit task details/i);
    });

    it("the assignee CAN update ONLY the status of their own assigned task, via the dedicated route", async () => {
      const res = await request(server())
        .patch(`/tasks/${taskA1Id}/status`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ status: "done" })
        .expect(200);
      expect((res.body as TaskResponseBody).status).toBe("done");
    });

    it("the dedicated status route structurally cannot carry any other field — a smuggled title is rejected with a 400, not silently ignored", async () => {
      await request(server())
        .patch(`/tasks/${taskA1Id}/status`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ status: "todo", title: "Smuggled in" })
        .expect(400);
    });

    it("a project member who is NOT the assignee CANNOT update the task's status (self scope's write is narrower than its read)", async () => {
      await request(server())
        .patch(`/tasks/${taskA1Id}/status`)
        .set("Authorization", `Bearer ${otherEmployeeToken}`)
        .send({ status: "in_progress" })
        .expect(404);
    });

    it("admin hard-deletes a task — the row is genuinely gone, not soft-archived", async () => {
      await request(server())
        .delete(`/tasks/${taskBId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(204);

      const row = await superadmin.task.findUnique({ where: { id: taskBId } });
      expect(row).toBeNull();
    });

    it("admin CANNOT delete a task that has logged time entries — a clean 409 with an explanatory message, not a raw 500 from the ON DELETE RESTRICT foreign key", async () => {
      await request(server())
        .post(`/tasks/${taskA1Id}/time-entries`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ date: "2026-07-20", hours: 1.5 })
        .expect(201);

      const res = await request(server())
        .delete(`/tasks/${taskA1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
      expect((res.body as { message: string }).message).toMatch(/logged time entries/i);

      // The task is genuinely still there — the delete was blocked, not
      // half-applied.
      const row = await superadmin.task.findUnique({ where: { id: taskA1Id } });
      expect(row).not.toBeNull();
    });
  });
});
