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
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { CreateTaskDto, UpdateTaskDto, UpdateTaskStatusDto } from "./dto/task.dto";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @RequirePermission("projects", "view")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @CurrentPermissionScope() scope: PermissionScope) {
    return this.tasksService.findMany(user.sub, scope);
  }

  @RequirePermission("projects", "view")
  @Get(":id")
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
  ) {
    const task = await this.tasksService.findOne(id, user.sub, scope);
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  @RequirePermission("projects", "create")
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Body() dto: CreateTaskDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.tasksService.create(dto, user.sub, scope, { userId: user.sub, ipAddress });
  }

  @RequirePermission("projects", "edit")
  @Patch(":id")
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @ClientIp() ipAddress: string,
  ) {
    const task = await this.tasksService.update(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  // The employee allow-list: status only, and (at self scope) only on a
  // task assigned to the caller — see UpdateTaskStatusDto and
  // TasksService.updateStatus. Registered after ":id" so it doesn't
  // collide with the general PATCH :id route's path.
  @RequirePermission("projects", "edit")
  @Patch(":id/status")
  async updateStatus(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: UpdateTaskStatusDto,
    @ClientIp() ipAddress: string,
  ) {
    const task = await this.tasksService.updateStatus(id, dto.status, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  // Real hard delete for Task — no soft/cancelled state exists on
  // TaskStatus, unlike Project's archive. See TasksService.remove.
  @RequirePermission("projects", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const removed = await this.tasksService.remove(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!removed) {
      throw new NotFoundException("Task not found");
    }
  }
}
