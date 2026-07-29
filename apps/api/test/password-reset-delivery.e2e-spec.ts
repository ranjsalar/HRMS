import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PasswordService } from "../src/modules/auth/password.service";
import { buildRolePermissionRows } from "../src/database/seeds/default-role-permissions";

interface MailDevEmailSummary {
  id: string;
  subject: string;
  to: { address: string }[];
  from: { address: string }[];
}

const MAILDEV_URL = "http://localhost:1080";

/**
 * Real end-to-end proof that password-reset actually reaches a real
 * inbox and the link inside it actually works — not just "the email
 * object was constructed correctly" or "no exception was thrown".
 * Queries MailDev's own REST API (the local SMTP catcher this project's
 * dev environment runs — see docker-compose.yml `maildev` service) the
 * same way a human checking the MailDev web UI would, then extracts the
 * REAL token from the REAL HTML body and drives the REST confirm/login
 * calls with it. See DECISIONS.md ("Real password-reset email delivery").
 */
describe("Password reset — real email delivery (e2e)", () => {
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
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.user.deleteMany({ where: { companyId } });
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

  /** Polls MailDev's inbox for an email to this exact address — sending is a real async network call, not necessarily done the instant the HTTP response returns. */
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

  async function fetchEmailHtml(id: string): Promise<string> {
    const res = await fetch(`${MAILDEV_URL}/api/email/${id}/html`);
    return res.text();
  }

  async function deleteEmail(id: string): Promise<void> {
    await fetch(`${MAILDEV_URL}/api/email/${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  function extractResetLink(html: string): string {
    const match = /href="([^"]+)"/.exec(html);
    if (!match) throw new Error("No link found in the email body");
    return match[1];
  }

  it("a real request sends a real email with a real, working reset link — clicking through actually changes the password", async () => {
    const email = `real-delivery-${runId}@e2e.test`;
    const originalPassword = "original-password-123";

    const company = await superadmin.company.create({
      data: { name: `PasswordResetDelivery E2E Co ${runId}`, city: "Erbil" },
    });
    createdCompanyIds.push(company.id);
    await superadmin.user.create({
      data: {
        companyId: company.id,
        email,
        passwordHash: await passwordService.hash(originalPassword),
        role: "employee",
        mustChangePassword: false,
      },
    });
    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    await request(server()).post("/auth/password-reset/request").send({ email }).expect(200);

    const mail = await findEmailTo(email);
    expect(mail.subject).toBe("Reset your password");
    // Matches .env.test's EMAIL_FROM, deliberately distinct from dev's
    // no-reply@hrms.local (see .env) — same "test env has its own
    // values" convention as every other secret in this file.
    expect(mail.from[0].address).toBe("no-reply@hrms.test");

    const html = await fetchEmailHtml(mail.id);
    const link = extractResetLink(html);
    // Points at the WEB app's page, not the bare API route — a browser
    // clicking this must land somewhere that can actually complete the
    // flow (apps/web/src/app/reset-password/page.tsx reads ?token= and
    // POSTs it itself; the raw API endpoint is POST-only and wouldn't do
    // anything useful if a browser just navigated to it).
    expect(link).toMatch(/^http:\/\/localhost:3000\/reset-password\?token=/);
    const token = new URL(link).searchParams.get("token")!;
    expect(token.length).toBeGreaterThan(20);

    await deleteEmail(mail.id);

    // The real token, extracted from the real email, actually works.
    await request(server())
      .post("/auth/password-reset/confirm")
      .send({ token, newPassword: "brand-new-password-from-real-email-456" })
      .expect(200);

    // New password works; old one no longer does.
    const newLogin = await request(server())
      .post("/auth/login")
      .send({ email, password: "brand-new-password-from-real-email-456" })
      .expect(200);
    expect((newLogin.body as { status: string }).status).toBe("ok");

    await request(server())
      .post("/auth/login")
      .send({ email, password: originalPassword })
      .expect(401);
  }, 20000);

  it("a request with locale: 'ar' sends the REAL email in Arabic — proves the request-scoped locale (not user.locale, which is unpopulated/ungranted — see DECISIONS.md) actually drives what gets rendered", async () => {
    const email = `real-delivery-ar-${runId}@e2e.test`;

    const company = await superadmin.company.create({
      data: { name: `PasswordResetDelivery AR E2E Co ${runId}`, city: "Erbil" },
    });
    createdCompanyIds.push(company.id);
    await superadmin.user.create({
      data: {
        companyId: company.id,
        email,
        passwordHash: await passwordService.hash("original-password-123"),
        role: "employee",
        mustChangePassword: false,
      },
    });
    await superadmin.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    await request(server())
      .post("/auth/password-reset/request")
      .send({ email, locale: "ar" })
      .expect(200);

    const mail = await findEmailTo(email);
    // The real, untranslated Arabic subject line from src/i18n/ar/emails.json
    // — not a substring check, the whole point is this is genuinely
    // different content driven by the request, not the "en" default.
    expect(mail.subject).toBe("إعادة تعيين كلمة المرور");

    const html = await fetchEmailHtml(mail.id);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');

    await deleteEmail(mail.id);
  }, 20000);

  it("requesting a reset for a NONEXISTENT email sends no email at all — the generic response doesn't just hide account existence in the HTTP layer, nothing goes out over SMTP either", async () => {
    const nonexistentEmail = `nobody-${runId}@e2e.test`;

    await request(server())
      .post("/auth/password-reset/request")
      .send({ email: nonexistentEmail })
      .expect(200);

    // Give any (incorrect) send attempt a moment to land, then confirm
    // MailDev's inbox has nothing addressed to this email.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const res = await fetch(`${MAILDEV_URL}/api/email`);
    const emails = (await res.json()) as MailDevEmailSummary[];
    expect(emails.some((e) => e.to.some((t) => t.address === nonexistentEmail))).toBe(false);
  }, 10000);
});
