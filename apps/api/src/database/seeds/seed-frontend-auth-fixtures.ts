import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encryptField } from "../../common/crypto/field-encryption";
import { PasswordService } from "../../modules/auth/password.service";
import { buildRolePermissionRows } from "./default-role-permissions";

/**
 * Stable, idempotent login fixtures for apps/web's real-backend
 * integration tests (step 9.1) — NOT random/regenerated per run, since
 * the frontend test suite needs to know the exact email/password/TOTP
 * secret ahead of time without reaching into Prisma itself (that would
 * pull backend internals into the frontend test suite's dependency
 * graph, which this project has otherwise kept clean). Mirrors
 * create-company.ts's provisioning pattern, but upserts rather than
 * failing if it already exists, since this is meant to be safe to re-run
 * every time someone sets up the dev environment.
 *
 * If you change any value here, update the matching literal constants in
 * apps/web/src/app/login/login.integration.spec.tsx — they're duplicated
 * on purpose (see that file), not imported, so keep them in sync by hand.
 */
export const FRONTEND_AUTH_FIXTURES = {
  companyName: "Frontend Auth E2E Co",
  city: "Erbil",
  adminEmail: "frontend-e2e-admin@hrms.test",
  adminPassword: "Frontend-E2E-Admin-Pass-1",
  // Fixed, not randomly generated — otplib's authenticator.generate() on
  // the frontend side needs this exact value to produce a code the
  // backend's TwoFactorService (seeded with the same secret, encrypted)
  // will accept.
  adminTotpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  employeeEmail: "frontend-e2e-employee@hrms.test",
  employeePassword: "Frontend-E2E-Employee-Pass-1",
  // Step 9.5 — manager team-view/attendance-correction integration tests
  // need a real manager fixture, PLUS a second department with an
  // employee outside the manager's reach, to prove department-scoping
  // isn't just theoretical for this specific manager/department pair.
  managerEmail: "frontend-e2e-manager@hrms.test",
  managerPassword: "Frontend-E2E-Manager-Pass-1",
  otherDepartmentName: "Frontend E2E Department (Other)",
  outOfScopeEmployeeName: "Frontend E2E Out-of-Scope Employee",
  // Erbil city center-ish — arbitrary but stable, so geofence-based
  // clock-in tests (9.2) have a known point to send matching/mismatching
  // coordinates against.
  branchName: "Erbil HQ",
  branchGeofenceLat: 36.191111,
  branchGeofenceLng: 44.009167,
  branchGeofenceRadiusMeters: 200,
  departmentName: "Frontend E2E Department",
  // Step 9.3 — the leave submission/history integration tests need a real,
  // active LeaveType to select in the dropdown. requiresApproval left true
  // (the default) since nothing in 9.3's tests approves/rejects — that's
  // covered by the backend's own leave.e2e-spec.ts.
  leaveTypeName: "Annual Leave",
  leaveTypeDaysPerYear: 20,
  // Super Admin dashboard integration tests (companyId: null — not
  // attached to the fixture company above at all) — same fixed-secret
  // reasoning as adminTotpSecret.
  superadminEmail: "frontend-e2e-superadmin@hrms.test",
  superadminPassword: "Frontend-E2E-Superadmin-Pass-1",
  superadminTotpSecret: "KRSXG5CTMVRXEZLUEBSXG5CTMVRXEZLU",
} as const;

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: requireEnv("DATABASE_SUPERADMIN_URL") } },
  });
  const passwordService = new PasswordService();

  try {
    const company = await upsertCompany(prisma, FRONTEND_AUTH_FIXTURES.companyName);

    await prisma.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    const adminUserId = await upsertUser(prisma, {
      companyId: company.id,
      email: FRONTEND_AUTH_FIXTURES.adminEmail,
      passwordHash: await passwordService.hash(FRONTEND_AUTH_FIXTURES.adminPassword),
      role: "company_admin",
      mustChangePassword: false,
      twoFaEnabled: true,
      twoFaSecret: encryptField(FRONTEND_AUTH_FIXTURES.adminTotpSecret),
    });

    // No 2FA — employee role doesn't require it (TwoFactorService.
    // roleRequiresTwoFactor) — this fixture exercises the immediate
    // status:"ok" login path.
    const employeeUserId = await upsertUser(prisma, {
      companyId: company.id,
      email: FRONTEND_AUTH_FIXTURES.employeeEmail,
      passwordHash: await passwordService.hash(FRONTEND_AUTH_FIXTURES.employeePassword),
      role: "employee",
      mustChangePassword: false,
      twoFaEnabled: false,
      twoFaSecret: null,
    });

    const branch = await upsertBranch(prisma, company.id);
    const department = await upsertDepartment(prisma, company.id);
    await upsertLeaveType(prisma, company.id);

    // Manager user, plus RBAC grants beyond the default matrix: default
    // manager permissions don't include attendance:edit/employees:create
    // at own_department scope by default in every context — but they DO
    // per default-role-permissions.ts (attendance edit own_department is
    // already a default grant). No extra RolePermission rows needed here.
    const managerUserId = await upsertUser(prisma, {
      companyId: company.id,
      email: FRONTEND_AUTH_FIXTURES.managerEmail,
      passwordHash: await passwordService.hash(FRONTEND_AUTH_FIXTURES.managerPassword),
      role: "manager",
      mustChangePassword: false,
      twoFaEnabled: false,
      twoFaSecret: null,
    });

    const otherDepartment = await upsertDepartment(
      prisma,
      company.id,
      FRONTEND_AUTH_FIXTURES.otherDepartmentName,
    );

    // Employee rows linked via userId — real attendance clock-in/out and
    // leave-balance integration tests (9.2+) need an actual Employee, not
    // just a User: AttendanceService/LeaveService resolve the caller's
    // Employee row (via req.user's userId) to know department/branch/
    // geofence, not the User row directly.
    await upsertEmployee(prisma, {
      companyId: company.id,
      userId: adminUserId,
      fullName: "Frontend E2E Admin",
      jobTitle: "HR Administrator",
      departmentId: department.id,
      branchId: branch.id,
    });
    await upsertEmployee(prisma, {
      companyId: company.id,
      userId: employeeUserId,
      fullName: "Frontend E2E Employee",
      jobTitle: "Software Engineer",
      departmentId: department.id,
      branchId: branch.id,
    });
    // Manages `department` — the SAME department the employee fixture
    // above belongs to, so the manager fixture has a real, non-empty team
    // to see.
    await upsertEmployee(prisma, {
      companyId: company.id,
      userId: managerUserId,
      fullName: "Frontend E2E Manager",
      jobTitle: "Engineering Manager",
      departmentId: department.id,
      branchId: branch.id,
      managedDepartmentId: department.id,
    });
    // No userId (not a login) — exists purely so the manager
    // integration tests have a real employee OUTSIDE their managed
    // department to prove is genuinely invisible/unreachable, not just
    // "there happened to be nobody else."
    await upsertUnmanagedEmployee(prisma, company.id, otherDepartment.id, branch.id);

    await upsertUser(prisma, {
      companyId: null,
      email: FRONTEND_AUTH_FIXTURES.superadminEmail,
      passwordHash: await passwordService.hash(FRONTEND_AUTH_FIXTURES.superadminPassword),
      role: "superadmin",
      mustChangePassword: false,
      twoFaEnabled: true,
      twoFaSecret: encryptField(FRONTEND_AUTH_FIXTURES.superadminTotpSecret),
    });

    console.log("Frontend auth fixtures ready:");
    console.log(`  Company: ${FRONTEND_AUTH_FIXTURES.companyName} (${company.id})`);
    console.log(`  Branch: ${FRONTEND_AUTH_FIXTURES.branchName} (${branch.id})`);
    console.log(`  Admin (2FA-enrolled): ${FRONTEND_AUTH_FIXTURES.adminEmail}`);
    console.log(`  Employee (no 2FA):    ${FRONTEND_AUTH_FIXTURES.employeeEmail}`);
    console.log(`  Manager (no 2FA):     ${FRONTEND_AUTH_FIXTURES.managerEmail}`);
    console.log(`  Superadmin (2FA-enrolled): ${FRONTEND_AUTH_FIXTURES.superadminEmail}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function upsertCompany(prisma: PrismaClient, name: string) {
  const existing = await prisma.company.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.company.create({ data: { name, city: FRONTEND_AUTH_FIXTURES.city } });
}

async function upsertUser(
  prisma: PrismaClient,
  data: {
    companyId: string | null;
    email: string;
    passwordHash: string;
    role: "company_admin" | "manager" | "employee" | "superadmin";
    mustChangePassword: boolean;
    twoFaEnabled: boolean;
    twoFaSecret: string | null;
  },
): Promise<string> {
  const existing = await prisma.user.findFirst({
    where: { companyId: data.companyId, email: data.email },
  });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.user.create({ data });
  return created.id;
}

async function upsertBranch(prisma: PrismaClient, companyId: string) {
  const existing = await prisma.branch.findFirst({
    where: { companyId, name: FRONTEND_AUTH_FIXTURES.branchName },
  });
  if (existing) return existing;
  return prisma.branch.create({
    data: {
      companyId,
      name: FRONTEND_AUTH_FIXTURES.branchName,
      city: FRONTEND_AUTH_FIXTURES.city,
      geofenceLat: FRONTEND_AUTH_FIXTURES.branchGeofenceLat,
      geofenceLng: FRONTEND_AUTH_FIXTURES.branchGeofenceLng,
      geofenceRadiusMeters: FRONTEND_AUTH_FIXTURES.branchGeofenceRadiusMeters,
    },
  });
}

async function upsertDepartment(
  prisma: PrismaClient,
  companyId: string,
  name: string = FRONTEND_AUTH_FIXTURES.departmentName,
) {
  const existing = await prisma.department.findFirst({ where: { companyId, name } });
  if (existing) return existing;
  return prisma.department.create({ data: { companyId, name } });
}

async function upsertLeaveType(prisma: PrismaClient, companyId: string) {
  const existing = await prisma.leaveType.findFirst({
    where: { companyId, name: FRONTEND_AUTH_FIXTURES.leaveTypeName },
  });
  if (existing) return existing;
  return prisma.leaveType.create({
    data: {
      companyId,
      name: FRONTEND_AUTH_FIXTURES.leaveTypeName,
      daysPerYear: FRONTEND_AUTH_FIXTURES.leaveTypeDaysPerYear,
    },
  });
}

async function upsertEmployee(
  prisma: PrismaClient,
  data: {
    companyId: string;
    userId: string;
    fullName: string;
    jobTitle: string;
    departmentId: string;
    branchId: string;
    managedDepartmentId?: string;
  },
): Promise<void> {
  const existing = await prisma.employee.findFirst({ where: { userId: data.userId } });
  const employeeData = {
    companyId: data.companyId,
    userId: data.userId,
    fullName: data.fullName,
    // Not real PII — a stable placeholder, same convention as seed.ts,
    // but routed through encryptField since this column is ciphertext
    // (see schema.prisma) and every other writer treats it that way.
    nationalId: encryptField(`FRONTEND-E2E-${data.userId}`),
    jobTitle: data.jobTitle,
    departmentId: data.departmentId,
    branchId: data.branchId,
    managedDepartmentId: data.managedDepartmentId,
    hireDate: new Date("2024-01-01"),
    salaryBase: "1500000.00",
    currency: "IQD",
  };
  if (existing) {
    await prisma.employee.update({ where: { id: existing.id }, data: employeeData });
    return;
  }
  await prisma.employee.create({ data: employeeData });
}

/** No `userId` — not a login, exists only as a real "outside the manager's reach" fixture row. */
async function upsertUnmanagedEmployee(
  prisma: PrismaClient,
  companyId: string,
  departmentId: string,
  branchId: string,
): Promise<void> {
  const existing = await prisma.employee.findFirst({
    where: { companyId, fullName: FRONTEND_AUTH_FIXTURES.outOfScopeEmployeeName },
  });
  const data = {
    companyId,
    fullName: FRONTEND_AUTH_FIXTURES.outOfScopeEmployeeName,
    nationalId: encryptField(`FRONTEND-E2E-OUT-OF-SCOPE-${companyId}`),
    jobTitle: "Analyst",
    departmentId,
    branchId,
    hireDate: new Date("2024-01-01"),
    salaryBase: "1200000.00",
    currency: "IQD",
  };
  if (existing) {
    await prisma.employee.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.employee.create({ data });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
