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
import { BranchService } from "./branch.service";
import { CreateBranchDto, UpdateBranchDto } from "./dto/branch.dto";

@Controller("branches")
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @RequirePermission("org", "view")
  @Get()
  list() {
    return this.branchService.findMany();
  }

  @RequirePermission("org", "view")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const branch = await this.branchService.findOne(id);
    if (!branch) throw new NotFoundException("Branch not found");
    return branch;
  }

  @RequirePermission("org", "create")
  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateBranchDto) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.branchService.create(user.companyId, dto);
  }

  @RequirePermission("org", "edit")
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateBranchDto) {
    const branch = await this.branchService.update(id, dto);
    if (!branch) throw new NotFoundException("Branch not found");
    return branch;
  }

  @RequirePermission("org", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string) {
    const removed = await this.branchService.remove(id);
    if (!removed) throw new NotFoundException("Branch not found");
  }
}
