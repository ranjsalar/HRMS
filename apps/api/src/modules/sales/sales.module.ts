import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";

@Module({
  // EmployeesModule — reuses EmployeesService.managedDepartmentId/findOwn
  // for owner-based scope resolution, the same pattern AttendanceService,
  // DocumentsService, and the Projects module already follow.
  //
  // Leads, Deals, SalesOrders (steps 4-6) will join this same module —
  // one module for the whole Sales domain, matching the single "sales"
  // RBAC module. See Sales-CRM-Module-Plan.md §3.
  imports: [AuditModule, EmployeesModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class SalesModule {}
