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

interface AttendanceRecordBody {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  withinGeofence: boolean | null;
  source: string;
  overriddenBy: string | null;
  note: string | null;
}

// Erbil Citadel — an arbitrary real-world center point, reused as the
// branch's configured geofence center.
const GEOFENCE_CENTER = { lat: 36.1911, lng: 44.0092 };
const GEOFENCE_RADIUS_METERS = 100;
// ~555m north of the center — well outside a 100m radius.
const OUTSIDE_GEOFENCE = { lat: 36.1961, lng: 44.0092 };

describe("Attendance (e2e)", () => {
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
        await superadmin.attendanceRecord.deleteMany({ where: { companyId } });
        await superadmin.refreshToken.deleteMany({ where: { user: { companyId } } });
        await superadmin.rolePermission.deleteMany({ where: { companyId } });
        await superadmin.employee.updateMany({ where: { companyId }, data: { userId: null } });
        await superadmin.user.deleteMany({ where: { companyId } });
        await superadmin.employee.deleteMany({ where: { companyId } });
        await superadmin.branch.deleteMany({ where: { companyId } });
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

  describe("Clock-in/out, geofencing, department-scoped views + override", () => {
    let companyId: string;
    let adminToken: string;
    let adminUserId: string;
    let managerToken: string;
    let managerUserId: string;
    let employeeA1Token: string;
    let employeeA1Id: string;
    let employeeB1Id: string;

    beforeAll(async () => {
      const company = await superadmin.company.create({
        data: { name: `Attendance E2E Co ${runId}`, city: "Erbil" },
      });
      companyId = company.id;
      createdCompanyIds.push(company.id);

      const [deptA, deptB] = await Promise.all([
        superadmin.department.create({ data: { companyId, name: "Sales" } }),
        superadmin.department.create({ data: { companyId, name: "Support" } }),
      ]);

      const branchA = await superadmin.branch.create({
        data: {
          companyId,
          name: "HQ",
          city: "Erbil",
          geofenceLat: GEOFENCE_CENTER.lat,
          geofenceLng: GEOFENCE_CENTER.lng,
          geofenceRadiusMeters: GEOFENCE_RADIUS_METERS,
        },
      });

      const adminEmail = `attadmin-${runId}@e2e.test`;
      const adminPassword = "admin-password-att";
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

      const managerEmail = `attmanager-${runId}@e2e.test`;
      const managerPassword = "manager-password-att";
      const managerUser = await superadmin.user.create({
        data: {
          companyId,
          email: managerEmail,
          passwordHash: await passwordService.hash(managerPassword),
          role: "manager",
          mustChangePassword: false,
        },
      });
      managerUserId = managerUser.id;
      await superadmin.employee.create({
        data: {
          companyId,
          userId: managerUser.id,
          fullName: "Attendance Manager",
          nationalId: encryptField("ATT-MGR-NATIONAL-ID"),
          jobTitle: "Sales Manager",
          managedDepartmentId: deptA.id,
          hireDate: new Date(),
          salaryBase: "600000.00",
        },
      });

      const employeeA1Email = `atta1-${runId}@e2e.test`;
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
      const employeeA1 = await superadmin.employee.create({
        data: {
          companyId,
          userId: employeeA1User.id,
          fullName: "In Sales, At HQ",
          nationalId: encryptField("ATT-A1-NATIONAL-ID"),
          jobTitle: "Sales Rep",
          departmentId: deptA.id,
          branchId: branchA.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeA1Id = employeeA1.id;

      const employeeB1 = await superadmin.employee.create({
        data: {
          companyId,
          fullName: "In Support",
          nationalId: encryptField("ATT-B1-NATIONAL-ID"),
          jobTitle: "Support Rep",
          departmentId: deptB.id,
          hireDate: new Date(),
          salaryBase: "400000.00",
        },
      });
      employeeB1Id = employeeB1.id;

      await superadmin.rolePermission.createMany({
        data: buildRolePermissionRows(companyId),
        skipDuplicates: true,
      });

      adminToken = await loginAndGetToken(adminEmail, adminPassword, adminTotpSecret);
      managerToken = await loginAndGetToken(managerEmail, managerPassword);
      employeeA1Token = await loginAndGetToken(employeeA1Email, employeeA1Password);
    });

    it("rejects any attempt to pass a client-supplied employeeId on clock-in (whitelist validation)", async () => {
      await request(server())
        .post("/attendance/clock-in")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ lat: GEOFENCE_CENTER.lat, lng: GEOFENCE_CENTER.lng, employeeId: employeeB1Id })
        .expect(400);
    });

    it("clock-in derives employeeId from the session and is flagged clean when inside the branch geofence", async () => {
      const res = await request(server())
        .post("/attendance/clock-in")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ lat: GEOFENCE_CENTER.lat, lng: GEOFENCE_CENTER.lng })
        .expect(201);

      const body = res.body as AttendanceRecordBody;
      expect(body.employeeId).toBe(employeeA1Id);
      expect(body.withinGeofence).toBe(true);
    });

    it("cannot clock in again while already clocked in (409)", async () => {
      await request(server())
        .post("/attendance/clock-in")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ lat: GEOFENCE_CENTER.lat, lng: GEOFENCE_CENTER.lng })
        .expect(409);
    });

    it("clock-out from OUTSIDE the geofence is flagged, not blocked — still succeeds", async () => {
      const res = await request(server())
        .post("/attendance/clock-out")
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .send({ lat: OUTSIDE_GEOFENCE.lat, lng: OUTSIDE_GEOFENCE.lng })
        .expect(200);

      const body = res.body as AttendanceRecordBody;
      expect(body.clockOut).not.toBeNull();
      // Clocked in inside the geofence, clocked out outside it — one
      // flagged end is enough to mark the whole record for review.
      expect(body.withinGeofence).toBe(false);
    });

    it("employee's own timesheet (/attendance/me) returns their record", async () => {
      const res = await request(server())
        .get("/attendance/me")
        .query({ from: "2020-01-01", to: "2030-01-01" })
        .set("Authorization", `Bearer ${employeeA1Token}`)
        .expect(200);

      const records = res.body as AttendanceRecordBody[];
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((r) => r.employeeId === employeeA1Id)).toBe(true);
    });

    it("manager can view their department's team timesheet and sees the in-department employee's record", async () => {
      const res = await request(server())
        .get("/attendance")
        .query({ from: "2020-01-01", to: "2030-01-01" })
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);

      const records = res.body as AttendanceRecordBody[];
      expect(records.some((r) => r.employeeId === employeeA1Id)).toBe(true);
    });

    it("manager filtering the team timesheet by an out-of-department employeeId gets nothing back (existence not revealed)", async () => {
      const res = await request(server())
        .get("/attendance")
        .query({ from: "2020-01-01", to: "2030-01-01", employeeId: employeeB1Id })
        .set("Authorization", `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body as AttendanceRecordBody[]).toEqual([]);
    });

    it("manager CAN admin-override (create) an attendance record for an employee in their managed department", async () => {
      const res = await request(server())
        .post("/attendance/override")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          employeeId: employeeA1Id,
          clockIn: "2026-01-05T08:00:00.000Z",
          clockOut: "2026-01-05T16:00:00.000Z",
          note: "Forgot to clock in — confirmed with security log.",
        })
        .expect(201);

      const body = res.body as AttendanceRecordBody;
      expect(body.source).toBe("admin_override");
      expect(body.overriddenBy).toBe(managerUserId);
      expect(body.note).toContain("Forgot to clock in");

      const log = await superadmin.auditLog.findFirst({
        where: { entity: "AttendanceRecord", entityId: body.id, action: "admin_override" },
      });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(managerUserId);
      expect(log!.companyId).toBe(companyId);
    });

    it("manager CANNOT admin-override an attendance record for an employee outside their managed department (404)", async () => {
      await request(server())
        .post("/attendance/override")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          employeeId: employeeB1Id,
          clockIn: "2026-01-05T08:00:00.000Z",
          note: "Should be rejected.",
        })
        .expect(404);
    });

    it("admin-override requires a note (400 without one)", async () => {
      await request(server())
        .post("/attendance/override")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ employeeId: employeeB1Id, clockIn: "2026-01-05T08:00:00.000Z" })
        .expect(400);
    });

    it("company_admin CAN admin-override across departments, and the correction is itself audit-logged", async () => {
      const created = await request(server())
        .post("/attendance/override")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          employeeId: employeeB1Id,
          clockIn: "2026-01-06T08:00:00.000Z",
          clockOut: "2026-01-06T16:00:00.000Z",
          note: "Manual entry — new hire, device not yet provisioned.",
        })
        .expect(201);
      const recordId = (created.body as AttendanceRecordBody).id;

      // Now correct the SAME record — proves attendanceRecordId targets an
      // update, not a second insert, and that the correction gets its own
      // audit trail entry.
      const corrected = await request(server())
        .post("/attendance/override")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          employeeId: employeeB1Id,
          attendanceRecordId: recordId,
          clockIn: "2026-01-06T08:30:00.000Z",
          clockOut: "2026-01-06T16:00:00.000Z",
          note: "Correction — actual start time was 08:30, not 08:00.",
        })
        .expect(201);

      const body = corrected.body as AttendanceRecordBody;
      expect(body.id).toBe(recordId);
      expect(body.overriddenBy).toBe(adminUserId);
      expect(body.note).toContain("Correction");

      const count = await superadmin.attendanceRecord.count({
        where: { id: recordId },
      });
      expect(count).toBe(1); // still exactly one row — corrected, not duplicated

      const logs = await superadmin.auditLog.findMany({
        where: { entity: "AttendanceRecord", entityId: recordId, action: "admin_override" },
        orderBy: { timestamp: "asc" },
      });
      expect(logs.length).toBe(2); // one for the create, one for the correction
      expect(logs.every((l) => l.userId === adminUserId && l.companyId === companyId)).toBe(true);
    });
  });
});
