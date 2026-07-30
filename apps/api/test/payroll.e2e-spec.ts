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
import { PayrollPdfService } from "../src/modules/payroll/payroll-pdf.service";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
  pendingToken?: string;
}

interface PayrollRunBody {
  id: string;
  status: string;
}

interface PayslipBody {
  id: string;
  employeeId: string;
  pdfUrl: string | null;
  payrollRun?: { periodStart: string; periodEnd: string };
}

interface SignedUrlResponseBody {
  url: string;
}

describe("Payroll (e2e)", () => {
  let app: INestApplication;
  let superadmin: PrismaClient;
  let passwordService: PasswordService;
  let payrollPdfService: PayrollPdfService;
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
    payrollPdfService = moduleFixture.get(PayrollPdfService);
  });

  afterAll(async () => {
    for (const companyId of createdCompanyIds) {
      try {
        await superadmin.auditLog.deleteMany({ where: { companyId } });
        await superadmin.payslip.deleteMany({ where: { companyId } });
        await superadmin.payrollRun.deleteMany({ where: { companyId } });
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.employee.updateMany({ where: { companyId }, data: { userId: null } });
        await superadmin.user.deleteMany({ where: { companyId } });
        await superadmin.employee.deleteMany({ where: { companyId } });
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

  // 30 attempts (9s) was reliable on local dev hardware but too close to
  // Jest's own default 5000ms per-test timeout to begin with — the OUTER
  // Jest timeout could kill the test before this loop's own budget even
  // expired, on ANY machine, let alone a slower one. Real CI failure
  // confirmed this: apps/web's payslips.integration.spec.tsx hit the
  // identical underlying wait (same BullMQ payslip-PDF job) and got the
  // same fix earlier in this pass — this backend e2e test waits on the
  // exact same job but was missed at the time, since it lives in a
  // different file/app than the one that failed first. 80 attempts
  // (24s) plus the test's own explicit 30s Jest timeout below (see the
  // call site) gives real margin on both the inner retry budget and the
  // outer test-level ceiling, not just barely enough to pass once.
  async function waitForRunStatus(
    runIdToCheck: string,
    adminToken: string,
    expectedStatus: string,
    maxAttempts = 80,
  ): Promise<PayrollRunBody> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await request(server())
        .get(`/payroll/runs/${runIdToCheck}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const body = res.body as PayrollRunBody;
      if (body.status === expectedStatus) return body;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(
      `Timed out waiting for PayrollRun ${runIdToCheck} to reach "${expectedStatus}"`,
    );
  }

  describe("Lifecycle, RBAC, immutability, payslip access, PDF idempotency", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let employeeAToken: string;
    let employeeAId: string;
    let employeeBId: string;
    let terminatedEmployeeId: string;
    let onLeaveEmployeeId: string;
    let runIdVal: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Payroll E2E Co ${runId}`, city: "Erbil" }, // payrollRegion defaults to "krg", matching the seeded system default
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const adminEmail = `payrolladmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-payroll";
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

      const managerEmail = `payrollmanager-${runId}@e2e.test`;
      const managerPassword = "manager-password-payroll";
      await superadmin.user.create({
        data: {
          companyId,
          email: managerEmail,
          passwordHash: await passwordService.hash(managerPassword),
          role: "manager",
          mustChangePassword: false,
        },
      });

      const employeeAEmail = `payrolla-${runId}@e2e.test`;
      const employeeAPassword = "employee-password-a";
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
          fullName: "Active Employee A",
          nationalId: encryptField("PAY-A-NATIONAL-ID"),
          jobTitle: "Analyst",
          hireDate: new Date("2020-01-01T00:00:00.000Z"),
          salaryBase: "1000000.00",
          currency: "IQD",
          status: "active",
        },
      });
      employeeAId = employeeA.id;

      const employeeB = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "Active Employee B",
          nationalId: encryptField("PAY-B-NATIONAL-ID"),
          jobTitle: "Engineer",
          hireDate: new Date("2020-01-01T00:00:00.000Z"),
          salaryBase: "500.00",
          currency: "USD",
          status: "active",
        },
      });
      employeeBId = employeeB.id;

      const terminated = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "Terminated Employee",
          nationalId: encryptField("PAY-TERM-NATIONAL-ID"),
          jobTitle: "Former Rep",
          hireDate: new Date("2020-01-01T00:00:00.000Z"),
          salaryBase: "800000.00",
          currency: "IQD",
          status: "terminated",
        },
      });
      terminatedEmployeeId = terminated.id;

      const onLeave = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "On Leave Employee",
          nationalId: encryptField("PAY-LEAVE-NATIONAL-ID"),
          jobTitle: "Rep",
          hireDate: new Date("2020-01-01T00:00:00.000Z"),
          salaryBase: "900000.00",
          currency: "IQD",
          status: "on_leave",
        },
      });
      onLeaveEmployeeId = onLeave.id;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeAToken = await loginAndGetToken(employeeAEmail, employeeAPassword);
    });

    it("a non-admin (manager) cannot create a PayrollRun", async () => {
      await request(server())
        .post("/payroll/runs")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ periodStart: "2026-03-01", periodEnd: "2026-03-31" })
        .expect(403);
    });

    it("admin creates a draft run: payslips are generated for active + on_leave employees, NOT the terminated one", async () => {
      const createRes = await request(server())
        .post("/payroll/runs")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ periodStart: "2026-03-01", periodEnd: "2026-03-31" })
        .expect(201);
      const run = createRes.body as PayrollRunBody;
      expect(run.status).toBe("draft");
      runIdVal = run.id;

      const listRes = await request(server())
        .get(`/payroll/runs/${runIdVal}/payslips`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const payslips = listRes.body as PayslipBody[];
      const payslipEmployeeIds = payslips.map((p) => p.employeeId);

      expect(payslipEmployeeIds).toContain(employeeAId);
      expect(payslipEmployeeIds).toContain(employeeBId);
      expect(payslipEmployeeIds).toContain(onLeaveEmployeeId);
      expect(payslipEmployeeIds).not.toContain(terminatedEmployeeId);

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "PayrollRun", entityId: runIdVal, action: "create" },
      });
      expect(log).not.toBeNull();
    });

    it("a non-admin (manager) cannot finalize a PayrollRun", async () => {
      await request(server())
        .post(`/payroll/runs/${runIdVal}/finalize`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(403);
    });

    it("finalizing against the seeded (unverified) system-default rule is blocked without an explicit admin acknowledgment", async () => {
      // The seeded KRG system default is deliberately unverified — see
      // database/seeds/payroll-rules.ts. Admin, no acknowledgment: blocked.
      await request(server())
        .post(`/payroll/runs/${runIdVal}/finalize`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({})
        .expect(409);

      // A manager passing the acknowledgment flag is STILL blocked — the
      // flag is only honored for an actual company_admin (scope "all").
      await request(server())
        .post(`/payroll/runs/${runIdVal}/finalize`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ acknowledgeUnverifiedRates: true })
        .expect(403); // RBAC blocks the manager before the service is ever reached

      const run = await superadmin.payrollRun.findUniqueOrThrow({ where: { id: runIdVal } });
      expect(run.status).toBe("draft"); // neither blocked attempt changed anything
    });

    it("admin finalizes the run WITH an explicit acknowledgment; recomputing it afterward is rejected (immutability)", async () => {
      const finalizeRes = await request(server())
        .post(`/payroll/runs/${runIdVal}/finalize`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ acknowledgeUnverifiedRates: true })
        .expect(201);
      expect((finalizeRes.body as PayrollRunBody).status).toBe("processing");

      // Immutability kicks in the moment the run leaves "draft" — no need
      // to wait for the async PDF job to finish generating for this
      // particular guard to already be in effect.
      await request(server())
        .post(`/payroll/runs/${runIdVal}/recompute`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "PayrollRun", entityId: runIdVal, action: "finalize" },
      });
      expect(log).not.toBeNull();
      // The acknowledgment is captured in the audit trail, not silently accepted.
      expect(
        (log!.metadata as { unverifiedRatesAcknowledged: boolean }).unverifiedRatesAcknowledged,
      ).toBe(true);
    });

    it("the run reaches 'finalized' once the PDF job completes, with every payslip PDF'd", async () => {
      const finalRun = await waitForRunStatus(runIdVal, adminToken, "finalized");
      expect(finalRun.status).toBe("finalized");

      const listRes = await request(server())
        .get(`/payroll/runs/${runIdVal}/payslips`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const payslips = listRes.body as PayslipBody[];
      expect(payslips.every((p) => p.pdfUrl !== null)).toBe(true);
    }, 30000); // waitForRunStatus's own 80-attempt (24s) budget. // default just because this one needs it. Comfortably above // hung test; other tests in this suite shouldn't get a longer // legitimately long-running async wait on a real BullMQ job, not a // Per-test timeout, not a global Jest config change — this is a

    it("an employee can retrieve their own finalized payslip, byte-for-byte, but NOT another employee's — even in the same company", async () => {
      const myRes = await request(server())
        .get("/payslips/me")
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(200);
      const myPayslips = myRes.body as PayslipBody[];
      expect(myPayslips.length).toBeGreaterThan(0);
      expect(myPayslips.every((p) => p.employeeId === employeeAId)).toBe(true);
      // step 9.4: the self-service list includes the parent run's period —
      // there's no other self-service endpoint an employee could use to
      // look this up (payroll run reads are admin-only).
      expect(myPayslips[0].payrollRun?.periodStart).toBeTruthy();
      expect(myPayslips[0].payrollRun?.periodEnd).toBeTruthy();
      const myPayslipId = myPayslips[0].id;

      const signedUrlRes = await request(server())
        .get(`/payslips/${myPayslipId}/signed-url`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(200);
      const { url } = signedUrlRes.body as SignedUrlResponseBody;

      const downloadRes = await request(server()).get(url).expect(200);
      expect(downloadRes.headers["content-type"]).toBe("application/pdf");
      const buffer = downloadRes.body as Buffer;
      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-"); // real PDF magic bytes, not a placeholder

      // Find employee B's payslip in the same run and confirm A cannot
      // reach it at all — existence not revealed (404, not 403).
      const otherPayslip = await superadmin.payslip.findFirstOrThrow({
        where: { payrollRunId: runIdVal, employeeId: employeeBId },
      });
      await request(server())
        .get(`/payslips/${otherPayslip.id}/signed-url`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(404);
    });

    it("PDF generation is idempotent: invoking the job a second time for an already-finalized run duplicates nothing and corrupts nothing", async () => {
      const before = await superadmin.payslip.findMany({
        where: { payrollRunId: runIdVal },
        orderBy: { id: "asc" },
      });
      expect(before.every((p) => p.pdfUrl !== null)).toBe(true);
      const beforeUrls = before.map((p) => p.pdfUrl);
      const beforeGeneratedAt = before.map((p) => p.generatedAt?.toISOString());

      // Direct second invocation — bypasses the API's "only a draft run
      // can be finalized" guard entirely, exercising the job's own
      // idempotency rather than the API-level guard tested earlier.
      await payrollPdfService.processRun({
        payrollRunId: runIdVal,
        companyId,
        actorUserId: "re-invocation-test",
      });

      const after = await superadmin.payslip.findMany({
        where: { payrollRunId: runIdVal },
        orderBy: { id: "asc" },
      });
      expect(after.length).toBe(before.length); // no duplicate payslip rows
      expect(after.map((p) => p.pdfUrl)).toEqual(beforeUrls); // same storage keys, not reassigned
      expect(after.map((p) => p.generatedAt?.toISOString())).toEqual(beforeGeneratedAt); // never re-stamped — genuinely skipped, not silently re-run

      const runAfter = await superadmin.payrollRun.findUniqueOrThrow({ where: { id: runIdVal } });
      expect(runAfter.status).toBe("finalized");
      expect(runAfter.finalizedBy).not.toBe("re-invocation-test"); // the original finalizer is preserved, not overwritten by the re-invocation

      // The stored PDF bytes themselves are still intact, not corrupted
      // by a second write.
      const employeeAPayslip = after.find((p) => p.employeeId === employeeAId)!;
      const signedUrlRes = await request(server())
        .get(`/payslips/${employeeAPayslip.id}/signed-url`)
        .set("Authorization", `Bearer ${employeeAToken}`)
        .expect(200);
      const { url } = signedUrlRes.body as SignedUrlResponseBody;
      const downloadRes = await request(server()).get(url).expect(200);
      expect((downloadRes.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }, 30000); // underlying reason. // the previous test. Same 30s budget as that test, for the same // once that call was made slow, not just as a downstream failure of // DECISIONS.md): this test independently hit Jest's 5000ms default // testing with an artificial delay injected into that method (see // and had no explicit timeout either. Found by actually stress- // exact same operation the previous test waits on via the queue — // This test also directly calls payrollPdfService.processRun() — the
  });
});
