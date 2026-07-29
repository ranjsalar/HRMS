import type { Prisma, RoleName } from "@prisma/client";
import { RBAC_ACTIONS, RBAC_MODULES } from "../../modules/rbac/rbac.constants";

type PermissionScope = "all" | "own_department" | "self";

export interface DefaultPermissionTemplate {
  role: RoleName;
  module: string;
  action: string;
  scope: PermissionScope;
}

function fullAccess(role: RoleName): DefaultPermissionTemplate[] {
  return RBAC_MODULES.flatMap((module) =>
    RBAC_ACTIONS.map((action) => ({ role, module, action, scope: "all" as const })),
  );
}

/**
 * Default company_admin / manager / employee permission matrix, applied to
 * every newly provisioned company. Tunable later per-company via the RBAC
 * module (step 4) — these are sane starting defaults, not hardcoded limits.
 *
 * superadmin is intentionally NOT represented here: RolePermission.companyId
 * is required (non-nullable) and superadmin is explicitly not tenant-scoped
 * (User.companyId is null only for superadmin), so there is no company to
 * attach a superadmin row to. The future PermissionsService should
 * short-circuit role === 'superadmin' to always-allow rather than querying
 * this table. See DECISIONS.md.
 */
export const DEFAULT_ROLE_PERMISSIONS: DefaultPermissionTemplate[] = [
  // company_admin: full access across every module in their own company.
  ...fullAccess("company_admin"),

  // manager: team oversight, scoped to their own department where it makes
  // sense; no payroll, audit, rbac, or company administration access.
  //
  // org:view is deliberately scope "all", not "own_department" — seeing
  // the org chart is a different thing from acting on employees within
  // it, and a manager needs the whole-company structure for context (who
  // their department reports into, sibling departments, etc). Nothing in
  // the org module lets a manager EDIT outside their scope; there's no
  // org:edit grant here at all, only view.
  { role: "manager", module: "org", action: "view", scope: "all" },
  { role: "manager", module: "employees", action: "view", scope: "own_department" },
  { role: "manager", module: "employees", action: "edit", scope: "own_department" },
  { role: "manager", module: "attendance", action: "view", scope: "own_department" },
  { role: "manager", module: "attendance", action: "edit", scope: "own_department" },
  { role: "manager", module: "attendance", action: "approve", scope: "own_department" },
  { role: "manager", module: "leave", action: "view", scope: "own_department" },
  { role: "manager", module: "leave", action: "approve", scope: "own_department" },
  { role: "manager", module: "documents", action: "view", scope: "own_department" },
  { role: "manager", module: "notifications", action: "view", scope: "self" },

  // employee: self-service only.
  { role: "employee", module: "employees", action: "view", scope: "self" },
  { role: "employee", module: "employees", action: "edit", scope: "self" },
  { role: "employee", module: "attendance", action: "view", scope: "self" },
  { role: "employee", module: "attendance", action: "create", scope: "self" },
  { role: "employee", module: "leave", action: "view", scope: "self" },
  { role: "employee", module: "leave", action: "create", scope: "self" },
  { role: "employee", module: "documents", action: "view", scope: "self" },
  // Added in step 9.4 (self-service document upload) — DocumentsService now
  // enforces isVisible(employeeId) on upload the same way it already did on
  // signed-url generation, so this grant is safe to add: an employee can
  // only ever create a document row FOR THEMSELVES. Same retroactive-seeding
  // caveat as "org"/"leave_types" (see DECISIONS.md) — already-provisioned
  // companies need their seed script re-run to pick this up.
  { role: "employee", module: "documents", action: "create", scope: "self" },
  { role: "employee", module: "payroll", action: "view", scope: "self" },
  { role: "employee", module: "notifications", action: "view", scope: "self" },
];

export function buildRolePermissionRows(companyId: string): Prisma.RolePermissionCreateManyInput[] {
  return DEFAULT_ROLE_PERMISSIONS.map((entry) => ({
    companyId,
    role: entry.role,
    module: entry.module,
    action: entry.action,
    scope: entry.scope,
  }));
}
