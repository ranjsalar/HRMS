import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AccessTokenPayload } from "../../modules/auth/token.service";

/** Extracts request.user (populated by AuthGuard from the verified access token). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: AccessTokenPayload }>();
    return request.user;
  },
);
