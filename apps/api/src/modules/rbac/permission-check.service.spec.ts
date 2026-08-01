import { PermissionCheckService } from "./permission-check.service";
import type { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";

function buildScopedRunner(rows: Array<{ userId: string | null; scope: string }>): {
  scoped: TenantScopedRunner;
  run: jest.Mock;
} {
  const findMany = jest.fn().mockResolvedValue(rows);
  const run = jest.fn((_companyId: string | null, fn: (tx: unknown) => unknown) =>
    fn({ rolePermission: { findMany } }),
  );
  return { scoped: { run } as unknown as TenantScopedRunner, run };
}

describe("PermissionCheckService", () => {
  const companyId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";

  it("superadmin short-circuits to 'all' without querying RolePermission at all", async () => {
    const { scoped, run } = buildScopedRunner([]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "superadmin",
      companyId: null,
      userId,
      module: "payroll",
      action: "view",
    });

    expect(result).toBe("all");
    expect(run).not.toHaveBeenCalled();
  });

  it("company_admin with a role-wide 'all' grant is allowed", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "all" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "company_admin",
      companyId,
      userId,
      module: "employees",
      action: "edit",
    });

    expect(result).toBe("all");
  });

  it("manager with an own_department grant is allowed at that scope", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "own_department" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "employees",
      action: "view",
    });

    expect(result).toBe("own_department");
  });

  it("employee with a self grant is allowed at that scope", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "self" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "employee",
      companyId,
      userId,
      module: "leave",
      action: "create",
    });

    expect(result).toBe("self");
  });

  it("denies (null) when no matching RolePermission row exists for any role", async () => {
    const { scoped } = buildScopedRunner([]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "employee",
      companyId,
      userId,
      module: "payroll",
      action: "delete",
    });

    expect(result).toBeNull();
  });

  it("prefers the WIDER scope when both a role-wide and a per-user override row match", async () => {
    const { scoped } = buildScopedRunner([
      { userId: null, scope: "self" },
      { userId, scope: "own_department" },
    ]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "leave",
      action: "approve",
    });

    expect(result).toBe("own_department");
  });

  it("a null companyId for a non-superadmin role fails closed (defensive — shouldn't happen structurally)", async () => {
    const { scoped, run } = buildScopedRunner([{ userId: null, scope: "all" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "company_admin",
      companyId: null,
      userId,
      module: "employees",
      action: "view",
    });

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  // Projects module (step 2 of the Projects/Task Management build) — added
  // to RBAC_MODULES alongside the pre-existing ones above. The check logic
  // itself is fully generic over module name, so these prove the new module
  // name flows through it correctly rather than testing new behavior.
  it("manager with a projects own_department grant is allowed at that scope", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "own_department" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "projects",
      action: "view",
    });

    expect(result).toBe("own_department");
  });

  it("manager with no projects:create grant is denied (admin-only by default, opt-in per company)", async () => {
    // No row at all for this module/action — mirrors how DEFAULT_ROLE_PERMISSIONS
    // seeds view/edit but deliberately no create row for manager on "projects".
    const { scoped } = buildScopedRunner([]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "projects",
      action: "create",
    });

    expect(result).toBeNull();
  });

  it("employee with a projects self grant is allowed at that scope", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "self" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "employee",
      companyId,
      userId,
      module: "projects",
      action: "edit",
    });

    expect(result).toBe("self");
  });

  // Sales/CRM module (step 2 of the Sales build). As with `projects`, the
  // check logic is generic over module name — these prove the new module
  // name flows through correctly, and pin down the two grant decisions
  // that are specific to this module.
  it("manager with a sales own_department grant is allowed at that scope", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "own_department" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "sales",
      action: "view",
    });

    expect(result).toBe("own_department");
  });

  it("manager with no sales:create grant is denied (admin-only by default, opt-in per company)", async () => {
    const { scoped } = buildScopedRunner([]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "manager",
      companyId,
      userId,
      module: "sales",
      action: "create",
    });

    expect(result).toBeNull();
  });

  // The decision that makes the company-wide customer-read design safe:
  // a plain employee has NO sales access at all until a company
  // explicitly opts them in. Distinct from `projects`, where every
  // employee does get self-scoped grants by default.
  it("employee with no sales grant at all is denied — employees get nothing for sales by default", async () => {
    const { scoped } = buildScopedRunner([]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "employee",
      companyId,
      userId,
      module: "sales",
      action: "view",
    });

    expect(result).toBeNull();
  });

  it("employee explicitly opted in to sales at self scope is allowed — this opt-in IS the 'sales rep role', no new RoleName needed", async () => {
    const { scoped } = buildScopedRunner([{ userId: null, scope: "self" }]);
    const service = new PermissionCheckService(scoped);

    const result = await service.check({
      role: "employee",
      companyId,
      userId,
      module: "sales",
      action: "edit",
    });

    expect(result).toBe("self");
  });
});
