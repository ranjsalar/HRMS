import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";
import { STORAGE_SERVICE, type StorageService } from "../../common/storage/storage.interface";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../../i18n/locale.type";
import { NotificationsService } from "../notifications/notifications.service";
import type { PayslipPdfJobData } from "./payroll.queue";
import { renderPayslipPdf } from "./payslip-pdf-renderer";

/**
 * Generates any MISSING payslip PDFs for a run, then finalizes the run
 * once every payslip has one. Idempotent by construction: a payslip that
 * already has a `pdfUrl` is skipped entirely (never re-rendered, never
 * re-saved), so calling this twice for the same run — a BullMQ retry, a
 * duplicate enqueue, or (as the e2e suite proves) a direct second
 * invocation — never creates a second file or corrupts the first, and
 * never re-stamps `finalizedAt`/`finalizedBy` once the run is already
 * finalized.
 *
 * Opens its own tenant-scoped transaction (TenantScopedRunner), same
 * pattern as DocumentsService.downloadByToken (step 5) — this runs from a
 * BullMQ worker, outside any HTTP request, so there is no
 * TenantScopeInterceptor transaction for it to join.
 */
@Injectable()
export class PayrollPdfService {
  private readonly logger = new Logger(PayrollPdfService.name);

  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly scoped: TenantScopedRunner,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async processRun(job: PayslipPdfJobData): Promise<void> {
    await this.scoped.run(job.companyId, (tx) =>
      this.tenantContext.run({ tx, companyId: job.companyId }, async () => {
        const run = await tx.payrollRun.findUnique({ where: { id: job.payrollRunId } });
        if (!run) {
          this.logger.warn(`PayrollRun ${job.payrollRunId} not found — skipping PDF generation`);
          return;
        }
        if (run.status === "draft") {
          this.logger.warn(
            `PayrollRun ${job.payrollRunId} is still draft — refusing to generate PDFs`,
          );
          return;
        }

        const [payslips, company] = await Promise.all([
          tx.payslip.findMany({
            where: { payrollRunId: run.id },
            include: { employee: { select: { fullName: true, userId: true } } },
          }),
          tx.company.findUniqueOrThrow({ where: { id: job.companyId }, select: { name: true } }),
        ]);

        for (const payslip of payslips) {
          if (payslip.pdfUrl) continue; // already generated — idempotent skip

          const buffer = await renderPayslipPdf({
            employeeName: payslip.employee.fullName,
            companyName: company.name,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            currency: payslip.currency,
            gross: payslip.gross.toString(),
            deductions: payslip.deductions.toString(),
            net: payslip.net.toString(),
            breakdown: (payslip.breakdown as Record<string, unknown> | null) ?? null,
          });

          const storageKey = `${job.companyId}/${payslip.id}`;
          await this.storage.save(storageKey, buffer);

          await tx.payslip.update({
            where: { id: payslip.id },
            data: { pdfUrl: storageKey, generatedAt: new Date() },
          });

          // Runs from a BullMQ worker, not an HTTP request — a thrown
          // error here would fail the whole job (BullMQ would retry it),
          // potentially leaving LATER payslips in this same run
          // ungenerated just because one employee's email failed. Caught
          // and logged instead, same "never block the underlying action"
          // reasoning as LeaveRequestsService.notifyDecision. Silently
          // no-ops for a record-only employee (no userId, nothing to
          // email). See DECISIONS.md.
          if (payslip.employee.userId) {
            try {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: payslip.employee.userId },
                select: { email: true, locale: true },
              });
              const locale = (LOCALES as readonly string[]).includes(user.locale)
                ? (user.locale as Locale)
                : DEFAULT_LOCALE;
              const frontendUrl = this.config.getOrThrow<string>("FRONTEND_URL");
              await this.notifications.sendPayslipReadyEmail({
                to: user.email,
                locale,
                employeeName: payslip.employee.fullName,
                periodStart: run.periodStart,
                periodEnd: run.periodEnd,
                payslipsUrl: `${frontendUrl}/payslips`,
              });
            } catch (error) {
              this.logger.error(
                `Failed to send payslip-ready email for Payslip ${payslip.id}`,
                error instanceof Error ? error.stack : error,
              );
            }
          }
        }

        const stillMissing = await tx.payslip.count({
          where: { payrollRunId: run.id, pdfUrl: null },
        });
        if (stillMissing === 0 && run.status !== "finalized") {
          await tx.payrollRun.update({
            where: { id: run.id },
            data: { status: "finalized", finalizedBy: job.actorUserId, finalizedAt: new Date() },
          });
        }
      }),
    );
  }
}
