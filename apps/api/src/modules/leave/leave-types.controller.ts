import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { CreateLeaveTypeDto, UpdateLeaveTypeDto } from "./dto/leave-type.dto";
import { LeaveTypesService } from "./leave-types.service";

@Controller("leave-types")
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  // Deliberately NOT RBAC-gated beyond authentication: every employee needs
  // to see which leave types exist (and which are still active) to submit
  // a request. Admin CRUD below is gated on the separate "leave_types"
  // module — see rbac.constants.ts for why it isn't just "leave".
  @Get()
  listActive() {
    return this.leaveTypesService.findActive();
  }

  @RequirePermission("leave_types", "view")
  @Get("all")
  listAll() {
    return this.leaveTypesService.findAll();
  }

  @RequirePermission("leave_types", "create")
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateLeaveTypeDto) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.leaveTypesService.create(user.companyId, dto);
  }

  @RequirePermission("leave_types", "edit")
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateLeaveTypeDto) {
    const leaveType = await this.leaveTypesService.update(id, dto);
    if (!leaveType) throw new NotFoundException("Leave type not found");
    return leaveType;
  }

  // Deactivate, never hard-delete — see LeaveTypesService.
  @RequirePermission("leave_types", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string) {
    const removed = await this.leaveTypesService.deactivate(id);
    if (!removed) throw new NotFoundException("Leave type not found");
  }
}
