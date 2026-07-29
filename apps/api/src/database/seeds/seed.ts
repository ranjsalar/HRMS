import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedHolidays } from "./holidays";
import { seedPayrollRules } from "./payroll-rules";
import { buildRolePermissionRows } from "./default-role-permissions";

/**
 * Dev/local seed data: two demo companies (used by verify-rls.ts to prove
 * tenant isolation), their default RolePermission rows, a couple of
 * employees per company, and the system holiday calendar.
 *
 * Connects via DATABASE_SUPERADMIN_URL (BYPASSRLS) because seeding
 * necessarily writes across the pre-tenant bootstrap boundary — there is no
 * app.current_company_id to SET LOCAL to before a company exists yet. This
 * mirrors how the future company-provisioning CLI (step 3) will work: only
 * the Super Admin connection can create a Company row at all, by RLS design
 * (see the enable_rls_and_roles migration).
 *
 * Employee.nationalId / bankAccount are seeded as plain placeholder strings
 * here, not real PII — the application-level field-encryption wrapper
 * (common/crypto/field-encryption.ts) doesn't exist yet as of this step;
 * once it does, this script should route through it like any other writer.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: requireEnv("DATABASE_SUPERADMIN_URL") } },
  });

  try {
    const companyA = await upsertCompany(prisma, {
      name: "Demo Company A",
      city: "Slemani",
    });
    const companyB = await upsertCompany(prisma, {
      name: "Demo Company B",
      city: "Erbil",
    });

    for (const company of [companyA, companyB]) {
      await prisma.rolePermission.createMany({
        data: buildRolePermissionRows(company.id),
        skipDuplicates: true,
      });
    }

    await seedEmployees(prisma, companyA, [
      { fullName: "Aland Karim", jobTitle: "Accountant" },
      { fullName: "Sara Rasul", jobTitle: "HR Officer" },
    ]);
    await seedEmployees(prisma, companyB, [
      { fullName: "Dilan Hussein", jobTitle: "Software Engineer" },
    ]);

    await seedHolidays(prisma);
    await seedPayrollRules(prisma);

    console.log("Seed complete:");
    console.log(`  ${companyA.name} (${companyA.id})`);
    console.log(`  ${companyB.name} (${companyB.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

async function upsertCompany(prisma: PrismaClient, data: { name: string; city: string }) {
  const existing = await prisma.company.findFirst({ where: { name: data.name } });
  if (existing) return existing;
  return prisma.company.create({ data });
}

async function seedEmployees(
  prisma: PrismaClient,
  company: { id: string },
  employees: Array<{ fullName: string; jobTitle: string }>,
): Promise<void> {
  const existingCount = await prisma.employee.count({ where: { companyId: company.id } });
  if (existingCount > 0) return;

  for (const [index, employee] of employees.entries()) {
    await prisma.employee.create({
      data: {
        companyId: company.id,
        fullName: employee.fullName,
        nationalId: `DEV-PLACEHOLDER-${company.id.slice(0, 8)}-${index}`,
        jobTitle: employee.jobTitle,
        hireDate: new Date(),
        salaryBase: "1000000.00",
        currency: "IQD",
      },
    });
  }
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
