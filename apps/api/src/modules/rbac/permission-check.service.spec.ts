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
});
