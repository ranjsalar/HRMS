import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { LeaveTypesController } from "./leave-types.controller";
import { LeaveTypesService } from "./leave-types.service";
import { LeaveRequestsController } from "./leave-requests.controller";
import { LeaveRequestsService } from "./leave-requests.service";

@Module({
  imports: [AuditModule, EmployeesModule],
  controllers: [LeaveTypesController, LeaveRequestsController],
  providers: [LeaveTypesService, LeaveRequestsService],
})
export class LeaveModule {}
