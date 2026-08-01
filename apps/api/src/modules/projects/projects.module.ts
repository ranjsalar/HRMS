import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  // EmployeesModule — reuses EmployeesService.managedDepartmentId/findOwn
  // for own_department/self scope resolution, same pattern AttendanceService
  // and DocumentsService already follow. Task and Project share one module
  // (and one RBAC permission module, "projects") per
  // Projects-Module-Plan.md §3 — TasksService depends directly on
  // ProjectsService (a parent Task's visibility follows its Project's),
  // no separate TasksModule.
  imports: [AuditModule, EmployeesModule],
  controllers: [ProjectsController, TasksController],
  providers: [ProjectsService, TasksService],
  exports: [ProjectsService, TasksService],
})
export class ProjectsModule {}
