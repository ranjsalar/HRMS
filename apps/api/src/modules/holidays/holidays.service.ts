import { Injectable } from "@nestjs/common";
import type { Holiday } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";

const DEFAULT_LIMIT = 5;

/**
 * Deliberately does NOT filter by companyId in the query itself — Holiday's
 * own RLS policy (`companyId = current_setting(...) OR companyId IS NULL`,
 * see the enable_rls_and_roles migration) already restricts visible rows
 * to this tenant's overrides plus the system-wide calendar. Re-adding that
 * filter here would just duplicate what the database already guarantees.
 */
@Injectable()
export class HolidaysService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("HolidaysService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  upcoming(limit: number = DEFAULT_LIMIT): Promise<Holiday[]> {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    return this.tx().holiday.findMany({
      where: { date: { gte: todayUtc } },
      orderBy: { date: "asc" },
      take: limit,
    });
  }
}
