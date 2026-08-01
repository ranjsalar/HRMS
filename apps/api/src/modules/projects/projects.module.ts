import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  // EmployeesModule — reuses EmployeesService.managedDepartmentId/findOwn
  // for own_department/self scope resolution, same pattern AttendanceService
  // and DocumentsService already follow.
  imports: [AuditModule, EmployeesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
