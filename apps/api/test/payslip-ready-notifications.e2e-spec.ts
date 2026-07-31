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
import { EMAIL_SERVICE } from "../src/common/email/email.interface";
import { PayrollPdfService } from "../src/modules/payroll/payroll-pdf.service";
import { ThrowingEmailService } from "./throwing-email.service";

const MAILDEV_URL = "http://localhost:1080";

interface LoginResponseBody {
  status: string;
  accessToken?: string;
  pendingToken?: string;
}
interface PayrollRunBody {
  id: string;
  status: string;
}
interface MailDevEmailSummary {
  id: string;
  subject: string;
  to: { address: string }[];
}

/**
 * Closes verification-pass item 2: each employee gets a real email once
 * THEIR payslip's PDF is generated. No salary figures in the email body,
 * no direct/signed link to the PDF — only a plain login-gated /payslips
 * link, per the explicit "don't create a new way to access payslip data
 * outside RBAC" requirement. See DECISIONS.md.
 */
describe("Payslip-ready notifications (e2e)", () => {
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
    if (body.status === "ok") return body.accessToken!;
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

  it("finalizing a run emails each employee once THEIR payslip PDF is ready — real content, correct locale, no salary figures, no PDF/signed link", async () => {
    const company = await superadmin.company.create({
      data: { name: `PayslipNotif E2E Co ${runId}`, city: "Slemani" },
    });
    createdCompanyIds.push(company.id);

    const adminEmail = `psn-admin-${runId}@e2e.test`;
    const adminPassword = "psn-admin-password-123";
    const adminTotpSecret = authenticator.generateSecret();
    await superadmin.user.create({
      data: {
        companyId: company.id,
        email: adminEmail,
        passwordHash: await passwordService.hash(adminPassword),
        role: "company_admin",
        mustChangePassword: false,
        twoFaEnabled: true,
        twoFaSecret: encryptField(adminTotpSecret),
      },
    });

    const employeeEmail = `psn-emp-${runId}@e2e.test`;
    const employeeUser = await superadmin.user.create({
      data: {
        companyId: company.id,
        email: employeeEmail,
        passwordHash: await passwordService.hash("psn-employee-password-123"),
        role: "employee",
        locale: "ku",
        mustChangePassword: false,
      },
    });
    await superadmin.employee.create({
      data: {
        companyId: company.id,
        userId: employeeUser.id,
        fullName: "Payslip Notification Test Employee",
        nationalId: encryptField(`PSN-${runId}`),
        jobTitle: "Analyst",
        hireDate: new Date("2020-01-01"),
        salaryBase: "1500000.00",
        currency: "IQD",
        status: "active",
      },
    });

    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    const adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);

    const createRes = await request(server())
      .post("/payroll/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ periodStart: "2027-01-01", periodEnd: "2027-01-31" })
      .expect(201);
    const payrollRunId = (createRes.body as PayrollRunBody).id;

    await request(server())
      .post(`/payroll/runs/${payrollRunId}/finalize`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ acknowledgeUnverifiedRates: true })
      .expect(201);

    // Deterministic instead of polling for "finalized": directly invoke
    // the same job the queue would run, matching payroll.e2e-spec.ts's
    // own idempotency test's pattern. Real PDF generation, real storage
    // write, real DB update — nothing about the underlying job is mocked.
    await payrollPdfService.processRun({
      payrollRunId,
      companyId: company.id,
      actorUserId: adminToken,
    });

    const mail = await findEmailTo(employeeEmail);
    // Real, untranslated Sorani subject from src/i18n/ku/emails.json's
    // payslipReady.subject — the admin who finalized this run has no
    // stated locale (schema default "en"), proving this is the
    // EMPLOYEE's own stored locale.
    expect(mail.subject).toBe("فیشی موچەت ئامادەیە");
    const text = await fetchEmailText(mail.id);
    expect(text).toContain("چوونە ژوورەوە بۆ بینینی فیشی موچەت"); // linkText
    expect(text).toContain("http://localhost:3000/payslips");

    // No salary figures anywhere in the email — the whole point of this requirement.
    expect(text).not.toContain("1500000");
    expect(text).not.toContain("1,500,000");

    // No PDF/signed-url link either — only the plain, login-gated payslips page.
    expect(text).not.toMatch(/\.pdf/i);
    expect(text).not.toContain("signed-url");
    expect(text).not.toContain("token=");

    await deleteEmail(mail.id);
  }, 30000);

  describe("Notification failure isolation — a real, always-throwing EmailService", () => {
    it("PDF generation and run finalization still complete even though every payslip-ready email throws", async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(EMAIL_SERVICE)
        .useClass(ThrowingEmailService)
        .compile();

      const throwingApp = moduleFixture.createNestApplication();
      throwingApp.use(cookieParser());
      throwingApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await throwingApp.init();
      const throwingPayrollPdfService = moduleFixture.get(PayrollPdfService);

      try {
        const company = await superadmin.company.create({
          data: { name: `PayslipNotifThrowing E2E Co ${runId}`, city: "Slemani" },
        });
        createdCompanyIds.push(company.id);

        const adminEmail = `psn-throwing-admin-${runId}@e2e.test`;
        const adminPassword = "psn-throwing-admin-password-123";
        const adminTotpSecret = authenticator.generateSecret();
        await superadmin.user.create({
          data: {
            companyId: company.id,
            email: adminEmail,
            passwordHash: await passwordService.hash(adminPassword),
            role: "company_admin",
            mustChangePassword: false,
            twoFaEnabled: true,
            twoFaSecret: encryptField(adminTotpSecret),
          },
        });

        const employeeUser = await superadmin.user.create({
          data: {
            companyId: company.id,
            email: `psn-throwing-emp-${runId}@e2e.test`,
            passwordHash: await passwordService.hash("psn-throwing-employee-password-123"),
            role: "employee",
            mustChangePassword: false,
          },
        });
        await superadmin.employee.create({
          data: {
            companyId: company.id,
            userId: employeeUser.id,
            fullName: "Throwing Isolation Payslip Employee",
            nationalId: encryptField(`PSN-THROWING-${runId}`),
            jobTitle: "Analyst",
            hireDate: new Date("2020-01-01"),
            salaryBase: "1200000.00",
            currency: "IQD",
            status: "active",
          },
        });

        await superadmin.rolePermission.createMany({
          data: buildRolePermissionRows(company.id),
          skipDuplicates: true,
        });

        const throwingServer = throwingApp.getHttpServer() as Parameters<typeof request>[0];
        const login = await request(throwingServer)
          .post("/auth/login")
          .send({ email: adminEmail, password: adminPassword })
          .expect(200);
        const loginBody = login.body as LoginResponseBody;
        expect(loginBody.status).toBe("2fa_required");
        const verify = await request(throwingServer)
          .post("/auth/2fa/verify")
          .send({
            pendingToken: loginBody.pendingToken,
            code: authenticator.generate(adminTotpSecret),
          })
          .expect(200);
        const adminToken = (verify.body as LoginResponseBody).accessToken!;

        const createRes = await request(throwingServer)
          .post("/payroll/runs")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ periodStart: "2027-02-01", periodEnd: "2027-02-28" })
          .expect(201);
        const payrollRunId = (createRes.body as PayrollRunBody).id;

        await request(throwingServer)
          .post(`/payroll/runs/${payrollRunId}/finalize`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ acknowledgeUnverifiedRates: true })
          .expect(201);

        // The real proof: this must NOT throw, even though the injected
        // EmailService always does — PDF generation + run finalization
        // complete regardless.
        await throwingPayrollPdfService.processRun({
          payrollRunId,
          companyId: company.id,
          actorUserId: adminToken,
        });

        const run = await superadmin.payrollRun.findUniqueOrThrow({ where: { id: payrollRunId } });
        expect(run.status).toBe("finalized");

        const payslips = await superadmin.payslip.findMany({ where: { payrollRunId } });
        expect(payslips.length).toBeGreaterThan(0);
        expect(payslips.every((p) => p.pdfUrl !== null)).toBe(true);
      } finally {
        await throwingApp.close();
      }
    }, 30000);
  });
});
