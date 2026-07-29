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
import { DepartmentService } from "./department.service";
import { CreateDepartmentDto, UpdateDepartmentDto } from "./dto/department.dto";

@Controller("departments")
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @RequirePermission("org", "view")
  @Get()
  list() {
    return this.departmentService.findMany();
  }

  // Registered before ":id" so "org-chart" isn't swallowed by the :id route.
  @RequirePermission("org", "view")
  @Get("org-chart")
  orgChart() {
    return this.departmentService.orgChart();
  }

  @RequirePermission("org", "view")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const department = await this.departmentService.findOne(id);
    if (!department) throw new NotFoundException("Department not found");
    return department;
  }

  @RequirePermission("org", "create")
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateDepartmentDto) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.departmentService.create(user.companyId, dto);
  }

  @RequirePermission("org", "edit")
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateDepartmentDto) {
    const department = await this.departmentService.update(id, dto);
    if (!department) throw new NotFoundException("Department not found");
    return department;
  }

  @RequirePermission("org", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string) {
    const removed = await this.departmentService.remove(id);
    if (!removed) throw new NotFoundException("Department not found");
  }
}
