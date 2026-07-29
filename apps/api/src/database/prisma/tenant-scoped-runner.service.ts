import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { PrismaSuperAdminService } from "./prisma-superadmin.service";
import { isValidUuid } from "../../common/utils/uuid";

/**
 * Runs `fn` against the correctly-scoped Prisma connection for a given
 * companyId: the Super Admin (BYPASSRLS) connection when companyId is
 * null (superadmin isn't tenant-scoped, so there's no company_id to SET
 * LOCAL to), otherwise a transaction on the RLS-enforced tenant connection
 * with app.current_company_id set to that company.
 *
 * Exists because guards run before TenantScopeInterceptor in Nest's
 * request lifecycle (see DECISIONS.md, "Guard chain order"), so any guard
 * that needs a tenant-scoped query — RbacGuard checking RolePermission,
 * for instance — can't rely on the interceptor's transaction, which
 * doesn't exist yet at guard time. Those callers open their own short,
 * separate transaction via this helper instead. AuthService needs the
 * exact same thing for the same reason (auth flows run before any
 * access-token-derived request.user exists for the interceptor to key
 * off), so this was extracted out of AuthService rather than duplicated.
 */
@Injectable()
export class TenantScopedRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaSuperAdmin: PrismaSuperAdminService,
  ) {}

  async run<T>(
    companyId: string | null,
    fn: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (companyId === null) {
      return fn(this.prismaSuperAdmin);
    }
    if (!isValidUuid(companyId)) {
      throw new Error("Invalid companyId");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);
      return fn(tx);
    });
  }
}
