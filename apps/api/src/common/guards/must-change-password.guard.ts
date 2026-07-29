import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SKIP_MUST_CHANGE_PASSWORD_KEY } from "../decorators/skip-must-change-password-check.decorator";
import { PrismaAuthService } from "../../database/prisma/prisma-auth.service";
import type { AccessTokenPayload } from "../../modules/auth/token.service";

/**
 * A user created with a temporary password (the company/admin creation
 * CLI, `mustChangePassword: true`) is blocked from every endpoint except
 * POST /auth/password/change until they've changed it — a server-side
 * guard, not a UI convention a client could just ignore.
 *
 * Reads the *current* mustChangePassword value from the database on every
 * request rather than trusting a claim baked into the access token at
 * login time: the token is valid for up to JWT_ACCESS_TTL (15 min) after
 * issuance, and if it carried a stale `mustChangePassword: true` claim,
 * a user who successfully changes their password mid-session would stay
 * locked out of everything else until that token naturally expired. One
 * extra read per request (via the narrow hrms_auth-bound
 * PrismaAuthService, not a new role) is the trade-off for correctness.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(
    private readonly prismaAuth: PrismaAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const user = request.user;
    // AuthGuard (runs first in the chain) already rejects requests with no
    // valid user for non-public routes — nothing to check here if that
    // somehow didn't happen.
    if (!user) return true;

    const current = await this.prismaAuth.findUserById(user.sub);
    if (current?.mustChangePassword) {
      throw new ForbiddenException("Password change required before continuing");
    }
    return true;
  }
}
