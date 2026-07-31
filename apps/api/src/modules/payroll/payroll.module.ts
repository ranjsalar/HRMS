import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { createStorageService } from "../../common/storage/storage.factory";
import { STORAGE_SERVICE } from "../../common/storage/storage.interface";
import { PayrollRulesController } from "./payroll-rules.controller";
import { PayrollRulesService } from "./payroll-rules.service";
import { PayrollRunsController } from "./payroll-runs.controller";
import { PayrollRunsService } from "./payroll-runs.service";
import { PayrollPdfService } from "./payroll-pdf.service";
import { PayrollQueueService } from "./payroll-queue.service";
import { PayrollWorkerService } from "./payroll-worker.service";
import { PAYROLL_PDF_QUEUE } from "./payroll.queue";
import { PayslipTokenService } from "./payslip-token.service";
import { PayslipsController } from "./payslips.controller";
import { PayslipsService } from "./payslips.service";

@Module({
  // JwtModule.register({}): PayslipTokenService supplies its own secret
  // (PAYSLIP_URL_SECRET) per call, same reasoning as DocumentsModule.
  imports: [JwtModule.register({}), AuditModule, EmployeesModule, NotificationsModule],
  controllers: [PayrollRulesController, PayrollRunsController, PayslipsController],
  providers: [
    PayrollRulesService,
    PayrollRunsService,
    PayrollPdfService,
    PayrollQueueService,
    PayrollWorkerService,
    PayslipTokenService,
    PayslipsService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (config: ConfigService) =>
        createStorageService(config, "PAYSLIP_STORAGE_PATH", "./storage/payslips", "payslips"),
      inject: [ConfigService],
    },
    {
      provide: PAYROLL_PDF_QUEUE,
      useFactory: (queueService: PayrollQueueService) => queueService.queue,
      inject: [PayrollQueueService],
    },
  ],
})
export class PayrollModule {}
