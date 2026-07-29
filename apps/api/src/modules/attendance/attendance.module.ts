import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({
  imports: [AuditModule, EmployeesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
