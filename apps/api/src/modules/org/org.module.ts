import { Module } from "@nestjs/common";
import { DepartmentController } from "./department.controller";
import { DepartmentService } from "./department.service";
import { BranchController } from "./branch.controller";
import { BranchService } from "./branch.service";

@Module({
  controllers: [DepartmentController, BranchController],
  providers: [DepartmentService, BranchService],
})
export class OrgModule {}
