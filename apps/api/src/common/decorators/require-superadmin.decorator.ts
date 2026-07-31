import { SetMetadata } from "@nestjs/common";

export const REQUIRE_SUPERADMIN_KEY = "requireSuperAdmin";

/**
 * Marks a route as superadmin-only. Unlike @RequirePermission (RbacGuard),
 * which checks a per-company RolePermission grid and is meaningless for a
 * superadmin session (companyId: null, no tenant transaction ever opens
 * for it — see TenantScopeInterceptor's comment), this is a direct role
 * check: request.user.role === "superadmin", nothing else. See
 * SuperAdminGuard and DECISIONS.md ("Super Admin dashboard: a new,
 * non-RBAC authorization path").
 */
export const RequireSuperAdmin = () => SetMetadata(REQUIRE_SUPERADMIN_KEY, true);
