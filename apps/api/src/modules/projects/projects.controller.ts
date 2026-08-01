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
import { AddProjectMemberDto, CreateProjectDto, UpdateProjectDto } from "./dto/project.dto";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @RequirePermission("projects", "view")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @CurrentPermissionScope() scope: PermissionScope) {
    return this.projectsService.findMany(user.sub, scope);
  }

  @RequirePermission("projects", "view")
  @Get(":id")
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
  ) {
    const project = await this.projectsService.findOne(id, user.sub, scope);
    if (!project) {
      // Same deliberate "existence isn't revealed outside scope" 404 used
      // throughout this app (see EmployeesController.findOne).
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  @RequirePermission("projects", "create")
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Body() dto: CreateProjectDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.projectsService.create(user.companyId, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("projects", "edit")
  @Patch(":id")
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @ClientIp() ipAddress: string,
  ) {
    const project = await this.projectsService.update(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  // Soft "archive" only — status -> cancelled. No hard-delete path, same
  // convention as every other module (Employee, LeaveType, ...).
  @RequirePermission("projects", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const archived = await this.projectsService.archive(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!archived) {
      throw new NotFoundException("Project not found");
    }
  }

  @RequirePermission("projects", "edit")
  @Post(":id/members")
  addMember(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: AddProjectMemberDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.projectsService.addMember(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("projects", "edit")
  @Delete(":id/members/:employeeId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Param("employeeId") employeeId: string,
    @ClientIp() ipAddress: string,
  ) {
    const removed = await this.projectsService.removeMember(id, employeeId, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!removed) {
      throw new NotFoundException("Project member not found");
    }
  }
}
