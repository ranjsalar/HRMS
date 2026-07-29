import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { TokenService } from "../../modules/auth/token.service";

/**
 * Global guard: verifies the Authorization: Bearer <accessToken> header and
 * attaches the decoded payload as request.user, which TenantScopeInterceptor
 * (runs after guards, per Nest's request lifecycle) reads to scope the
 * request's Prisma transaction. Routes opt out with @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing access token");
    }

    try {
      const payload = this.tokenService.verifyAccessToken(token);
      (request as Request & { user: typeof payload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}
