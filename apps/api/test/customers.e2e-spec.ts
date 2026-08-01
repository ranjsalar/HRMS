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

interface CustomerResponseBody {
  id: string;
  companyId: string;
  name: string;
  type: string;
  ownerId: string | null;
}

interface ContactResponseBody {
  id: string;
  fullName: string;
  isPrimary: boolean;
}

interface CustomerDetailResponseBody extends CustomerResponseBody {
  contacts: ContactResponseBody[];
}

describe("Sales module — Customer + CustomerContact CRUD (e2e)", () => {
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
        await superadmin.salesOrderLine.deleteMany({ where: { companyId } });
        await superadmin.salesOrder.deleteMany({ where: { companyId } });
        await superadmin.deal.deleteMany({ where: { companyId } });
        await superadmin.customerContact.deleteMany({ where: { companyId } });
        await superadmin.lead.deleteMany({ where: { companyId } });
        await superadmin.customer.deleteMany({ where: { companyId } });
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

  describe("Read is company-wide, write is owner-scoped", () => {
    let companyId: string;
    let adminToken: string;
    let managerToken: string;
    let repToken: string; // employee in deptA, explicitly opted into sales
    let unGrantedEmployeeToken: string; // employee with NO sales grant at all
    let repEmployeeId: string;
    let otherRepEmployeeId: string; // deptB — outside the manager's department
    let repCustomerId: string; // owned by repEmployeeId (deptA)
    let otherCustomerId: string; // owned by otherRepEmployeeId (deptB)

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Sales E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Sales" } }),
        superadmin.department.create({ data: { companyId, name: "Support" } }),
      ]);

      const adminEmail = `salesadmin-${runId}@e2e.test`;
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

      const managerEmail = `salesmanager-${runId}@e2e.test`;
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
          fullName: "Sales Manager",
          nationalId: encryptField("SALES-MGR-NATIONAL-ID"),
          jobTitle: "Sales Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "700000.00",
        },
      });

      async function makeEmployee(label: string, departmentId: string) {
        const email = `sales${label}-${runId}@e2e.test`;
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
            fullName: `Sales ${label}`,
            nationalId: encryptField(`SALES-${label.toUpperCase()}-NATIONAL-ID`),
            jobTitle: "Sales Rep",
            departmentId,
            hireDate: new Date(),
            salaryBase: "400000.00",
          },
        });
        return { email, password, employeeId: employee.id, userId: user.id };
      }

      const rep = await makeEmployee("rep", deptA.id);
      const otherRep = await makeEmployee("otherrep", deptB.id);
      const plain = await makeEmployee("plain", deptA.id);
      repEmployeeId = rep.employeeId;
      otherRepEmployeeId = otherRep.employeeId;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      // The explicit opt-in that turns ONE employee into a sales rep —
      // this IS the "sales rep role" (see step 2). Note `userId` is set:
      // these are PER-USER overrides, not role-wide rows. A role-wide
      // grant (userId: null) would turn the entire workforce into sales
      // reps, which is exactly what the step-2 decision exists to avoid.
      // PermissionCheckService matches `OR: [{ userId: null }, { userId }]`,
      // so only `rep` picks these up; `plain` deliberately gets nothing.
      await superadmin.rolePermission.createMany({
        data: [
          {
            companyId,
            userId: rep.userId,
            role: "employee",
            module: "sales",
            action: "view",
            scope: "self",
          },
          {
            companyId,
            userId: rep.userId,
            role: "employee",
            module: "sales",
            action: "create",
            scope: "self",
          },
          {
            companyId,
            userId: rep.userId,
            role: "employee",
            module: "sales",
            action: "edit",
            scope: "self",
          },
        ],
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      repToken = await loginAndGetToken(rep.email, rep.password);
      unGrantedEmployeeToken = await loginAndGetToken(plain.email, plain.password);

      const repCustomer = await request(server())
        .post("/customers")
        .set("Authorization", `Bearer ${repToken}`)
        .send({ name: `Rep's Customer ${runId}` })
        .expect(201);
      repCustomerId = (repCustomer.body as CustomerResponseBody).id;

      const otherCustomer = await request(server())
        .post("/customers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: `Other Rep's Customer ${runId}`, ownerId: otherRepEmployeeId })
        .expect(201);
      otherCustomerId = (otherCustomer.body as CustomerResponseBody).id;
    });

    // ── The step-2 decision, proven over real HTTP ────────────────────

    it("an employee with NO sales grant is rejected outright (403) — employees get nothing for sales by default", async () => {
      await request(server())
        .get("/customers")
        .set("Authorization", `Bearer ${unGrantedEmployeeToken}`)
        .expect(403);
    });

    // ── Read: company-wide ───────────────────────────────────────────

    it("a self-scoped rep sees ALL customers, including ones owned by someone else — the deliberate wide-read decision", async () => {
      const res = await request(server())
        .get("/customers")
        .set("Authorization", `Bearer ${repToken}`)
        .expect(200);
      const ids = (res.body as CustomerResponseBody[]).map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([repCustomerId, otherCustomerId]));
    });

    it("a manager sees a customer owned outside their managed department too (read is not department-scoped)", async () => {
      const res = await request(server())
        .get(`/customers/${otherCustomerId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);
      expect((res.body as CustomerResponseBody).id).toBe(otherCustomerId);
    });

    // ── Write: owner-scoped ──────────────────────────────────────────

    it("a rep creating a customer owns it automatically — no ownerId needed", async () => {
      const res = await request(server())
        .get(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .expect(200);
      expect((res.body as CustomerResponseBody).ownerId).toBe(repEmployeeId);
    });

    it("a rep CAN edit the customer they own", async () => {
      const res = await request(server())
        .patch(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ city: "Slemani" })
        .expect(200);
      expect((res.body as CustomerResponseBody & { city: string }).city).toBe("Slemani");
    });

    it("a rep CANNOT edit a customer owned by someone else, even though they can see it (404 — write scope is narrower than read scope)", async () => {
      await request(server())
        .patch(`/customers/${otherCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ city: "Should never apply" })
        .expect(404);
    });

    it("a rep CANNOT reassign their customer to another employee (403)", async () => {
      const res = await request(server())
        .patch(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ ownerId: otherRepEmployeeId })
        .expect(403);
      expect((res.body as { message: string }).message).toMatch(
        /only assign customers to yourself/i,
      );
    });

    it("a manager CAN edit a customer owned by an employee in the department they manage", async () => {
      const res = await request(server())
        .patch(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ notes: "Manager-authored note" })
        .expect(200);
      expect((res.body as CustomerResponseBody & { notes: string }).notes).toBe(
        "Manager-authored note",
      );
    });

    it("a manager CANNOT edit a customer owned outside their managed department (404), despite being able to read it", async () => {
      await request(server())
        .patch(`/customers/${otherCustomerId}`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ notes: "Should never apply" })
        .expect(404);
    });

    it("a manager CANNOT create a customer at all without an explicit opt-in grant (403) — sales:create is admin-only by default", async () => {
      await request(server())
        .post("/customers")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ name: "Should be rejected" })
        .expect(403);
    });

    it("wrote a real AuditLog row for the customer create, attributed to the rep", async () => {
      const logs = await superadmin.auditLog.findMany({
        where: { companyId, entity: "Customer", entityId: repCustomerId, action: "create" },
      });
      expect(logs.length).toBe(1);
    });

    // ── Contacts, and the single-primary rule ────────────────────────

    it("the owner can add contacts, and exactly one stays primary when a second is promoted", async () => {
      const first = await request(server())
        .post(`/customers/${repCustomerId}/contacts`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ fullName: "Procurement Person", isPrimary: true })
        .expect(201);
      const firstId = (first.body as ContactResponseBody).id;

      const second = await request(server())
        .post(`/customers/${repCustomerId}/contacts`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ fullName: "Finance Person", isPrimary: true })
        .expect(201);
      const secondId = (second.body as ContactResponseBody).id;

      const detail = await request(server())
        .get(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .expect(200);
      const contacts = (detail.body as CustomerDetailResponseBody).contacts;

      expect(contacts).toHaveLength(2);
      const primaries = contacts.filter((c) => c.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(secondId);
      expect(contacts.find((c) => c.id === firstId)!.isPrimary).toBe(false);
    });

    it("a non-owner rep CANNOT add a contact to someone else's customer (404)", async () => {
      await request(server())
        .post(`/customers/${otherCustomerId}/contacts`)
        .set("Authorization", `Bearer ${repToken}`)
        .send({ fullName: "Should never be created" })
        .expect(404);
    });

    // ── The delete guard — designed in, not discovered later ──────────

    it("DELETE on a customer that still has contacts returns a clean 409 naming what blocks it, never a raw 500", async () => {
      const res = await request(server())
        .delete(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
      expect((res.body as { message: string }).message).toMatch(/contact\(s\)/i);

      const stillThere = await superadmin.customer.findUnique({ where: { id: repCustomerId } });
      expect(stillThere).not.toBeNull();
    });

    it("DELETE on a customer that still has a deal returns a clean 409 naming the deal, never a raw 500", async () => {
      const blocked = await superadmin.customer.create({
        data: { companyId, name: `Customer With Deal ${runId}`, ownerId: repEmployeeId },
      });
      await superadmin.deal.create({
        data: { companyId, customerId: blocked.id, title: "Blocking deal" },
      });

      const res = await request(server())
        .delete(`/customers/${blocked.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(409);
      expect((res.body as { message: string }).message).toMatch(/deal\(s\)/i);
    });

    it("DELETE succeeds once nothing references the customer — and the row is genuinely gone", async () => {
      const disposable = await request(server())
        .post("/customers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: `Disposable Customer ${runId}` })
        .expect(201);
      const disposableId = (disposable.body as CustomerResponseBody).id;

      await request(server())
        .delete(`/customers/${disposableId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(204);

      const row = await superadmin.customer.findUnique({ where: { id: disposableId } });
      expect(row).toBeNull();
    });

    it("a rep CANNOT delete a customer at all — sales:delete is never a default grant, not even for the owner", async () => {
      await request(server())
        .delete(`/customers/${repCustomerId}`)
        .set("Authorization", `Bearer ${repToken}`)
        .expect(403);
    });
  });
});
