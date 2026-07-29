import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { PermissionScope } from "@prisma/client";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from "../decorators/require-permission.decorator";
import { PermissionCheckService } from "../../modules/rbac/permission-check.service";
import type { AccessTokenPayload } from "../../modules/auth/token.service";

export interface RequestWithPermissionScope extends Request {
  user?: AccessTokenPayload;
  permissionScope?: PermissionScope;
}

/**
 * Runs after AuthGuard and MustChangePasswordGuard (see DECISIONS.md,
 * "Guard chain order"), before TenantScopeInterceptor. Only checks routes
 * that declare @RequirePermission(module, action) — everything else
 * passes through unchanged, since not every endpoint is RBAC-gated (e.g.
 * /auth/me).
 *
 * Uses PermissionCheckService directly, which opens its own short
 * transaction via TenantScopedRunner rather than relying on
 * TenantContextStorage — that storage is only populated once
 * TenantScopeInterceptor runs, which is AFTER all guards, so it doesn't
 * exist yet at this point in the request lifecycle.
 *
 * On success, stashes the resolved PermissionScope on the request
 * (request.permissionScope) so downstream repository-layer code —
 * `own_department` filtering, for instance — knows how to further
 * narrow its queries, without re-deriving the permission check itself.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly permissionCheck: PermissionCheckService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<RequiredPermission>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<RequestWithPermissionScope>();
    const user = request.user;
    if (!user) {
      // Shouldn't happen — AuthGuard already rejects unauthenticated
      // requests to non-public routes — but fail closed defensively.
      throw new ForbiddenException("Missing permission context");
    }

    const scope = await this.permissionCheck.check({
      role: user.role,
      companyId: user.companyId,
      userId: user.sub,
      module: required.module,
      action: required.action,
    });

    if (!scope) {
      throw new ForbiddenException(`Missing permission: ${required.module}:${required.action}`);
    }

    request.permissionScope = scope;
    return true;
  }
}
