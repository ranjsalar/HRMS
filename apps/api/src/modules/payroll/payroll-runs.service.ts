import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Employee, PayrollRun, PermissionScope, Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { toDateKey } from "../../common/leave/working-days";
import { calculatePayslip, type UnpaidLeavePeriod } from "../../common/payroll/calculate-payslip";
import type { Currency } from "../../common/payroll/money";
import { AuditService } from "../audit/audit.service";
import type { CreatePayrollRunDto } from "./dto/payroll-run.dto";
import { PAYROLL_PDF_QUEUE, PAYROLL_PDF_QUEUE_NAME, type PayslipPdfJobData } from "./payroll.queue";
import { PayrollRulesService } from "./payroll-rules.service";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

function toCurrency(value: string): Currency {
  if (value === "IQD" || value === "USD") return value;
  throw new Error(`Unexpected Employee.currency value: "${value}"`);
}

/**
 * Draft -> processing -> finalized, matching PayrollRunStatus. Only a
 * DRAFT run's payslips can ever be generated or regenerated —
 * `recompute` is the one mutation path, and it explicitly rejects
 * anything past draft. `finalize` moves the run to `processing` and
 * enqueues the PDF-generation job (PayrollPdfService); the job itself is
 * what flips the run to `finalized` once every payslip has a PDF. There
 * is deliberately no endpoint anywhere that edits a Payslip's
 * gross/deductions/net directly — the only way those values change is a
 * full draft recompute, which is unavailable the moment the run leaves
 * draft. See DECISIONS.md.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly rules: PayrollRulesService,
    private readonly audit: AuditService,
    @Inject(PAYROLL_PDF_QUEUE) private readonly pdfQueue: Queue<PayslipPdfJobData>,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("PayrollRunsService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async createDraft(
    companyId: string,
    dto: CreatePayrollRunDto,
    actor: RequestActor,
  ): Promise<PayrollRun> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException("periodEnd must not be before periodStart");
    }

    const run = await this.tx().payrollRun.create({
      data: { companyId, periodStart, periodEnd, status: "draft", createdBy: actor.userId },
    });

    await this.generatePayslips(run, companyId, periodStart, periodEnd);

    await this.audit.record({
      userId: actor.userId,
      action: "create",
      entity: "PayrollRun",
      entityId: run.id,
      ipAddress: actor.ipAddress,
      metadata: { periodStart: dto.periodStart, periodEnd: dto.periodEnd },
    });

    return run;
  }

  /** Draft-only. Wipes and regenerates every payslip in the run from current attendance/leave/rule data — safe because nothing in a draft run has been paid out, reported, or PDF'd yet. */
  async recompute(runId: string, companyId: string, actor: RequestActor): Promise<PayrollRun> {
    const run = await this.requireRun(runId);
    if (run.status !== "draft") {
      throw new ConflictException("Only a draft payroll run can be recomputed");
    }

    await this.tx().payslip.deleteMany({ where: { payrollRunId: run.id } });
    await this.generatePayslips(run, companyId, run.periodStart, run.periodEnd);

    await this.audit.record({
      userId: actor.userId,
      action: "recompute",
      entity: "PayrollRun",
      entityId: run.id,
      ipAddress: actor.ipAddress,
    });

    return run;
  }

  /**
   * Draft-only, one-way. Transitions to `processing` and enqueues the PDF
   * job — the job itself completes the transition to `finalized`.
   *
   * Hard-blocks finalizing against a PayrollRegionRule that isn't marked
   * `verified` (placeholder/unreviewed rates — see the seeded system
   * defaults in database/seeds/payroll-rules.ts and DECISIONS.md) unless
   * the caller is an actual company_admin (`scope === "all"`) AND
   * explicitly passes `acknowledgeUnverifiedRates: true`. This is NOT
   * about blocking dev/testing work — draft creation and recompute are
   * always unrestricted — it's specifically about a real pilot company's
   * first real payroll run never quietly going out on placeholder
   * numbers. The acknowledgment itself is captured in this same audit
   * entry, not silently accepted.
   */
  async finalize(
    runId: string,
    companyId: string,
    scope: PermissionScope,
    options: { acknowledgeUnverifiedRates?: boolean },
    actor: RequestActor,
  ): Promise<PayrollRun> {
    const run = await this.requireRun(runId);
    if (run.status !== "draft") {
      throw new ConflictException("Only a draft payroll run can be finalized");
    }

    const company = await this.tx().company.findUniqueOrThrow({
      where: { id: companyId },
      select: { payrollRegion: true },
    });
    const rule = await this.rules.getRuleRowForCompany(companyId, company.payrollRegion);
    const isAdmin = scope === "all";
    const acknowledgedUnverified = Boolean(options.acknowledgeUnverifiedRates) && isAdmin;

    if (!rule.verified && !acknowledgedUnverified) {
      throw new ConflictException(
        `Cannot finalize: the payroll rule for region "${company.payrollRegion}" is not marked verified (placeholder/unreviewed rates — see DECISIONS.md). ` +
          (isAdmin
            ? "Pass acknowledgeUnverifiedRates:true to finalize anyway."
            : "Only a company admin can acknowledge and override this."),
      );
    }

    const updated = await this.tx().payrollRun.update({
      where: { id: run.id },
      data: { status: "processing" },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "finalize",
      entity: "PayrollRun",
      entityId: run.id,
      ipAddress: actor.ipAddress,
      metadata: { unverifiedRatesAcknowledged: !rule.verified && acknowledgedUnverified },
    });

    await this.pdfQueue.add(
      PAYROLL_PDF_QUEUE_NAME,
      { payrollRunId: run.id, companyId, actorUserId: actor.userId },
      { jobId: run.id }, // one job per run, ever — a duplicate finalize attempt (blocked above by the draft-only guard) can't double-enqueue
    );

    return updated;
  }

  findMany(companyId: string): Promise<PayrollRun[]> {
    return this.tx().payrollRun.findMany({
      where: { companyId },
      orderBy: { periodStart: "desc" },
    });
  }

  findOne(id: string): Promise<PayrollRun | null> {
    return this.tx().payrollRun.findUnique({ where: { id } });
  }

  private async requireRun(runId: string): Promise<PayrollRun> {
    const run = await this.tx().payrollRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    return run;
  }

  /**
   * One Payslip per active/on_leave employee — terminated employees are
   * excluded (see DECISIONS.md for the inclusion-criteria call: on_leave
   * IS included, since the unpaid-leave deduction logic already handles
   * their days off correctly; excluding them would silently produce no
   * payslip at all for a real employee mid-leave).
   */
  private async generatePayslips(
    run: PayrollRun,
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const company = await this.tx().company.findUniqueOrThrow({
      where: { id: companyId },
      select: { payrollRegion: true, weekendDays: true },
    });

    const employees = await this.tx().employee.findMany({
      where: { companyId, status: { in: ["active", "on_leave"] } },
    });
    if (employees.length === 0) return;

    const rule = await this.rules.getRuleForCompany(companyId, company.payrollRegion);

    const holidays = await this.tx().holiday.findMany({
      where: {
        date: { gte: periodStart, lte: periodEnd },
        OR: [{ companyId: null }, { companyId }],
      },
      select: { date: true },
    });
    const holidayDateKeys = new Set(holidays.map((h) => toDateKey(h.date)));

    for (const employee of employees) {
      await this.tx().payslip.create({
        data: await this.buildPayslipData(
          employee,
          run,
          companyId,
          periodStart,
          periodEnd,
          rule,
          company.weekendDays,
          holidayDateKeys,
        ),
      });
    }
  }

  private async buildPayslipData(
    employee: Employee,
    run: PayrollRun,
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
    rule: Awaited<ReturnType<PayrollRulesService["getRuleForCompany"]>>,
    weekendDays: readonly number[],
    holidayDateKeys: ReadonlySet<string>,
  ): Promise<Prisma.PayslipCreateInput> {
    const attendanceRecords = await this.tx().attendanceRecord.findMany({
      where: { employeeId: employee.id, clockIn: { gte: periodStart, lte: periodEnd } },
      select: { clockIn: true, clockOut: true },
    });

    // Approved leave under a LeaveType configured as unpaid, overlapping
    // this period — clamped to the period's bounds, since a leave request
    // can span outside it (see calculate-payslip.ts / DECISIONS.md for why
    // this is a fresh countWorkingDays call, not the LeaveRequest's own
    // stored `workingDays` snapshot, which covers its whole original
    // range, not just the slice inside this specific payroll period).
    const unpaidLeaveRequests = await this.tx().leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: "approved",
        leaveType: { paid: false },
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
      select: { startDate: true, endDate: true },
    });
    const unpaidLeavePeriods: UnpaidLeavePeriod[] = unpaidLeaveRequests.map((request) => ({
      startDate: request.startDate < periodStart ? periodStart : request.startDate,
      endDate: request.endDate > periodEnd ? periodEnd : request.endDate,
    }));

    const result = calculatePayslip({
      salaryBase: employee.salaryBase,
      currency: toCurrency(employee.currency),
      rule,
      attendanceRecords,
      unpaidLeavePeriods,
      weekendDays,
      holidayDateKeys,
    });

    return {
      company: { connect: { id: companyId } },
      employee: { connect: { id: employee.id } },
      payrollRun: { connect: { id: run.id } },
      gross: result.gross,
      deductions: result.deductions,
      net: result.net,
      currency: employee.currency,
      breakdown: result.breakdown as unknown as Prisma.InputJsonObject,
    };
  }
}
