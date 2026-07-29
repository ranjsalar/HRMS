import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AppController } from "./app.controller";
import { resolveEnvFilePath, validateEnv } from "./config/env.validation";
import { PrismaModule } from "./database/prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { EmployeesModule } from "./modules/employees/employees.module";
import { OrgModule } from "./modules/org/org.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { LeaveModule } from "./modules/leave/leave.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
import { HolidaysModule } from "./modules/holidays/holidays.module";
import { AuthGuard } from "./common/guards/auth.guard";
import { MustChangePasswordGuard } from "./common/guards/must-change-password.guard";
import { RbacGuard } from "./common/guards/rbac.guard";
import { TenantScopeInterceptor } from "./common/interceptors/tenant-scope.interceptor";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Explicit file per NODE_ENV — see resolveEnvFilePath's comment
      // and DECISIONS.md ("Config hygiene: envFilePath keyed to
      // NODE_ENV"). Without this, ConfigModule defaults to loading plain
      // ".env" from cwd regardless of environment, which let dev values
      // silently leak into the test process.
      envFilePath: resolveEnvFilePath(process.env.NODE_ENV),
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    RbacModule,
    EmployeesModule,
    OrgModule,
    DocumentsModule,
    AttendanceModule,
    LeaveModule,
    PayrollModule,
    HolidaysModule,
  ],
  controllers: [AppController],
  providers: [
    // Global guards run in registration order, all before interceptors,
    // per Nest's request lifecycle. Full chain and rationale documented in
    // DECISIONS.md ("Guard chain order"):
    //   AuthGuard -> MustChangePasswordGuard -> RbacGuard -> TenantScopeInterceptor
    // AuthGuard resolves request.user first; everything downstream reads
    // it. Routes opt out of AuthGuard (and therefore everything after it)
    // with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
