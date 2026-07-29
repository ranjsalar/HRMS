import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from "@nestjs/common";
import { firstValueFrom, from, Observable } from "rxjs";
import { PrismaService } from "../../database/prisma/prisma.service";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { isValidUuid } from "../utils/uuid";

interface RequestWithUser {
  user?: { companyId?: string | null };
}

/**
 * Wraps every tenant request in a single Prisma interactive transaction and
 * runs `SET LOCAL app.current_company_id` inside it before the route
 * handler executes any query, immediately after AuthGuard (which runs
 * before interceptors in Nest's request lifecycle) has resolved
 * request.user.companyId. Downstream services must read the active
 * transaction via TenantContextStorage.getStore().tx — not the raw
 * PrismaService — for RLS to actually apply to their queries.
 *
 * Requests with no companyId (Super Admin, whose User.companyId is null)
 * skip this entirely — that path must use PrismaSuperAdminService directly,
 * gated by a confirmed-superadmin check in the RBAC guard layer.
 *
 * Not yet registered globally in AppModule: it depends on AuthGuard
 * (step 3) having already populated request.user first. Will be wired
 * alongside AuthGuard/RbacGuard once that module exists.
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextStorage,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const companyId = request.user?.companyId;

    if (!companyId) {
      return next.handle();
    }

    if (!isValidUuid(companyId)) {
      throw new UnauthorizedException("Invalid tenant context");
    }

    return from(
      this.prisma.$transaction(async (tx): Promise<unknown> => {
        // SET LOCAL does not accept bind parameters (it's a configuration
        // command, not DML) — Postgres only accepts a literal here. Safe
        // because companyId was just validated against UUID_RE above.
        await tx.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}'`);

        return this.tenantContext.run({ tx, companyId }, () =>
          firstValueFrom<unknown>(next.handle()),
        );
      }),
    );
  }
}
