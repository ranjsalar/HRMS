import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}

/**
 * Writes AuditLog rows through the SAME tenant-scoped transaction the
 * triggering write uses (TenantContextStorage's tx, populated by
 * TenantScopeInterceptor) — not a separate connection. That means an
 * audit entry and the change it describes commit or roll back together:
 * there's no window where an Employee update succeeds but its audit
 * record doesn't (or vice versa), which matters for something whose whole
 * purpose is being a trustworthy record of what happened.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  async record(entry: AuditEntry): Promise<void> {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("AuditService used outside a tenant-scoped request");
    }
    await store.tx.auditLog.create({
      data: {
        companyId: store.companyId,
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress,
      },
    });
  }
}
