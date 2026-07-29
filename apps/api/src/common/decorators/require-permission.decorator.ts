import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PERMISSION_KEY = "requirePermission";

export interface RequiredPermission {
  module: string;
  action: string;
}

/**
 * Declares the {module, action} a route needs — RbacGuard reads this via
 * Reflector and resolves it against PermissionCheckService. Routes with no
 * @RequirePermission() are NOT RBAC-checked (RbacGuard allows them by
 * default) — only endpoints that opt in are gated this way; every other
 * layer (AuthGuard, MustChangePasswordGuard) still applies regardless.
 */
export const RequirePermission = (module: string, action: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { module, action } satisfies RequiredPermission);
