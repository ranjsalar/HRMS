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

interface EmployeeResponseBody {
  id: string;
  nationalId: string;
  bankAccount: string | null;
  status: string;
}

interface SignedUrlResponseBody {
  url: string;
}

// Real magic bytes for a minimal PDF — used for the document upload test.
const PDF_BYTES = Buffer.from("%PDF-1.4\n%test-document\n1 0 obj\n<< >>\nendobj\n");

// Real Windows PE/MZ executable header bytes, padded out — attached with a
// ".pdf" filename and no honest content-type below, to prove
// validateDocumentFile is consulting the BYTES, not the filename/claimed
// content-type an attacker fully controls. Same header used in the unit
// test (file-validation.spec.ts).
const EXE_BYTES = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
  0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00,
]);

describe("Employee Management (e2e)", () => {
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
        await superadmin.document.deleteMany({ where: { companyId } });
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

  // company_admin mandates 2FA (TwoFactorService.roleRequiresTwoFactor), so
  // fixtures for that role pre-enroll a known TOTP secret and this helper
  // completes the verify step with a freshly generated code. manager/
  // employee fixtures have no totpSecret and log in immediately.
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

  describe("Field encryption", () => {
    let adminToken: string;
    let adminUserId: string;
    let companyId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Encryption E2E Co ${runId}`, city: "Slemani" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const adminEmail = `encadmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-123";
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
      adminUserId = adminUser.id;
      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
    });

    it("stores nationalId/bankAccount as ciphertext, not plaintext — verified against the RAW DB row", async () => {
      const plainNationalId = "SECRET-NATIONAL-ID-998877";
      const plainBankAccount = "IQ00-BANK-ACCOUNT-12345";

      const createRes = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Ciphertext Test",
          nationalId: plainNationalId,
          jobTitle: "Analyst",
          hireDate: "2024-01-01",
          salaryBase: 500000,
          bankAccount: plainBankAccount,
        })
        .expect(201);

      const created = createRes.body as EmployeeResponseBody;
      // The API response itself decrypts for the authorized caller — that's expected.
      expect(created.nationalId).toBe(plainNationalId);

      // Now bypass the service/API entirely and read the raw row directly
      // via the superadmin Prisma client — this is what's actually
      // sitting in Postgres.
      const raw = await superadmin.employee.findUniqueOrThrow({ where: { id: created.id } });

      expect(raw.nationalId).not.toBe(plainNationalId);
      expect(raw.nationalId).not.toContain(plainNationalId);
      // encryptField's format: base64(iv):base64(authTag):base64(ciphertext)
      expect(raw.nationalId).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

      expect(raw.bankAccount).not.toBe(plainBankAccount);
      expect(raw.bankAccount).not.toContain(plainBankAccount);
      expect(raw.bankAccount).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it("writes an AuditLog row for the employee create, with the correct action/entity/entityId/userId/companyId", async () => {
      const createRes = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          fullName: "Audited Create",
          nationalId: "AUDIT-CREATE-NATIONAL-ID",
          jobTitle: "Analyst",
          hireDate: "2024-01-01",
          salaryBase: 500000,
        })
        .expect(201);
      const created = createRes.body as EmployeeResponseBody;

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "Employee", entityId: created.id, action: "create" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(adminUserId);
      expect(log!.companyId).toBe(companyId);
    });
  });

  describe("Manager cross-department CRUD + document access blocked", () => {
    let companyId: string;
    let adminToken: string;
    let adminUserId: string;
    let managerToken: string;
    let managerUserId: string;
    let managedEmployeeId: string;
    let otherEmployeeId: string;
    let managedDeptDocumentId: string;
    let otherDeptDocumentId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `CrossDept E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId: company.id, name: "Sales" } }),
        superadmin.department.create({ data: { companyId: company.id, name: "Support" } }),
      ]);

      const adminEmail = `crossadmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-456";
      const adminTotpSecret = authenticator.generateSecret();
      const adminUser = await superadmin.user.create({
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
      adminUserId = adminUser.id;

      const managerEmail = `crossmanager-${runId}@e2e.test`;
      const managerPassword = "manager-password-456";
      const managerUser = await superadmin.user.create({
        data: {
          companyId: company.id,
          email: managerEmail,
          passwordHash: await passwordService.hash(managerPassword),
          role: "manager",
          mustChangePassword: false,
        },
      });
      managerUserId = managerUser.id;
      await superadmin.employee.create({
        data: {
          companyId: company.id,
          userId: managerUser.id,
          fullName: "Cross Dept Manager",
          nationalId: encryptField("MGR-NATIONAL-ID"),
          jobTitle: "Sales Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "600000.00",
        },
      });

      const managedEmployee = await superadmin.employee.create({
        data: {
          companyId: company.id,
          fullName: "In Sales",
          nationalId: encryptField("EMP-A-NATIONAL-ID"),
          jobTitle: "Sales Rep",
          departmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      managedEmployeeId = managedEmployee.id;

      const otherEmployee = await superadmin.employee.create({
        data: {
          companyId: company.id,
          fullName: "In Support",
          nationalId: encryptField("EMP-B-NATIONAL-ID"),
          jobTitle: "Support Rep",
          departmentId: deptB.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      otherEmployeeId = otherEmployee.id;

      // Default matrix gives manager employees:{view,edit} at own_department
      // but no create/delete — add those explicitly, own_department scoped,
      // specifically to exercise "manager cannot create/edit outside their
      // managed department" per the founder's ask. This is exactly the kind
      // of custom grant the RBAC CRUD module (step 4) exists to support.
      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(company.id),
        skipDuplicates: true,
      });
      await superadmin.rolePermission.create({
        data: {
          companyId: company.id,
          role: "manager",
          module: "employees",
          action: "create",
          scope: "own_department",
        },
      });

      managerToken = await loginAndGetToken(managerEmail, managerPassword);

      // Two documents, one per employee/department, uploaded by the admin
      // (who has documents:create; managers don't by default).
      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      const managedDoc = await request(server())
        .post("/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("employeeId", managedEmployeeId)
        .field("type", "contract")
        .attach("file", PDF_BYTES, "contract.pdf")
        .expect(201);
      managedDeptDocumentId = (managedDoc.body as { id: string }).id;

      const otherDoc = await request(server())
        .post("/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("employeeId", otherEmployeeId)
        .field("type", "contract")
        .attach("file", PDF_BYTES, "contract.pdf")
        .expect(201);
      otherDeptDocumentId = (otherDoc.body as { id: string }).id;
    });

    it("manager CAN create an employee inside their managed department", async () => {
      const res = await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          fullName: "New Hire In Scope",
          nationalId: "NEW-HIRE-NATIONAL-ID",
          jobTitle: "Junior Rep",
          hireDate: "2024-06-01",
          salaryBase: 350000,
        })
        .expect(201);
      const createdId = (res.body as EmployeeResponseBody).id;
      expect(createdId).toBeDefined();

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "Employee", entityId: createdId, action: "create" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(managerUserId);
      expect(log!.companyId).toBe(companyId);
    });

    it("manager CANNOT create an employee explicitly targeting another department (403)", async () => {
      const otherDept = await superadmin.department.findFirstOrThrow({
        where: { name: "Support" },
      });
      await request(server())
        .post("/employees")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          fullName: "Should Be Rejected",
          nationalId: "REJECTED-NATIONAL-ID",
          jobTitle: "Rep",
          departmentId: otherDept.id,
          hireDate: "2024-06-01",
          salaryBase: 350000,
        })
        .expect(403);
    });

    it("manager CAN edit an employee inside their managed department", async () => {
      await request(server())
        .patch(`/employees/${managedEmployeeId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ jobTitle: "Senior Sales Rep" })
        .expect(200);

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "Employee", entityId: managedEmployeeId, action: "update" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(managerUserId);
      expect(log!.companyId).toBe(companyId);
    });

    it("manager CANNOT edit an employee outside their managed department (404, not 403 — matches the read pattern: existence isn't revealed)", async () => {
      await request(server())
        .patch(`/employees/${otherEmployeeId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ jobTitle: "Hacked Title" })
        .expect(404);

      // Confirm the row was genuinely untouched.
      const stillOriginal = await superadmin.employee.findUniqueOrThrow({
        where: { id: otherEmployeeId },
      });
      expect(stillOriginal.jobTitle).toBe("Support Rep");
    });

    it("manager CAN generate a signed document URL for a document in their managed department", async () => {
      const res = await request(server())
        .get(`/documents/${managedDeptDocumentId}/signed-url`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect((res.body as SignedUrlResponseBody).url).toContain("/documents/download?token=");

      const log = await superadmin.auditLog.findFirst({
        where: {
          entity: "Document",
          entityId: managedDeptDocumentId,
          action: "generate_signed_url",
        },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(managerUserId);
      expect(log!.companyId).toBe(companyId);
    });

    it("wrote an AuditLog row for the document upload performed in beforeAll, attributed to the uploading admin", async () => {
      const log = await superadmin.auditLog.findFirst({
        where: { entity: "Document", entityId: managedDeptDocumentId, action: "upload" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(adminUserId);
      expect(log!.companyId).toBe(companyId);
    });

    it("rejects a file whose magic bytes don't match its claimed extension (a renamed executable) — the bytes are what's checked, never the filename", async () => {
      await request(server())
        .post("/documents")
        .set("Authorization", `Bearer ${adminToken}`)
        .field("employeeId", managedEmployeeId)
        .field("type", "certificate")
        .attach("file", EXE_BYTES, "totally-a-resume.pdf")
        .expect(400);

      // Confirm nothing was persisted for the rejected upload.
      const count = await superadmin.document.count({
        where: { companyId, employeeId: managedEmployeeId, type: "certificate" },
      });
      expect(count).toBe(0);
    });

    it("manager CANNOT generate a signed document URL for a document outside their managed department (404)", async () => {
      await request(server())
        .get(`/documents/${otherDeptDocumentId}/signed-url`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(404);
    });

    it("a generated signed URL actually downloads the original file bytes", async () => {
      const signedUrlRes = await request(server())
        .get(`/documents/${managedDeptDocumentId}/signed-url`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      const { url } = signedUrlRes.body as SignedUrlResponseBody;

      const downloadRes = await request(server()).get(url).expect(200);
      expect(Buffer.compare(downloadRes.body as Buffer, PDF_BYTES)).toBe(0);
      expect(downloadRes.headers["content-type"]).toBe("application/pdf");
    });
  });

  describe("Self-service profile (/employees/me) — the salaryBase/nationalId/bankAccount/departmentId/branchId guard", () => {
    let companyId: string;
    let employeeToken: string;
    let employeeId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `SelfProfile E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const email = `selfprofile-${runId}@e2e.test`;
      const password = "self-profile-password";
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
          fullName: "Self Service Employee",
          nationalId: encryptField("SELF-NATIONAL-ID"),
          jobTitle: "Analyst",
          hireDate: new Date(),
          salaryBase: "500000.00",
        },
      });
      employeeId = employee.id;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      employeeToken = await loginAndGetToken(email, password);
    });

    it("GET /employees/me resolves the caller's own record without needing to know their Employee id", async () => {
      const res = await request(server())
        .get("/employees/me")
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);
      expect((res.body as { id: string }).id).toBe(employeeId);
    });

    it("PATCH /employees/me updates contact fields", async () => {
      const res = await request(server())
        .patch("/employees/me")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({
          phone: "+964 750 123 4567",
          address: "Erbil, Kurdistan",
          emergencyContactName: "A Relative",
          emergencyContactPhone: "+964 750 999 8888",
        })
        .expect(200);

      const body = res.body as {
        phone: string;
        address: string;
        emergencyContactName: string;
        emergencyContactPhone: string;
      };
      expect(body.phone).toBe("+964 750 123 4567");
      expect(body.address).toBe("Erbil, Kurdistan");
      expect(body.emergencyContactName).toBe("A Relative");
      expect(body.emergencyContactPhone).toBe("+964 750 999 8888");
    });

    it("PATCH /employees/me rejects a crafted salaryBase with a 400 — UpdateOwnEmployeeDto structurally has no such field, so the global whitelist pipe rejects it before it ever reaches the service", async () => {
      await request(server())
        .patch("/employees/me")
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ phone: "555", salaryBase: 999999999 })
        .expect(400);

      const stillOriginal = await superadmin.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      expect(Number(stillOriginal.salaryBase)).toBe(500000);
    });

    it("PATCH /employees/:id (general route, own id) with a crafted salaryBase/nationalId/bankAccount/departmentId/branchId is rejected with a 403 by the SERVICE's scope allow-list — not just hidden by the frontend", async () => {
      const res = await request(server())
        .patch(`/employees/${employeeId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ salaryBase: 999999999, bankAccount: "attacker-account" })
        .expect(403);

      expect((res.body as { message: string }).message).toContain("salaryBase");
      expect((res.body as { message: string }).message).toContain("bankAccount");

      const stillOriginal = await superadmin.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      expect(Number(stillOriginal.salaryBase)).toBe(500000);
    });

    it("PATCH /employees/:id (general route, own id) with only contact fields is allowed for self-scope", async () => {
      await request(server())
        .patch(`/employees/${employeeId}`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ phone: "+964 750 000 0000" })
        .expect(200);
    });
  });

  describe("Self-service document upload (/documents/me + upload scope enforcement)", () => {
    let companyId: string;
    let employeeToken: string;
    let employeeId: string;
    let otherEmployeeId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `SelfDocUpload E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const email = `selfdoc-${runId}@e2e.test`;
      const password = "self-doc-password";
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
          fullName: "Self Doc Employee",
          nationalId: encryptField("SELFDOC-NATIONAL-ID"),
          jobTitle: "Analyst",
          hireDate: new Date(),
          salaryBase: "500000.00",
        },
      });
      employeeId = employee.id;

      const other = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "Someone Else",
          nationalId: encryptField("SELFDOC-OTHER-NATIONAL-ID"),
          jobTitle: "Analyst",
          hireDate: new Date(),
          salaryBase: "500000.00",
        },
      });
      otherEmployeeId = other.id;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      employeeToken = await loginAndGetToken(email, password);
    });

    it("an employee can upload a document for THEMSELVES (new self-scope grant, step 9.4)", async () => {
      const res = await request(server())
        .post("/documents")
        .set("Authorization", `Bearer ${employeeToken}`)
        .field("employeeId", employeeId)
        .field("type", "id")
        .attach("file", PDF_BYTES, "id-scan.pdf")
        .expect(201);
      expect((res.body as { employeeId: string }).employeeId).toBe(employeeId);
    });

    it("an employee CANNOT upload a document targeting a DIFFERENT employeeId, even in the same company (404, scope check enforced)", async () => {
      await request(server())
        .post("/documents")
        .set("Authorization", `Bearer ${employeeToken}`)
        .field("employeeId", otherEmployeeId)
        .field("type", "id")
        .attach("file", PDF_BYTES, "id-scan.pdf")
        .expect(404);

      const count = await superadmin.document.count({ where: { employeeId: otherEmployeeId } });
      expect(count).toBe(0);
    });

    it("GET /documents/me returns only the caller's own documents", async () => {
      const res = await request(server())
        .get("/documents/me")
        .set("Authorization", `Bearer ${employeeToken}`)
        .expect(200);

      const docs = res.body as { employeeId: string }[];
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.every((d) => d.employeeId === employeeId)).toBe(true);
    });
  });

  describe("Soft-delete", () => {
    let companyId: string;
    let adminToken: string;
    let adminUserId: string;
    let employeeId: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `SoftDelete E2E Co ${runId}`, city: "Slemani" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const adminEmail = `deladmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-789";
      const adminTotpSecret = authenticator.generateSecret();
      const adminUser = await superadmin.user.create({
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
      adminUserId = adminUser.id;
      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(company.id),
        skipDuplicates: true,
      });

      const employee = await superadmin.employee.create({
        data: {
          companyId: company.id,
          fullName: "To Be Terminated",
          nationalId: encryptField("DEL-NATIONAL-ID"),
          jobTitle: "Contractor",
          hireDate: new Date(),
          salaryBase: "300000.00",
        },
      });
      employeeId = employee.id;

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
    });

    it("DELETE soft-deletes: the row survives with status=terminated, it is not actually removed", async () => {
      await request(server())
        .delete(`/employees/${employeeId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(204);

      const raw = await superadmin.employee.findUnique({ where: { id: employeeId } });
      expect(raw).not.toBeNull();
      expect(raw!.status).toBe("terminated");
    });

    it("writes an AuditLog row for the soft-delete, with the correct action/entity/entityId/userId/companyId", async () => {
      const log = await superadmin.auditLog.findFirst({
        where: { entity: "Employee", entityId: employeeId, action: "soft_delete" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(adminUserId);
      expect(log!.companyId).toBe(companyId);
    });
  });
});
