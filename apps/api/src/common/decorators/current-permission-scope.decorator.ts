import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import type { RequestWithPermissionScope } from "../guards/rbac.guard";

/** Extracts request.permissionScope (stashed by RbacGuard once a @RequirePermission() check passes). */
export const CurrentPermissionScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PermissionScope | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithPermissionScope>();
    return request.permissionScope;
  },
);
