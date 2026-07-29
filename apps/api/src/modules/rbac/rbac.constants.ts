// Shared with the default-permission seed template
// (database/seeds/default-role-permissions.ts) so the CRUD endpoints and
// the seeded defaults can never drift apart on what a valid module/action
// name is.
export const RBAC_MODULES = [
  "companies",
  "employees",
  "org", // Department/Branch CRUD + org chart — added step 5
  "attendance",
  "leave", // LeaveRequest workflow (submit/approve/reject/cancel) — an employee's own "create" grant here must NEVER imply LeaveType admin rights
  "leave_types", // LeaveType CRUD (admin-only) — deliberately separate from "leave" so employee's leave:create (their own request) can't be misread as permission to create a company-wide LeaveType. Added step 7.
  "payroll",
  "documents",
  "notifications",
  "audit",
  "rbac",
] as const;

export const RBAC_ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;

export type RbacModuleName = (typeof RBAC_MODULES)[number];
export type RbacActionName = (typeof RBAC_ACTIONS)[number];

// RolePermission.companyId is required and superadmin isn't tenant-scoped
// (User.companyId is null only for superadmin) — a RolePermission row for
// role="superadmin" would have no coherent company to belong to. superadmin
// short-circuits to always-allow in PermissionCheckService instead. See
// DECISIONS.md, step 2 and step 4.
export const ASSIGNABLE_ROLES = ["company_admin", "manager", "employee"] as const;
export type AssignableRoleName = (typeof ASSIGNABLE_ROLES)[number];
