import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { EMAIL_SERVICE } from "../src/common/email/email.interface";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";
import { ThrowingEmailService } from "./throwing-email.service";

const MAILDEV_URL = "http://localhost:1080";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
}
interface LeaveRequestBody {
  id: string;
  status: string;
}
interface MailDevEmailSummary {
  id: string;
  subject: string;
  to: { address: string }[];
}

/**
 * Closes verification-pass item 1 (of the notifications-expansion
 * scope): a manager/admin decision on a LeaveRequest now emails the
 * submitting employee. Same rigor as every other real-email feature in
 * this build: real MailDev delivery, real content assertions, real
 * locale behavior — plus a dedicated failure-isolation proof, which
 * nothing else in this codebase has needed to test this explicitly
 * before (see DECISIONS.md).
 */
describe("Leave decision notifications (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  const createdCompanyIds: string[] = [];
  const runId = Date.now().toString(36);

  let companyId: string;
  let departmentId: string;
  let leaveTypeId: string;
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
      data: { name: `LeaveDecisionNotif E2E Co ${runId}`, city: "Erbil" },
    });
    companyId = company.id;
    createdCompanyIds.push(companyId);

    const department = await superadmin.department.create({
      data: { companyId, name: "Engineering" },
    });
    departmentId = department.id;

    const leaveType = await superadmin.leaveType.create({
      data: { companyId, name: "Annual Leave", daysPerYear: 20 },
    });
    leaveTypeId = leaveType.id;

    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(companyId),
      skipDuplicates: true,
    });

    const managerEmail = `ldn-manager-${runId}@e2e.test`;
    const managerPassword = "ldn-manager-password-123";
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
        fullName: "LDN Manager",
        nationalId: `LDN-MGR-${runId}`,
        jobTitle: "Engineering Manager",
        managedDepartmentId: departmentId,
        hireDate: new Date("2023-01-01"),
        salaryBase: "700000.00",
      },
    });
    const managerLogin = await request(server())
      .post("/auth/login")
      .send({ email: managerEmail, password: managerPassword })
      .expect(200);
    expect((managerLogin.body as LoginResponseBody).status).toBe("ok");
    managerToken = (managerLogin.body as LoginResponseBody).accessToken!;
  }, 30000);

  afterAll(async () => {
    for (const id of createdCompanyIds) {
      try {
        await superadmin.auditLog.deleteMany({ where: { companyId: id } });
        await superadmin.leaveRequest.deleteMany({ where: { companyId: id } });
        await superadmin.leaveBalance.deleteMany({ where: { companyId: id } });
        await superadmin.leaveType.deleteMany({ where: { companyId: id } });
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

  async function createEmployeeWithLogin(
    label: string,
    locale: "en" | "ar" | "ku",
  ): Promise<{ token: string; email: string }> {
    const email = `ldn-${label}-${runId}@e2e.test`;
    const password = `ldn-${label}-password-123`;
    await superadmin.user.create({
      data: {
        companyId,
        email,
        passwordHash: await passwordService.hash(password),
        role: "employee",
        locale,
        mustChangePassword: false,
      },
    });
    const login = await request(server()).post("/auth/login").send({ email, password }).expect(200);
    return { token: (login.body as LoginResponseBody).accessToken!, email };
  }

  async function linkEmployeeRecord(userEmail: string, fullName: string): Promise<void> {
    const user = await superadmin.user.findFirstOrThrow({ where: { companyId, email: userEmail } });
    await superadmin.employee.create({
      data: {
        companyId,
        userId: user.id,
        fullName,
        nationalId: `LDN-${fullName}-${runId}`,
        jobTitle: "Engineer",
        departmentId,
        hireDate: new Date("2024-01-01"),
        salaryBase: "500000.00",
      },
    });
  }

  async function submitLeaveRequest(
    employeeToken: string,
    startDate: string,
    endDate: string,
  ): Promise<string> {
    const res = await request(server())
      .post("/leave-requests")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ leaveTypeId, startDate, endDate })
      .expect(201);
    return (res.body as LeaveRequestBody).id;
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

  it("approving a pending request emails the employee: leave type, date range, and approved status", async () => {
    const employee = await createEmployeeWithLogin("approve-emp", "en");
    await linkEmployeeRecord(employee.email, "Approve Test Employee");
    const requestId = await submitLeaveRequest(employee.token, "2027-11-01", "2027-11-02");

    await request(server())
      .post(`/leave-requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({})
      .expect(201);

    const mail = await findEmailTo(employee.email);
    expect(mail.subject).toBe("Your leave request has been approved");
    const text = await fetchEmailText(mail.id);
    expect(text).toContain("Annual Leave");
    expect(text).toContain("November 1, 2027");
    expect(text).toContain("November 2, 2027");
    expect(text).toContain("has been approved");
    await deleteEmail(mail.id);
  }, 20000);

  it("rejecting WITH a reason emails the employee including that reason", async () => {
    const employee = await createEmployeeWithLogin("reject-reason-emp", "en");
    await linkEmployeeRecord(employee.email, "Reject Reason Test Employee");
    const requestId = await submitLeaveRequest(employee.token, "2027-11-10", "2027-11-11");

    await request(server())
      .post(`/leave-requests/${requestId}/reject`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "Team is short-staffed that week" })
      .expect(201);

    const mail = await findEmailTo(employee.email);
    expect(mail.subject).toBe("Your leave request has been rejected");
    const text = await fetchEmailText(mail.id);
    expect(text).toContain("has been rejected");
    expect(text).toContain("Reason: Team is short-staffed that week");
    await deleteEmail(mail.id);

    const stored = await superadmin.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stored.rejectionReason).toBe("Team is short-staffed that week");
  }, 20000);

  it("rejecting WITHOUT a reason emails the employee with no reason line", async () => {
    const employee = await createEmployeeWithLogin("reject-noreason-emp", "en");
    await linkEmployeeRecord(employee.email, "Reject No Reason Test Employee");
    const requestId = await submitLeaveRequest(employee.token, "2027-11-15", "2027-11-16");

    await request(server())
      .post(`/leave-requests/${requestId}/reject`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({})
      .expect(201);

    const mail = await findEmailTo(employee.email);
    const text = await fetchEmailText(mail.id);
    expect(text).not.toContain("Reason:");
    await deleteEmail(mail.id);
  }, 20000);

  it("uses the EMPLOYEE's own stored locale, not the approving manager's — real Arabic email content", async () => {
    const employee = await createEmployeeWithLogin("arabic-emp", "ar");
    await linkEmployeeRecord(employee.email, "Arabic Locale Test Employee");
    const requestId = await submitLeaveRequest(employee.token, "2027-11-20", "2027-11-21");

    await request(server())
      .post(`/leave-requests/${requestId}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({})
      .expect(201);

    const mail = await findEmailTo(employee.email);
    // Real, untranslated Arabic subject from src/i18n/ar/emails.json's
    // leaveDecision.subjectApproved — the manager who approved this is
    // NOT Arabic-locale, proving this is the employee's own stored
    // locale, not a request-scoped one.
    expect(mail.subject).toBe("تمت الموافقة على طلب إجازتك");
    await deleteEmail(mail.id);
  }, 20000);

  it("approving a request for a record-only employee (no User/login) succeeds with no email attempted", async () => {
    const recordOnlyEmployee = await superadmin.employee.create({
      data: {
        companyId,
        fullName: "Record Only Employee",
        nationalId: `LDN-RECORD-ONLY-${runId}`,
        jobTitle: "Contractor",
        departmentId,
        hireDate: new Date("2024-01-01"),
        salaryBase: "400000.00",
      },
    });
    const recordOnlyRequest = await superadmin.leaveRequest.create({
      data: {
        companyId,
        employeeId: recordOnlyEmployee.id,
        leaveTypeId,
        startDate: new Date("2027-11-25"),
        endDate: new Date("2027-11-25"),
      },
    });

    // No error, no hang — the missing userId short-circuits notifyDecision cleanly.
    await request(server())
      .post(`/leave-requests/${recordOnlyRequest.id}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({})
      .expect(201);
  }, 15000);

  describe("Notification failure isolation — a real, always-throwing EmailService", () => {
    let throwingApp: INestApplication;
    let throwingManagerToken: string;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(EMAIL_SERVICE)
        .useClass(ThrowingEmailService)
        .compile();

      throwingApp = moduleFixture.createNestApplication();
      throwingApp.use(cookieParser());
      throwingApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await throwingApp.init();

      const login = await request(throwingApp.getHttpServer() as Parameters<typeof request>[0])
        .post("/auth/login")
        .send({
          email: (await superadmin.user.findFirstOrThrow({ where: { companyId, role: "manager" } }))
            .email,
          password: "ldn-manager-password-123",
        })
        .expect(200);
      throwingManagerToken = (login.body as LoginResponseBody).accessToken!;
    }, 20000);

    afterAll(async () => {
      await throwingApp.close();
    });

    it("approving still succeeds and the status is really updated, even though the email transport always throws", async () => {
      const employee = await createEmployeeWithLogin("throwing-emp", "en");
      await linkEmployeeRecord(employee.email, "Throwing Isolation Test Employee");
      const requestId = await submitLeaveRequest(employee.token, "2027-12-01", "2027-12-02");

      const res = await request(throwingApp.getHttpServer() as Parameters<typeof request>[0])
        .post(`/leave-requests/${requestId}/approve`)
        .set("Authorization", `Bearer ${throwingManagerToken}`)
        .send({})
        .expect(201);
      expect((res.body as LeaveRequestBody).status).toBe("approved");

      // Confirmed directly against the DB too, not just the HTTP response.
      const stored = await superadmin.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(stored.status).toBe("approved");

      // And genuinely no email arrived — the failure was real, not swallowed silently before even trying.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const res2 = await fetch(`${MAILDEV_URL}/api/email`);
      const emails = (await res2.json()) as MailDevEmailSummary[];
      expect(emails.some((e) => e.to.some((t) => t.address === employee.email))).toBe(false);
    }, 20000);
  });
});
