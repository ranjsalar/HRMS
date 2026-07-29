import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { RbacGuard, type RequestWithPermissionScope } from "./rbac.guard";
import type { PermissionCheckService } from "../../modules/rbac/permission-check.service";
import type { RequiredPermission } from "../decorators/require-permission.decorator";

function buildContext(user: unknown): {
  context: ExecutionContext;
  request: RequestWithPermissionScope;
} {
  const request = { user } as RequestWithPermissionScope;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

function buildReflector(isPublic: boolean, required: RequiredPermission | undefined): Reflector {
  let call = 0;
  const results = [isPublic, required];
  return { getAllAndOverride: () => results[call++] } as unknown as Reflector;
}

describe("RbacGuard", () => {
  it("allows @Public() routes without checking permissions", async () => {
    const check = jest.fn();
    const permissionCheck = { check } as unknown as PermissionCheckService;
    const guard = new RbacGuard(permissionCheck, buildReflector(true, undefined));

    const { context } = buildContext(undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("allows routes with no @RequirePermission() declared, without checking", async () => {
    const check = jest.fn();
    const permissionCheck = { check } as unknown as PermissionCheckService;
    const guard = new RbacGuard(permissionCheck, buildReflector(false, undefined));

    const { context } = buildContext({ sub: "u1", companyId: "c1", role: "employee" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("denies with ForbiddenException (403) when the permission check resolves to null", async () => {
    const check = jest.fn().mockResolvedValue(null);
    const permissionCheck = { check } as unknown as PermissionCheckService;
    const guard = new RbacGuard(
      permissionCheck,
      buildReflector(false, { module: "payroll", action: "delete" }),
    );

    const { context } = buildContext({ sub: "u1", companyId: "c1", role: "employee" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows and stashes the resolved scope on the request when permitted", async () => {
    const check = jest.fn().mockResolvedValue("own_department");
    const permissionCheck = { check } as unknown as PermissionCheckService;
    const guard = new RbacGuard(
      permissionCheck,
      buildReflector(false, { module: "employees", action: "view" }),
    );

    const { context, request } = buildContext({ sub: "u1", companyId: "c1", role: "manager" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.permissionScope).toBe("own_department");
    expect(check).toHaveBeenCalledWith({
      role: "manager",
      companyId: "c1",
      userId: "u1",
      module: "employees",
      action: "view",
    });
  });
});
