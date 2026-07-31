import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequireSuperAdmin } from "../../common/decorators/require-superadmin.decorator";
import { SuperAdminGuard } from "../../common/guards/superadmin.guard";
import type { AccessTokenPayload } from "../auth/token.service";
import { SuperAdminService } from "./superadmin.service";
import { CompanyIdParamsDto, CreateCompanyDto, UpdateCompanyStatusDto } from "./dto/company.dto";

/**
 * Superadmin-only company management — replaces the create-company CLI
 * with a real UI, plus the list/suspend capabilities the CLI never had.
 * Every route requires @RequireSuperAdmin() + SuperAdminGuard (a direct
 * role check, not the tenant-scoped RBAC system RbacGuard enforces
 * elsewhere — see that guard's own comment for why). No route here is
 * @Public(): the global AuthGuard already requires a valid access token
 * for everything by default, so there is no new unauthenticated surface.
 * General API rate limiting (GeneralApiThrottlerGuard) already applies
 * globally, same as every other authenticated route. See DECISIONS.md.
 */
@UseGuards(SuperAdminGuard)
@Controller("superadmin/companies")
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @RequireSuperAdmin()
  @Get()
  list() {
    return this.superAdminService.listCompanies();
  }

  @RequireSuperAdmin()
  @Post()
  create(
    @Body() dto: CreateCompanyDto,
    @CurrentUser() user: AccessTokenPayload,
    @ClientIp() ipAddress: string,
  ) {
    return this.superAdminService.createCompany(dto, { userId: user.sub, ipAddress });
  }

  @RequireSuperAdmin()
  @Patch(":id/status")
  setStatus(
    @Param() params: CompanyIdParamsDto,
    @Body() dto: UpdateCompanyStatusDto,
    @CurrentUser() user: AccessTokenPayload,
    @ClientIp() ipAddress: string,
  ) {
    return this.superAdminService.setCompanyStatus(params.id, dto, { userId: user.sub, ipAddress });
  }
}
