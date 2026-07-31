import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { REQUIRE_SUPERADMIN_KEY } from "../decorators/require-superadmin.decorator";
import type { AccessTokenPayload } from "../../modules/auth/token.service";

/**
 * Applied at controller/route level (@UseGuards(SuperAdminGuard)) on the
 * SuperAdmin module specifically — not registered globally, since it's
 * only relevant to that one controller. Runs after the global guard chain
 * (AuthGuard has already populated request.user; see DECISIONS.md, "Guard
 * chain order" — Nest resolves global guards before controller-level
 * ones), so request.user is always present here for any route that
 * reaches this guard at all.
 *
 * A missing @RequireSuperAdmin() (e.g. a future route added to this
 * controller without it) fails CLOSED, not open — the opposite default
 * from AuthGuard's @Public()/RbacGuard's @RequirePermission(), and
 * deliberately so: this controller has no legitimate non-superadmin
 * route, so there's no reason for "undecorated" to ever mean "allowed."
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_SUPERADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      throw new ForbiddenException("This route requires superadmin access");
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    if (request.user?.role !== "superadmin") {
      throw new ForbiddenException("This route requires superadmin access");
    }

    return true;
  }
}
