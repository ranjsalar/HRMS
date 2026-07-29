import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Tenant runtime connection — bound to DATABASE_URL, the hrms_app role.
 * RLS-enforced: this connection can only ever see rows for whatever
 * company_id was SET LOCAL by TenantScopeInterceptor within the current
 * transaction. Never use this for cross-tenant queries; use
 * PrismaSuperAdminService for that, behind a confirmed-superadmin check.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
