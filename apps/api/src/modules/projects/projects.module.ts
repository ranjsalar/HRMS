import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { TaskTimeEntriesController } from "./task-time-entries.controller";
import { TaskTimeEntriesService } from "./task-time-entries.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  // EmployeesModule — reuses EmployeesService.managedDepartmentId/findOwn
  // for own_department/self scope resolution, same pattern AttendanceService
  // and DocumentsService already follow. Project, Task, and TaskTimeEntry
  // share one module (and one RBAC permission module, "projects") per
  // Projects-Module-Plan.md §3 — TasksService depends on ProjectsService,
  // TaskTimeEntriesService depends on TasksService, no separate modules.
  imports: [AuditModule, EmployeesModule],
  controllers: [ProjectsController, TasksController, TaskTimeEntriesController],
  providers: [ProjectsService, TasksService, TaskTimeEntriesService],
  exports: [ProjectsService, TasksService, TaskTimeEntriesService],
})
export class ProjectsModule {}
