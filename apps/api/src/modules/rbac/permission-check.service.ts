import { Injectable } from "@nestjs/common";
import type { PermissionScope, RoleName } from "@prisma/client";
import { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";

export interface PermissionCheckInput {
  role: RoleName;
  companyId: string | null;
  userId: string;
  module: string;
  action: string;
}

// Widest-wins ordering, used when both a role-wide row and a per-user
// override row match the same module+action (see class doc comment).
const SCOPE_RANK: Record<PermissionScope, number> = {
  self: 0,
  own_department: 1,
  all: 2,
};

function widestScope(scopes: PermissionScope[]): PermissionScope {
  return scopes.reduce((widest, scope) =>
    SCOPE_RANK[scope] > SCOPE_RANK[widest] ? scope : widest,
  );
}

/**
 * Resolves whether {role, companyId, userId} may perform {module, action},
 * and if so, the effective PermissionScope — callers (RbacGuard, and
 * downstream repository-layer code for department-scoped filtering) need
 * both, not just a boolean.
 *
 * superadmin short-circuits to "all" explicitly, without ever querying
 * RolePermission — that table's companyId column is required and
 * superadmin isn't tenant-scoped (User.companyId is null only for
 * superadmin), so there's structurally no row for it to match. This is
 * the resolution to the gap flagged in step 2/3's DECISIONS.md entries.
 *
 * RolePermission is additive-only, not override/replace: a row's mere
 * existence grants access, and there is no schema-level way to represent
 * "deny this specific user a permission their role would otherwise have."
 * A per-user row (userId set) can only grant something in ADDITION to the
 * role-wide default (userId null), never take something away. When both a
 * role-wide and a user-specific row match the same module+action, the
 * WIDER of their two scopes wins — a per-user row's purpose is to extend
 * access for that person, so a narrower per-user scope should never
 * silently shrink what their role already grants them.
 */
@Injectable()
export class PermissionCheckService {
  constructor(private readonly scoped: TenantScopedRunner) {}

  async check(input: PermissionCheckInput): Promise<PermissionScope | null> {
    if (input.role === "superadmin") {
      return "all";
    }

    if (input.companyId === null) {
      // Structurally shouldn't happen (only superadmin has a null
      // companyId), but fail closed rather than assume.
      return null;
    }

    return this.scoped.run(input.companyId, async (tx) => {
      // No explicit companyId filter needed here — RLS (SET LOCAL, applied
      // by TenantScopedRunner.run above) already restricts this query to
      // the caller's own company; see DECISIONS.md, step 2.
      const rows = await tx.rolePermission.findMany({
        where: {
          role: input.role,
          module: input.module,
          action: input.action,
          OR: [{ userId: null }, { userId: input.userId }],
        },
        select: { scope: true },
      });

      if (rows.length === 0) return null;
      return widestScope(rows.map((row) => row.scope));
    });
  }
}
