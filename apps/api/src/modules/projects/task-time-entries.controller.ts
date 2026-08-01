import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { LogTaskTimeEntryDto } from "./dto/task-time-entry.dto";
import { TaskTimeEntriesService } from "./task-time-entries.service";

@Controller("tasks/:taskId/time-entries")
export class TaskTimeEntriesController {
  constructor(private readonly timeEntries: TaskTimeEntriesService) {}

  // "edit" (not "create") — matches the plan's own RBAC table: an
  // employee's time-logging right is part of their `projects:edit` grant
  // at `self` scope (the same one that covers task status), not a
  // separate creation permission. No new default grant was needed for
  // this step — see DECISIONS.md.
  @RequirePermission("projects", "edit")
  @Post()
  log(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("taskId") taskId: string,
    @Body() dto: LogTaskTimeEntryDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.timeEntries.log(taskId, dto, user.sub, scope, { userId: user.sub, ipAddress });
  }

  @RequirePermission("projects", "view")
  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("taskId") taskId: string,
  ) {
    return this.timeEntries.findMany(taskId, user.sub, scope);
  }
}
