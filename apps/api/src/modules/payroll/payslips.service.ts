import { ConflictException, Inject, ForbiddenException, Injectable } from "@nestjs/common";
import type { Payslip, PermissionScope, Prisma } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";
import { STORAGE_SERVICE, type StorageService } from "../../common/storage/storage.interface";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import { PayslipTokenService } from "./payslip-token.service";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

export interface SignedPayslipUrlResult {
  url: string;
  expiresAt: Date;
}

export interface PayslipDownloadResult {
  buffer: Buffer;
  filename: string;
}

export type PayslipWithPeriod = Payslip & {
  payrollRun: { periodStart: Date; periodEnd: Date };
};

/**
 * Payslip access is department-scope-AWARE but admin-only by the default
 * RBAC seed (no manager grant exists for the "payroll" module — see
 * DECISIONS.md for that judgment call). `isVisible` is the exact same
 * EmployeesService check Documents/Attendance/Leave already reuse, so if
 * a company_admin ever explicitly grants a manager payroll:view at
 * own_department scope via the RBAC CRUD module, department-scoping just
 * works — nothing here hardcodes "managers never see payroll."
 */
@Injectable()
export class PayslipsService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly scoped: TenantScopedRunner,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly employees: EmployeesService,
    private readonly payslipTokens: PayslipTokenService,
    private readonly audit: AuditService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("PayslipsService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  /**
   * Only FINALIZED-run payslips — a draft run's numbers can still change
   * via recompute, so nothing self-service should ever see it. Includes
   * the parent PayrollRun's period dates: a Payslip row itself has no
   * period of its own (that's the RUN's concept), and there's no other
   * self-service endpoint an employee could use to look it up — payroll
   * run reads are admin-only (PayrollRunsController is gated on
   * payroll:edit, no self-scoped grant exists). Selecting just the two
   * date fields, not the whole run, keeps this from leaking anything
   * admin-only (status, createdBy, etc).
   */
  async myPayslips(userId: string): Promise<PayslipWithPeriod[]> {
    const employee = await this.tx().employee.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!employee) return [];

    return this.tx().payslip.findMany({
      where: { employeeId: employee.id, payrollRun: { status: "finalized" } },
      include: { payrollRun: { select: { periodStart: true, periodEnd: true } } },
      orderBy: { payrollRun: { periodStart: "desc" } },
    });
  }

  /** Admin/team review view — deliberately NOT restricted to finalized runs, since reviewing draft payslips before finalizing is the whole point of the draft state. */
  async listForRun(
    runId: string,
    callerId: string,
    scope: PermissionScope,
    employeeId?: string,
  ): Promise<Payslip[]> {
    if (scope === "self") {
      throw new ForbiddenException("Insufficient scope to view company payroll data");
    }

    if (employeeId) {
      const visible = await this.employees.isVisible(employeeId, callerId, scope);
      if (!visible) return [];
      return this.tx().payslip.findMany({ where: { payrollRunId: runId, employeeId } });
    }

    const employeeWhere = await this.scopeWhere(callerId, scope);
    if (employeeWhere === null) return [];
    return this.tx().payslip.findMany({
      where: { payrollRunId: runId, employee: employeeWhere },
    });
  }

  async createSignedUrl(
    payslipId: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<SignedPayslipUrlResult | null> {
    const payslip = await this.tx().payslip.findUnique({ where: { id: payslipId } });
    if (!payslip) return null;

    const visible = await this.employees.isVisible(payslip.employeeId, requestingUserId, scope);
    if (!visible) return null;

    if (!payslip.pdfUrl) {
      throw new ConflictException(
        "This payslip's PDF hasn't been generated yet — the payroll run may still be processing",
      );
    }

    const { token, expiresAt } = this.payslipTokens.issue({
      payslipId: payslip.id,
      companyId: payslip.companyId,
    });

    await this.audit.record({
      userId: actor.userId,
      action: "generate_signed_url",
      entity: "Payslip",
      entityId: payslipId,
      ipAddress: actor.ipAddress,
    });

    return { url: `/payslips/download?token=${token}`, expiresAt };
  }

  /**
   * Public/token-gated, same TenantScopedRunner + manually-populated
   * TenantContextStorage pattern as DocumentsService.downloadByToken
   * (step 5) — no request.user here, so no interceptor transaction to
   * join. Audit entry has userId: null for the same documented reason as
   * Documents: authorization already happened at createSignedUrl time
   * (real userId, logged); the actual fetch is only provable as "someone
   * holding a valid token."
   */
  async downloadByToken(token: string): Promise<PayslipDownloadResult | null> {
    const payload = this.payslipTokens.verify(token);

    return this.scoped.run(payload.companyId, (tx) =>
      this.tenantContext.run({ tx, companyId: payload.companyId }, async () => {
        const payslip = await tx.payslip.findUnique({ where: { id: payload.payslipId } });
        if (!payslip?.pdfUrl) return null;

        const buffer = await this.storage.read(payslip.pdfUrl);

        await this.audit.record({
          userId: null,
          action: "download",
          entity: "Payslip",
          entityId: payslip.id,
        });

        return { buffer, filename: `payslip-${payslip.id}.pdf` };
      }),
    );
  }

  private async scopeWhere(
    userId: string,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput | null> {
    if (scope === "all") return {};
    const departmentId = await this.employees.managedDepartmentId(userId);
    return departmentId ? { departmentId } : null;
  }
}
