import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface TenantContextStore {
  tx: Prisma.TransactionClient;
  companyId: string;
}

/**
 * Carries the current request's tenant-scoped transaction client across
 * async boundaries (controller → service → repository) without threading
 * it through every function signature. Populated once per request by
 * TenantScopeInterceptor; repository/service code reads it back via
 * `getStore()` to run queries on the same transaction that had
 * SET LOCAL app.current_company_id applied to it.
 */
@Injectable()
export class TenantContextStorage {
  private readonly als = new AsyncLocalStorage<TenantContextStore>();

  run<T>(store: TenantContextStore, fn: () => Promise<T>): Promise<T> {
    return this.als.run(store, fn);
  }

  getStore(): TenantContextStore | undefined {
    return this.als.getStore();
  }
}
