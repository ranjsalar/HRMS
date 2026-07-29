import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { ASSIGNABLE_ROLES, RBAC_ACTIONS, RBAC_MODULES } from "../rbac.constants";

const SCOPES = ["all", "own_department", "self"] as const;

export class CreateRolePermissionDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: (typeof ASSIGNABLE_ROLES)[number];

  @IsIn(RBAC_MODULES)
  module!: (typeof RBAC_MODULES)[number];

  @IsIn(RBAC_ACTIONS)
  action!: (typeof RBAC_ACTIONS)[number];

  @IsIn(SCOPES)
  scope!: (typeof SCOPES)[number];

  // Per-user override — omit for a role-wide default. Never a companyId
  // field here: that's always the caller's own company, derived
  // server-side from the authenticated session, never accepted from the
  // client. See DECISIONS.md.
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class UpdateRolePermissionDto {
  @IsIn(SCOPES)
  scope!: (typeof SCOPES)[number];
}

export class RolePermissionParamsDto {
  @IsString()
  id!: string;
}
