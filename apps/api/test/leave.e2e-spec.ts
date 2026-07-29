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

interface LeaveRequestBody {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  status: string;
  workingDays: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
}

const YEAR = 2026;

describe("Leave Management (e2e)", () => {
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
        await superadmin.leaveRequest.deleteMany({ where: { companyId } });
        await superadmin.leaveBalance.deleteMany({ where: { companyId } });
        await superadmin.leaveType.deleteMany({ where: { companyId } });
        await superadmin.holiday.deleteMany({ where: { companyId } });
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

  describe("Submit, approve, reject, cancel — with balance + department scoping", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let employeeA1Token: string;
    let employeeB1Token: string;
    let employeeA1Id: string;
    let employeeA1UserId: string;
    let annualLeaveTypeId: string;
    let sickLeaveTypeId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Leave E2E Co ${runId}`, city: "Erbil" },
        // weekendDays left at the schema default: [5, 6] (Fri+Sat).
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Sales" } }),
        superadmin.department.create({ data: { companyId, name: "Support" } }),
      ]);

      const annualLeaveType = await superadmin.leaveType.create({
        data: { companyId, name: "Annual Leave", daysPerYear: 30, requiresApproval: true },
      });
      annualLeaveTypeId = annualLeaveType.id;

      const sickLeaveType = await superadmin.leaveType.create({
        data: { companyId, name: "Sick Leave", daysPerYear: 3, requiresApproval: true },
      });
      sickLeaveTypeId = sickLeaveType.id;

      // A company-specific holiday inside the Feb 2 - 6 test range, to
      // prove approval's working-day calc excludes it on top of weekends.
      await superadmin.holiday.create({
        data: {
          companyId,
          name: "Test Public Holiday",
          date: new Date("2026-02-04T00:00:00.000Z"),
        },
      });

      const hireDate = new Date("2020-01-01T00:00:00.000Z");

      const adminEmail = `leaveadmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-leave";
      const adminTotpSecret = authenticator.generateSecret();
      const adminUser = await superadmin.user.create({
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
      await superadmin.employee.create({
        data: {
          companyId,
          userId: adminUser.id,
          fullName: "Leave Admin",
          nationalId: encryptField("LEAVE-ADMIN-NATIONAL-ID"),
          jobTitle: "HR Admin",
          hireDate,
          salaryBase: "700000.00",
        },
      });

      const managerEmail = `leavemanager-${runId}@e2e.test`;
      const managerPassword = "manager-password-leave";
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
          fullName: "Leave Manager",
          nationalId: encryptField("LEAVE-MGR-NATIONAL-ID"),
          jobTitle: "Sales Manager",
          departmentId: deptA.id,
          managedDepartmentId: deptA.id,
          hireDate,
          salaryBase: "600000.00",
        },
      });

      const employeeA1Email = `leavea1-${runId}@e2e.test`;
      const employeeA1Password = "employee-password-a1";
      const employeeA1User = await superadmin.user.create({
        data: {
          companyId,
          email: employeeA1Email,
          passwordHash: await passwordService.hash(employeeA1Password),
          role: "employee",
          mustChangePassword: false,
        },
      });
      employeeA1UserId = employeeA1User.id;
      const employeeA1 = await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeA1User.id,
          fullName: "In Sales",
          nationalId: encryptField("LEAVE-A1-NATIONAL-ID"),
          jobTitle: "Sales Rep",
          departmentId: deptA.id,
          hireDate,
          salaryBase: "400000.00",
        },
      });
      employeeA1Id = employeeA1.id;

      const employeeB1Email = `leaveb1-${runId}@e2e.test`;
      const employeeB1Password = "employee-password-b1";
      const employeeB1User = await superadmin.user.create({
        data: {
          companyId,
          email: employeeB1Email,
          passwordHash: await passwordService.hash(employeeB1Password),
          role: "employee",
          mustChangePassword: false,
        },
      });
      await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeB1User.id,
          fullName: "In Support",
          nationalId: encryptField("LEAVE-B1-NATIONAL-ID"),
          jobTitle: "Support Rep",
          departmentId: deptB.id,
          hireDate,
          salaryBase: "400000.00",
        },
      });

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeA1Token = await loginAndGetToken(employeeA1Email, employeeA1Password);
      employeeB1Token = await loginAndGetToken(employeeB1Email, employeeB1Password);
    });

    async function annualBalance(): Promise<number> {
      const balance = await superadmin.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employeeA1Id,
            leaveTypeId: annualLeaveTypeId,
            year: YEAR,
          },
        },
      });
      return balance ? Number(balance.balance) : 30; // not yet created -> still full proration-free entitlement
    }

    let requestR1Id: string;

    it("employee submits a leave request (pending, audit-logged)", async () => {
      const res = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-02-02", endDate: "2026-02-06" })
        .expect(201);

      const body = res.body as LeaveRequestBody;
      expect(body.status).toBe("pending");
      expect(body.employeeId).toBe(employeeA1Id);
      requestR1Id = body.id;

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "LeaveRequest", entityId: body.id, action: "submit" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(employeeA1UserId);
    });

    it("preview computes working days for a date range without creating or touching anything", async () => {
      const res = await request(server())
        .get("/leave-requests/preview")
        .query({ startDate: "2026-02-02", endDate: "2026-02-06" })
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .expect(200);

      // Same Feb 2(Mon)-6(Fri) range as the approved request above: Fri is
      // weekend, Feb 4(Wed) is the seeded holiday -> 3 working days.
      expect(res.body).toEqual({ workingDays: 3 });
    });

    it("preview rejects an end date before the start date with a 400, not a 500", async () => {
      await request(server())
        .get("/leave-requests/preview")
        .query({ startDate: "2026-02-06", endDate: "2026-02-02" })
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .expect(400);
    });

    it("preview requires authentication", async () => {
      await request(server())
        .get("/leave-requests/preview")
        .query({ startDate: "2026-02-02", endDate: "2026-02-06" })
        .expect(401);
    });

    it("a manager can also call preview (leave:view, not leave:create — needed to give a pending request the same context an approver reviews, step 9.6)", async () => {
      const res = await request(server())
        .get("/leave-requests/preview")
        .query({ startDate: "2026-02-02", endDate: "2026-02-06" })
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect(res.body).toEqual({ workingDays: 3 });
    });

    it("a date-overlapping request is rejected with a clear conflict, not a generic error", async () => {
      await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-02-04", endDate: "2026-02-05" })
        .expect(409);
    });

    it("an adjacent but non-overlapping request (starts the day after the first ends) is allowed", async () => {
      await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-02-07", endDate: "2026-02-08" })
        .expect(201);
    });

    it("manager CANNOT approve a request from an employee outside their managed department (404)", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeB1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-07-06", endDate: "2026-07-10" })
        .expect(201);
      const b1RequestId = (submitRes.body as LeaveRequestBody).id;

      await request(server())
        .post(`/leave-requests/${b1RequestId}/approve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({})
        .expect(404);
    });

    it("nobody can approve their own leave request, even an admin whose scope is 'all'", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-08-03", endDate: "2026-08-06" })
        .expect(201);
      const adminRequestId = (submitRes.body as LeaveRequestBody).id;

      await request(server())
        .post(`/leave-requests/${adminRequestId}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({})
        .expect(403);

      // Step 9.6: not just the approve ACTION blocked — the request
      // shouldn't even appear in the admin's own team/approval-queue
      // list. Reviewing a queue that includes something you structurally
      // can never act on is confusing, not just redundant.
      const listRes = await request(server())
        .get("/leave-requests")
        .query({ status: "pending" })
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const ids = (listRes.body as LeaveRequestBody[]).map((r) => r.id);
      expect(ids).not.toContain(adminRequestId);

      // Cleanup: cancel it so it doesn't linger as a stray pending
      // request for the rest of this describe block's assertions.
      await request(server())
        .post(`/leave-requests/${adminRequestId}/cancel`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(201);
    });

    it("manager approves a request in their department: working days exclude the weekend AND the holiday, and the balance is deducted by exactly that amount", async () => {
      const before = await annualBalance();

      const res = await request(server())
        .post(`/leave-requests/${requestR1Id}/approve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({})
        .expect(201);

      const body = res.body as LeaveRequestBody;
      expect(body.status).toBe("approved");
      // Feb 2(Mon)-6(Fri): Fri is weekend, Feb 4(Wed) is the seeded
      // holiday -> Mon, Tue, Thu = 3 working days.
      expect(Number(body.workingDays)).toBe(3);

      const after = await annualBalance();
      expect(after).toBe(before - 3);

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "LeaveRequest", entityId: requestR1Id, action: "approve" },
      });
      expect(log).not.toBeNull();
      expect((log!.metadata as { workingDays: number }).workingDays).toBe(3);
    });

    it("employee CANNOT cancel a request that's already approved (before-approval-only rule)", async () => {
      await request(server())
        .post(`/leave-requests/${requestR1Id}/cancel`)
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .expect(409);
    });

    it("rejecting a request that was only ever PENDING does not touch the balance", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-04-06", endDate: "2026-04-10" })
        .expect(201);
      const pendingId = (submitRes.body as LeaveRequestBody).id;

      const before = await annualBalance();

      const res = await request(server())
        .post(`/leave-requests/${pendingId}/reject`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(201);
      expect((res.body as LeaveRequestBody).status).toBe("rejected");

      const after = await annualBalance();
      expect(after).toBe(before); // untouched

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "LeaveRequest", entityId: pendingId, action: "reject" },
      });
      expect((log!.metadata as { restored: boolean }).restored).toBe(false);

      // The rejected request's date range is free again — resubmitting it
      // must create a NEW row, not reuse/reopen the rejected one.
      const resubmitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-04-06", endDate: "2026-04-10" })
        .expect(201);
      const resubmittedId = (resubmitRes.body as LeaveRequestBody).id;
      expect(resubmittedId).not.toBe(pendingId);

      const original = await superadmin.leaveRequest.findUniqueOrThrow({
        where: { id: pendingId },
      });
      expect(original.status).toBe("rejected");
      const bothRowsCount = await superadmin.leaveRequest.count({
        where: { id: { in: [pendingId, resubmittedId] } },
      });
      expect(bothRowsCount).toBe(2); // two distinct rows, not one reused
    });

    it("rejecting a request that was previously APPROVED restores exactly the deducted working days", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-05-04", endDate: "2026-05-08" })
        .expect(201);
      const requestId = (submitRes.body as LeaveRequestBody).id;

      const beforeApprove = await annualBalance();

      const approveRes = await request(server())
        .post(`/leave-requests/${requestId}/approve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({})
        .expect(201);
      const workingDays = Number((approveRes.body as LeaveRequestBody).workingDays);
      expect(workingDays).toBeGreaterThan(0);

      const afterApprove = await annualBalance();
      expect(afterApprove).toBe(beforeApprove - workingDays);

      const rejectRes = await request(server())
        .post(`/leave-requests/${requestId}/reject`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(201);
      expect((rejectRes.body as LeaveRequestBody).status).toBe("rejected");

      const afterReject = await annualBalance();
      expect(afterReject).toBe(beforeApprove); // fully restored, back to pre-approval value

      const logs = await superadmin.auditLog.findMany({
        where: {
          entity: "LeaveRequest",
          entityId: requestId,
          action: { in: ["approve", "reject"] },
        },
        orderBy: { timestamp: "asc" },
      });
      expect(logs.map((l) => l.action)).toEqual(["approve", "reject"]);
      expect((logs[1].metadata as { restored: boolean; workingDays: number }).restored).toBe(true);
      expect((logs[1].metadata as { restored: boolean; workingDays: number }).workingDays).toBe(
        workingDays,
      );
    });

    it("employee cancels their own pending request; it never touched the balance", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: annualLeaveTypeId, startDate: "2026-06-01", endDate: "2026-06-03" })
        .expect(201);
      const requestId = (submitRes.body as LeaveRequestBody).id;

      const before = await annualBalance();

      const res = await request(server())
        .post(`/leave-requests/${requestId}/cancel`)
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .expect(201);
      expect((res.body as LeaveRequestBody).status).toBe("cancelled");

      const after = await annualBalance();
      expect(after).toBe(before);

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "LeaveRequest", entityId: requestId, action: "cancel" },
      });
      expect(log).not.toBeNull();
    });

    it("insufficient balance is hard-blocked for a manager, even with force:true", async () => {
      const submitRes = await request(server())
        .post("/leave-requests")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ leaveTypeId: sickLeaveTypeId, startDate: "2026-03-02", endDate: "2026-03-06" })
        .expect(201);
      const requestId = (submitRes.body as LeaveRequestBody).id;

      // Mon-Fri, Fri is weekend -> 4 working days, requested against a
      // 3-day Sick Leave entitlement: insufficient.
      await request(server())
        .post(`/leave-requests/${requestId}/approve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({})
        .expect(409);

      await request(server())
        .post(`/leave-requests/${requestId}/approve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ force: true })
        .expect(409); // force is ignored for a non-admin scope

      // Both attempts threw inside the request's transaction, which rolls
      // back everything done within it — including the lazy proration
      // that would otherwise have first-touch-created this balance row.
      // Nothing persisted at all, which is stronger than "persisted but
      // unchanged": a blocked approval leaves zero trace in LeaveBalance.
      const balance = await superadmin.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employeeA1Id,
            leaveTypeId: sickLeaveTypeId,
            year: YEAR,
          },
        },
      });
      expect(balance).toBeNull();

      // A company_admin CAN force past it — balance is allowed to go negative.
      const approveRes = await request(server())
        .post(`/leave-requests/${requestId}/approve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ force: true })
        .expect(201);
      expect(Number((approveRes.body as LeaveRequestBody).workingDays)).toBe(4);

      const afterForce = await superadmin.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employeeA1Id,
            leaveTypeId: sickLeaveTypeId,
            year: YEAR,
          },
        },
      });
      expect(Number(afterForce!.balance)).toBe(-1); // 3 - 4, deliberately allowed negative

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "LeaveRequest", entityId: requestId, action: "approve" },
      });
      expect((log!.metadata as { forced: boolean }).forced).toBe(true);
    });

    it("GET /leave-balances (step 9.6): a manager sees an in-department employee's real balance, but an empty array for one outside their department", async () => {
      const inScope = await request(server())
        .get("/leave-balances")
        .query({ employeeId: employeeA1Id, year: YEAR })
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect(Array.isArray(inScope.body)).toBe(true);

      const employeeB1Me = await request(server())
        .get("/employees/me")
        .set("Authorization", `Bearer ${employeeB1Token}`)
        .expect(200);
      const employeeB1Id = (employeeB1Me.body as { id: string }).id;

      const outOfScope = await request(server())
        .get("/leave-balances")
        .query({ employeeId: employeeB1Id, year: YEAR })
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect(outOfScope.body).toEqual([]);
    });
  });
});
