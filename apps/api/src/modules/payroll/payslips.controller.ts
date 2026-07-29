import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { PayslipsService } from "./payslips.service";

@Controller("payslips")
export class PayslipsController {
  constructor(private readonly payslipsService: PayslipsService) {}

  @RequirePermission("payroll", "view")
  @Get("me")
  myPayslips(@CurrentUser() user: AccessTokenPayload) {
    return this.payslipsService.myPayslips(user.sub);
  }

  // Department-scoped exactly like Employee reads: an employee's own
  // payroll:view (self) is what makes THIS endpoint reachable for their
  // own payslip; PayslipsService.createSignedUrl re-checks visibility
  // against the payslip's employeeId, the same way Documents does.
  @RequirePermission("payroll", "view")
  @Get(":id/signed-url")
  async signedUrl(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const result = await this.payslipsService.createSignedUrl(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!result) {
      throw new NotFoundException("Payslip not found");
    }
    return result;
  }

  // Deliberately @Public() — this IS the link, same reasoning as
  // Documents' download endpoint (step 5): authorization already happened
  // when the signed URL was generated.
  @Public()
  @Get("download")
  async download(@Query("token") token: string, @Res() res: Response): Promise<void> {
    if (!token) {
      throw new BadRequestException("Missing token");
    }
    const result = await this.payslipsService.downloadByToken(token);
    if (!result) {
      throw new NotFoundException("Payslip not found");
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  }
}
