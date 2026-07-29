import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Standalone verification that Row-Level Security actually isolates
 * tenants at the database level — independent of any application code
 * (the TenantScopeInterceptor doesn't exist as an HTTP-wired guard yet;
 * this exercises the same SET LOCAL mechanism directly against the
 * hrms_app / hrms_superadmin roles). Exits non-zero on any failed check so
 * it can be wired into CI later.
 *
 * Requires `pnpm db:seed` to have run first (needs the two demo companies).
 */

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`${GREEN}PASS${RESET} ${label}`);
  } else {
    failures += 1;
    console.log(`${RED}FAIL${RESET} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const appPrisma = new PrismaClient({
    datasources: { db: { url: requireEnv("DATABASE_URL") } },
  });
  const superadminPrisma = new PrismaClient({
    datasources: { db: { url: requireEnv("DATABASE_SUPERADMIN_URL") } },
  });

  try {
    const [companyA, companyB] = await superadminPrisma.company.findMany({
      where: { name: { in: ["Demo Company A", "Demo Company B"] } },
      orderBy: { name: "asc" },
    });

    if (!companyA || !companyB) {
      throw new Error("Demo companies not found — run `pnpm db:seed` first (apps/api).");
    }

    // ── 1. No session variable set at all → fail closed, zero rows ──────
    const unscoped = await appPrisma.$transaction(async (tx) => {
      return tx.employee.findMany();
    });
    check(
      "hrms_app with no app.current_company_id set sees zero rows (fail-closed default)",
      unscoped.length === 0,
      `got ${unscoped.length} row(s)`,
    );

    // ── 2. Scoped to Company A → only Company A's employees, never B's ──
    const scopedToA = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
      return tx.employee.findMany();
    });
    check(
      "hrms_app scoped to Company A sees only Company A's employees",
      scopedToA.length > 0 && scopedToA.every((e) => e.companyId === companyA.id),
      `got ${scopedToA.length} row(s), companyIds: ${[...new Set(scopedToA.map((e) => e.companyId))].join(", ")}`,
    );

    const crossTenantLeak = scopedToA.filter((e) => e.companyId === companyB.id);
    check(
      "Company B's employees are NOT visible while scoped to Company A",
      crossTenantLeak.length === 0,
      `leaked ${crossTenantLeak.length} row(s) from Company B`,
    );

    // ── 3. Directly querying Company B's employees while scoped to A ────
    const directAttempt = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
      return tx.employee.findMany({ where: { companyId: companyB.id } });
    });
    check(
      "Explicit query for Company B's employees while scoped to Company A returns zero rows",
      directAttempt.length === 0,
      `got ${directAttempt.length} row(s)`,
    );

    // ── 4. Scoped to Company B → only Company B's employees ─────────────
    const scopedToB = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyB.id}'`);
      return tx.employee.findMany();
    });
    check(
      "hrms_app scoped to Company B sees only Company B's employees",
      scopedToB.length > 0 && scopedToB.every((e) => e.companyId === companyB.id),
      `got ${scopedToB.length} row(s)`,
    );

    // ── 5. Company table itself is scoped too ────────────────────────────
    const companiesVisibleToA = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
      return tx.company.findMany();
    });
    check(
      "hrms_app scoped to Company A sees only its own Company row",
      companiesVisibleToA.length === 1 && companiesVisibleToA[0]?.id === companyA.id,
      `got ${companiesVisibleToA.length} row(s)`,
    );

    // ── 6. Global holidays visible regardless of tenant scope ───────────
    const holidaysForA = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
      return tx.holiday.findMany();
    });
    check(
      "Global (companyId: null) holidays are visible while scoped to a tenant",
      holidaysForA.length > 0 && holidaysForA.every((h) => h.companyId === null),
      `got ${holidaysForA.length} row(s)`,
    );

    // ── 7. Super Admin (BYPASSRLS) sees across both tenants ─────────────
    const allEmployeesSuperadmin = await superadminPrisma.employee.findMany();
    const seenCompanyIds = new Set(allEmployeesSuperadmin.map((e) => e.companyId));
    check(
      "hrms_superadmin (BYPASSRLS) sees employees from both companies, no SET LOCAL needed",
      seenCompanyIds.has(companyA.id) && seenCompanyIds.has(companyB.id),
      `saw company ids: ${[...seenCompanyIds].join(", ")}`,
    );
  } finally {
    await appPrisma.$disconnect();
    await superadminPrisma.$disconnect();
  }

  console.log("");
  if (failures > 0) {
    console.error(`${RED}${failures} check(s) failed.${RESET}`);
    process.exitCode = 1;
  } else {
    console.log(`${GREEN}All RLS checks passed.${RESET}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
