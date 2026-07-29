import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";

/**
 * Dedicated Super Admin connection — bound to DATABASE_SUPERADMIN_URL, the
 * hrms_superadmin role (BYPASSRLS). Deliberately a separate PrismaClient
 * instance from PrismaService, not just a different query on the same
 * connection, so there is no code path where a tenant-scoped request can
 * accidentally end up using it.
 *
 * Must only be injected into code that has already confirmed, server-side,
 * that the authenticated user's role is `superadmin` — that check lives in
 * the RBAC/guards module (step 4), not here. This service only owns the
 * connection; it enforces nothing about who may call it.
 */
@Injectable()
export class PrismaSuperAdminService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasources: {
        db: { url: config.getOrThrow<string>("DATABASE_SUPERADMIN_URL") },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
