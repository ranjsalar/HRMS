import { Injectable } from "@nestjs/common";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { CreateRolePermissionDto, UpdateRolePermissionDto } from "./dto/role-permission.dto";

/**
 * Reads/writes go through TenantContextStorage's transaction (populated by
 * TenantScopeInterceptor, which by this point in the request has already
 * run — controllers execute after all guards AND interceptors' pre-hook —
 * so RLS is already scoping every query here to the caller's own company.
 * A row belonging to another company is simply invisible: update()/delete()
 * against someone else's row id fails with Prisma's "not found" (P2025),
 * which the global exception filter maps to a plain 404 — company_admin
 * can never distinguish "doesn't exist" from "exists in another company"
 * for a row they have no business seeing either way.
 */
@Injectable()
export class RbacService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("RbacService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  list() {
    return this.tx().rolePermission.findMany({
      orderBy: [{ role: "asc" }, { module: "asc" }, { action: "asc" }],
    });
  }

  create(companyId: string, dto: CreateRolePermissionDto) {
    return this.tx().rolePermission.create({
      data: {
        companyId,
        role: dto.role,
        module: dto.module,
        action: dto.action,
        scope: dto.scope,
        userId: dto.userId,
      },
    });
  }

  update(id: string, dto: UpdateRolePermissionDto) {
    return this.tx().rolePermission.update({
      where: { id },
      data: { scope: dto.scope },
    });
  }

  async remove(id: string): Promise<void> {
    await this.tx().rolePermission.delete({ where: { id } });
  }
}
