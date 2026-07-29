import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { RbacService } from "./rbac.service";
import {
  CreateRolePermissionDto,
  RolePermissionParamsDto,
  UpdateRolePermissionDto,
} from "./dto/role-permission.dto";

/**
 * Company-scoped by design: "a company_admin to view and modify their own
 * company's role x module x action permission grid." companyId is always
 * derived from the authenticated session (request.user.companyId), never
 * accepted from the client — a company_admin cannot modify another
 * company's permissions even by guessing an id, both because this
 * endpoint never lets them supply a companyId at all and because RLS (via
 * RbacService's tenant-scoped tx) makes another company's rows invisible
 * regardless.
 *
 * Super Admin (companyId: null) is explicitly rejected here rather than
 * silently mishandled — RolePermission is inherently per-company, and
 * there's no tenant transaction open for a superadmin request in the
 * first place (TenantScopeInterceptor only opens one when a companyId
 * exists). Cross-company RBAC administration, if ever needed, is a
 * separate superadmin-specific concern, not this endpoint.
 */
@Controller("rbac/permissions")
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @RequirePermission("rbac", "view")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    this.requireCompanyScope(user);
    return this.rbacService.list();
  }

  @RequirePermission("rbac", "create")
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateRolePermissionDto) {
    const companyId = this.requireCompanyScope(user);
    return this.rbacService.create(companyId, dto);
  }

  @RequirePermission("rbac", "edit")
  @Patch(":id")
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param() params: RolePermissionParamsDto,
    @Body() dto: UpdateRolePermissionDto,
  ) {
    this.requireCompanyScope(user);
    return this.rbacService.update(params.id, dto);
  }

  @RequirePermission("rbac", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AccessTokenPayload, @Param() params: RolePermissionParamsDto) {
    this.requireCompanyScope(user);
    await this.rbacService.remove(params.id);
  }

  private requireCompanyScope(user: AccessTokenPayload): string {
    if (!user.companyId) {
      throw new ForbiddenException(
        "This endpoint manages one company's permission grid and requires a company-scoped session.",
      );
    }
    return user.companyId;
  }
}
