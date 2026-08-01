import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, seconds } from "@nestjs/throttler";
import { GeneralApiThrottlerGuard } from "./common/guards/general-api-throttler.guard";
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
import { SuperAdminModule } from "./modules/superadmin/superadmin.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { SalesModule } from "./modules/sales/sales.module";
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
    // ALL of this app's throttlers, in ONE registration — @nestjs/
    // throttler's ThrottlerModule is internally @Global(), so a SECOND,
    // separate .forRootAsync() call anywhere else (AuthModule used to
    // have its own) silently collides on the same global provider
    // tokens instead of coexisting: whichever registration "wins" is
    // the only one any ThrottlerGuard anywhere in the app actually
    // sees. Found live — after adding "generalApi" here in a separate
    // registration, AuthController's existing "authLogin"/"authStrict"
    // throttles stopped firing entirely (a real e2e regression, not a
    // hypothetical). "generalApi" backs the global APP_GUARD below,
    // applying to every route; "authLogin"/"authStrict" back
    // AuthController's own @Throttle()/@SkipThrottle() decorators on
    // its three specific routes (see auth.controller.ts and
    // DECISIONS.md, "Rate limiting on auth endpoints" and
    // "Infrastructure pass, item 4").
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: "generalApi",
          ttl: seconds(60),
          limit: config.getOrThrow<number>("GENERAL_API_RATE_LIMIT"),
        },
        {
          name: "authLogin",
          ttl: seconds(60),
          limit: config.getOrThrow<number>("AUTH_LOGIN_RATE_LIMIT"),
        },
        {
          name: "authStrict",
          ttl: seconds(60),
          limit: config.getOrThrow<number>("AUTH_STRICT_RATE_LIMIT"),
        },
      ],
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
    SuperAdminModule,
    ProjectsModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [
    // Global guards run in registration order, all before interceptors,
    // per Nest's request lifecycle. Full chain and rationale documented in
    // DECISIONS.md ("Guard chain order"):
    //   GeneralApiThrottlerGuard -> AuthGuard -> MustChangePasswordGuard -> RbacGuard -> TenantScopeInterceptor
    // The general throttle runs FIRST, before any auth work — same
    // reasoning as the auth-specific throttlers in AuthModule: a
    // throttled request should never reach password hashing, DB
    // lookups, or anything else costly, and rejecting cheaply first is
    // exactly what an outer rate limit is for. It applies uniformly to
    // @Public() and authenticated routes alike (it has no concept of
    // @Public() at all — that's AuthGuard's decorator, read one guard
    // later). AuthGuard resolves request.user next; everything
    // downstream reads it. Routes opt out of AuthGuard (and therefore
    // everything after it) with @Public().
    { provide: APP_GUARD, useClass: GeneralApiThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
