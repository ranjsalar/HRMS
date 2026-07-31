import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";

@Module({
  // AuthModule (for PasswordService, temp-password hashing) and
  // NotificationsModule (for the welcome email) — needed now that
  // employee creation can also provision a real login. See DECISIONS.md.
  imports: [AuditModule, AuthModule, NotificationsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
