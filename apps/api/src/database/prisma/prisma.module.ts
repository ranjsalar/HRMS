import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { PrismaSuperAdminService } from "./prisma-superadmin.service";
import { PrismaAuthService } from "./prisma-auth.service";
import { TenantContextStorage } from "./tenant-context.storage";
import { TenantScopedRunner } from "./tenant-scoped-runner.service";

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaSuperAdminService,
    PrismaAuthService,
    TenantContextStorage,
    TenantScopedRunner,
  ],
  exports: [
    PrismaService,
    PrismaSuperAdminService,
    PrismaAuthService,
    TenantContextStorage,
    TenantScopedRunner,
  ],
})
export class PrismaModule {}
