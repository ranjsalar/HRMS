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

    // ── 8. Projects module (Project/ProjectMember/Task/TaskTimeEntry) ───
    // No seed fixtures exist yet for this module, so create throwaway rows
    // directly via the BYPASSRLS connection, then clean them up at the end.
    const projectA = await superadminPrisma.project.create({
      data: { companyId: companyA.id, name: "RLS check project A" },
    });
    const projectB = await superadminPrisma.project.create({
      data: { companyId: companyB.id, name: "RLS check project B" },
    });
    const taskA = await superadminPrisma.task.create({
      data: { companyId: companyA.id, projectId: projectA.id, title: "RLS check task A" },
    });
    const taskB = await superadminPrisma.task.create({
      data: { companyId: companyB.id, projectId: projectB.id, title: "RLS check task B" },
    });

    try {
      const projectsForA = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.project.findMany();
      });
      check(
        "hrms_app scoped to Company A sees only Company A's projects",
        projectsForA.length > 0 && projectsForA.every((p) => p.companyId === companyA.id),
        `got ${projectsForA.length} row(s), companyIds: ${[...new Set(projectsForA.map((p) => p.companyId))].join(", ")}`,
      );

      const tasksForA = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.task.findMany();
      });
      check(
        "hrms_app scoped to Company A sees only Company A's tasks",
        tasksForA.length > 0 && tasksForA.every((t) => t.companyId === companyA.id),
        `got ${tasksForA.length} row(s), companyIds: ${[...new Set(tasksForA.map((t) => t.companyId))].join(", ")}`,
      );

      const directTaskAttempt = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.task.findMany({ where: { companyId: companyB.id } });
      });
      check(
        "Explicit query for Company B's tasks while scoped to Company A returns zero rows",
        directTaskAttempt.length === 0,
        `got ${directTaskAttempt.length} row(s)`,
      );

      const projectsForB = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyB.id}'`);
        return tx.project.findMany();
      });
      check(
        "hrms_app scoped to Company B sees only Company B's projects",
        projectsForB.length > 0 && projectsForB.every((p) => p.companyId === companyB.id),
        `got ${projectsForB.length} row(s)`,
      );

      const noScopeProjects = await appPrisma.$transaction(async (tx) => {
        return tx.project.findMany();
      });
      check(
        "hrms_app with no app.current_company_id set sees zero projects (fail-closed default)",
        noScopeProjects.length === 0,
        `got ${noScopeProjects.length} row(s)`,
      );

      const allProjectsSuperadmin = await superadminPrisma.project.findMany({
        where: { id: { in: [projectA.id, projectB.id] } },
      });
      const seenProjectCompanyIds = new Set(allProjectsSuperadmin.map((p) => p.companyId));
      check(
        "hrms_superadmin (BYPASSRLS) sees projects from both companies, no SET LOCAL needed",
        seenProjectCompanyIds.has(companyA.id) && seenProjectCompanyIds.has(companyB.id),
        `saw company ids: ${[...seenProjectCompanyIds].join(", ")}`,
      );

      // ── 8b. WRITE under RLS, not just SELECT — a genuinely different
      // proof than everything above. Every check so far reads; this
      // attempts to UPDATE Company B's project while scoped to Company
      // A, confirming RLS blocks cross-tenant writes too (the migration's
      // simple `USING (...)` form, with no separate `WITH CHECK`, has
      // Postgres reuse the same expression for INSERT/UPDATE — this is
      // what actually proves that, not just an assumption about how
      // Postgres defaults work). See DECISIONS.md, step 7.
      const crossTenantUpdateAttempt = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.project.updateMany({
          where: { id: projectB.id },
          data: { name: "SHOULD NEVER APPLY — cross-tenant write attempt" },
        });
      });
      check(
        "UPDATE targeting Company B's project while scoped to Company A affects zero rows",
        crossTenantUpdateAttempt.count === 0,
        `updated ${crossTenantUpdateAttempt.count} row(s)`,
      );
      const projectBUnchanged = await superadminPrisma.project.findUniqueOrThrow({
        where: { id: projectB.id },
      });
      check(
        "Company B's project name is genuinely unchanged after the blocked cross-tenant update",
        projectBUnchanged.name === "RLS check project B",
        `name is now "${projectBUnchanged.name}"`,
      );

      // ── 8c. TaskTimeEntry — a real Employee row from each company is
      // needed (the FK is real, not nullable), reused from whichever
      // employee `pnpm db:seed` already created rather than creating new
      // throwaway ones.
      const employeeA = await superadminPrisma.employee.findFirstOrThrow({
        where: { companyId: companyA.id },
      });
      const employeeB = await superadminPrisma.employee.findFirstOrThrow({
        where: { companyId: companyB.id },
      });
      const entryA = await superadminPrisma.taskTimeEntry.create({
        data: {
          companyId: companyA.id,
          taskId: taskA.id,
          employeeId: employeeA.id,
          date: new Date(),
          hours: "1.5",
        },
      });
      const entryB = await superadminPrisma.taskTimeEntry.create({
        data: {
          companyId: companyB.id,
          taskId: taskB.id,
          employeeId: employeeB.id,
          date: new Date(),
          hours: "2.5",
        },
      });

      try {
        const entriesForA = await appPrisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
          return tx.taskTimeEntry.findMany();
        });
        check(
          "hrms_app scoped to Company A sees only Company A's time entries",
          entriesForA.length > 0 && entriesForA.every((e) => e.companyId === companyA.id),
          `got ${entriesForA.length} row(s), companyIds: ${[...new Set(entriesForA.map((e) => e.companyId))].join(", ")}`,
        );

        const directEntryAttempt = await appPrisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
          return tx.taskTimeEntry.findMany({ where: { companyId: companyB.id } });
        });
        check(
          "Explicit query for Company B's time entries while scoped to Company A returns zero rows",
          directEntryAttempt.length === 0,
          `got ${directEntryAttempt.length} row(s)`,
        );

        const entriesForB = await appPrisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyB.id}'`);
          return tx.taskTimeEntry.findMany();
        });
        check(
          "hrms_app scoped to Company B sees only Company B's time entries",
          entriesForB.length > 0 && entriesForB.every((e) => e.companyId === companyB.id),
          `got ${entriesForB.length} row(s)`,
        );

        const noScopeEntries = await appPrisma.$transaction(async (tx) => {
          return tx.taskTimeEntry.findMany();
        });
        check(
          "hrms_app with no app.current_company_id set sees zero time entries (fail-closed default)",
          noScopeEntries.length === 0,
          `got ${noScopeEntries.length} row(s)`,
        );

        const allEntriesSuperadmin = await superadminPrisma.taskTimeEntry.findMany({
          where: { id: { in: [entryA.id, entryB.id] } },
        });
        const seenEntryCompanyIds = new Set(allEntriesSuperadmin.map((e) => e.companyId));
        check(
          "hrms_superadmin (BYPASSRLS) sees time entries from both companies, no SET LOCAL needed",
          seenEntryCompanyIds.has(companyA.id) && seenEntryCompanyIds.has(companyB.id),
          `saw company ids: ${[...seenEntryCompanyIds].join(", ")}`,
        );
      } finally {
        await superadminPrisma.taskTimeEntry.deleteMany({
          where: { id: { in: [entryA.id, entryB.id] } },
        });
      }
    } finally {
      await superadminPrisma.task.deleteMany({ where: { id: { in: [taskA.id, taskB.id] } } });
      await superadminPrisma.project.deleteMany({
        where: { id: { in: [projectA.id, projectB.id] } },
      });
    }

    // ── 9. Sales/CRM module (Customer/CustomerContact/Lead/Deal/
    // SalesOrder/SalesOrderLine) ────────────────────────────────────────
    // No seed fixtures exist for this module either, so create throwaway
    // rows via the BYPASSRLS connection and clean them up at the end.
    // `ownerId` is nullable on all three owned entities, so no Employee
    // fixtures are needed here.
    const customerA = await superadminPrisma.customer.create({
      data: { companyId: companyA.id, name: "RLS check customer A" },
    });
    const customerB = await superadminPrisma.customer.create({
      data: { companyId: companyB.id, name: "RLS check customer B" },
    });
    const contactA = await superadminPrisma.customerContact.create({
      data: { companyId: companyA.id, customerId: customerA.id, fullName: "RLS contact A" },
    });
    const contactB = await superadminPrisma.customerContact.create({
      data: { companyId: companyB.id, customerId: customerB.id, fullName: "RLS contact B" },
    });
    const leadA = await superadminPrisma.lead.create({
      data: { companyId: companyA.id, contactName: "RLS lead A" },
    });
    const leadB = await superadminPrisma.lead.create({
      data: { companyId: companyB.id, contactName: "RLS lead B" },
    });
    const dealA = await superadminPrisma.deal.create({
      data: { companyId: companyA.id, customerId: customerA.id, title: "RLS check deal A" },
    });
    const dealB = await superadminPrisma.deal.create({
      data: { companyId: companyB.id, customerId: customerB.id, title: "RLS check deal B" },
    });
    const orderA = await superadminPrisma.salesOrder.create({
      data: {
        companyId: companyA.id,
        dealId: dealA.id,
        customerId: customerA.id,
        reference: "RLS-CHECK-A",
      },
    });
    const orderB = await superadminPrisma.salesOrder.create({
      data: {
        companyId: companyB.id,
        dealId: dealB.id,
        customerId: customerB.id,
        reference: "RLS-CHECK-B",
      },
    });
    const lineA = await superadminPrisma.salesOrderLine.create({
      data: {
        companyId: companyA.id,
        salesOrderId: orderA.id,
        description: "RLS check line A",
        quantity: "1",
        unitPrice: "100",
      },
    });
    const lineB = await superadminPrisma.salesOrderLine.create({
      data: {
        companyId: companyB.id,
        salesOrderId: orderB.id,
        description: "RLS check line B",
        quantity: "1",
        unitPrice: "100",
      },
    });

    try {
      // A single sweep across ALL SIX tables rather than six hand-written
      // blocks — done in raw SQL deliberately, since RLS is a
      // database-level guarantee and this asserts it at that level
      // directly, independent of any Prisma model mapping.
      const salesTables = [
        "Customer",
        "CustomerContact",
        "Lead",
        "Deal",
        "SalesOrder",
        "SalesOrderLine",
      ];

      async function countsForScope(companyId: string | null): Promise<Record<string, number>> {
        return appPrisma.$transaction(async (tx) => {
          if (companyId) {
            await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);
          }
          const out: Record<string, number> = {};
          for (const table of salesTables) {
            const rows = await tx.$queryRawUnsafe<{ count: number }[]>(
              `SELECT COUNT(*)::int AS count FROM "${table}"`,
            );
            out[table] = rows[0]?.count ?? -1;
          }
          return out;
        });
      }

      const unscopedSales = await countsForScope(null);
      check(
        "hrms_app with no app.current_company_id set sees zero rows in ALL SIX Sales/CRM tables (fail-closed default)",
        salesTables.every((t) => unscopedSales[t] === 0),
        salesTables.map((t) => `${t}=${unscopedSales[t]}`).join(", "),
      );

      // Company B's rows exist (created above via BYPASSRLS), so a
      // non-zero count here would be a genuine cross-tenant leak, not an
      // empty-database false pass.
      const scopedToASales = await countsForScope(companyA.id);
      check(
        "hrms_app scoped to Company A sees exactly its own row in each Sales/CRM table, never Company B's",
        salesTables.every((t) => scopedToASales[t] === 1),
        salesTables.map((t) => `${t}=${scopedToASales[t]}`).join(", "),
      );

      const scopedToBSales = await countsForScope(companyB.id);
      check(
        "hrms_app scoped to Company B sees exactly its own row in each Sales/CRM table, never Company A's",
        salesTables.every((t) => scopedToBSales[t] === 1),
        salesTables.map((t) => `${t}=${scopedToBSales[t]}`).join(", "),
      );

      // Typed, model-level checks on the two entities that carry the real
      // commercial data — belt-and-suspenders over the raw sweep above.
      const customersForA = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.customer.findMany();
      });
      check(
        "hrms_app scoped to Company A sees only Company A's customers",
        customersForA.length > 0 && customersForA.every((c) => c.companyId === companyA.id),
        `got ${customersForA.length} row(s), companyIds: ${[...new Set(customersForA.map((c) => c.companyId))].join(", ")}`,
      );

      const directDealAttempt = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.deal.findMany({ where: { companyId: companyB.id } });
      });
      check(
        "Explicit query for Company B's deals while scoped to Company A returns zero rows",
        directDealAttempt.length === 0,
        `got ${directDealAttempt.length} row(s)`,
      );

      // WRITE under RLS, not just SELECT — same proof shape added for
      // Project in the Projects step-7 audit. Deal is the right target
      // here: it carries the commercially sensitive data (amount, stage),
      // so a cross-tenant write landing would be the worst case.
      const crossTenantDealUpdate = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.deal.updateMany({
          where: { id: dealB.id },
          data: { title: "SHOULD NEVER APPLY — cross-tenant write attempt", stage: "won" },
        });
      });
      check(
        "UPDATE targeting Company B's deal while scoped to Company A affects zero rows",
        crossTenantDealUpdate.count === 0,
        `updated ${crossTenantDealUpdate.count} row(s)`,
      );
      const dealBUnchanged = await superadminPrisma.deal.findUniqueOrThrow({
        where: { id: dealB.id },
      });
      check(
        "Company B's deal title and stage are genuinely unchanged after the blocked cross-tenant write",
        dealBUnchanged.title === "RLS check deal B" && dealBUnchanged.stage === "new",
        `title="${dealBUnchanged.title}", stage="${dealBUnchanged.stage}"`,
      );

      // DELETE under RLS — a third verb, and the one that would be
      // silently destructive rather than merely wrong if it leaked.
      const crossTenantCustomerDelete = await appPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyA.id}'`);
        return tx.customer.deleteMany({ where: { id: customerB.id } });
      });
      check(
        "DELETE targeting Company B's customer while scoped to Company A affects zero rows",
        crossTenantCustomerDelete.count === 0,
        `deleted ${crossTenantCustomerDelete.count} row(s)`,
      );
      const customerBStillExists = await superadminPrisma.customer.findUnique({
        where: { id: customerB.id },
      });
      check(
        "Company B's customer row genuinely still exists after the blocked cross-tenant delete",
        customerBStillExists !== null,
      );

      const allCustomersSuperadmin = await superadminPrisma.customer.findMany({
        where: { id: { in: [customerA.id, customerB.id] } },
      });
      const seenCustomerCompanyIds = new Set(allCustomersSuperadmin.map((c) => c.companyId));
      check(
        "hrms_superadmin (BYPASSRLS) sees customers from both companies, no SET LOCAL needed",
        seenCustomerCompanyIds.has(companyA.id) && seenCustomerCompanyIds.has(companyB.id),
        `saw company ids: ${[...seenCustomerCompanyIds].join(", ")}`,
      );
    } finally {
      // Reverse FK order: lines -> orders -> deals -> contacts -> customers.
      // Leads are independent of all of them.
      await superadminPrisma.salesOrderLine.deleteMany({
        where: { id: { in: [lineA.id, lineB.id] } },
      });
      await superadminPrisma.salesOrder.deleteMany({
        where: { id: { in: [orderA.id, orderB.id] } },
      });
      await superadminPrisma.deal.deleteMany({ where: { id: { in: [dealA.id, dealB.id] } } });
      await superadminPrisma.customerContact.deleteMany({
        where: { id: { in: [contactA.id, contactB.id] } },
      });
      await superadminPrisma.lead.deleteMany({ where: { id: { in: [leadA.id, leadB.id] } } });
      await superadminPrisma.customer.deleteMany({
        where: { id: { in: [customerA.id, customerB.id] } },
      });
    }
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
