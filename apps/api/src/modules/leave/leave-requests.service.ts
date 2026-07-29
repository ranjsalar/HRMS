import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  PermissionScope,
  Prisma,
} from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { countWorkingDays, prorateAnnualDays, toDateKey } from "../../common/leave/working-days";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import type { SubmitLeaveRequestDto } from "./dto/leave-request.dto";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

type LeaveRequestWithEmployee = LeaveRequest & { employee: { userId: string | null } };

/**
 * The money-adjacent core of the module. Balance is only ever touched at
 * approval (deduct) and at a subsequent reject-of-an-approved-request
 * (restore) — a request that lived and died entirely within "pending"
 * (rejected while pending, or cancelled) never touches a LeaveBalance row,
 * and the code paths below are structured so that's true by construction,
 * not by remembering to skip a step. See DECISIONS.md for the balance
 * design decisions (proration formula, year attribution, negative-balance
 * policy).
 */
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("LeaveRequestsService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  /** Same principle as Attendance clock-in (step 6): a leave request is always submitted/cancelled for the CALLER's own Employee row, never a client-supplied employeeId. */
  private async ownEmployee(userId: string): Promise<{ id: string; hireDate: Date }> {
    const employee = await this.tx().employee.findUnique({
      where: { userId },
      select: { id: true, hireDate: true },
    });
    if (!employee) {
      throw new NotFoundException("No employee record is linked to this account");
    }
    return employee;
  }

  /**
   * Same working-days calculation `approve()` uses, exposed standalone so
   * the frontend can show the employee exactly what a request would
   * deduct BEFORE they submit it — see DECISIONS.md (step 9 planning:
   * "a small backend endpoint wrapping the existing countWorkingDays
   * logic," approved over a second frontend implementation of the same
   * rule). Doesn't touch a balance or create anything; pure read.
   */
  async previewWorkingDays(companyId: string, startDate: string, endDate: string): Promise<number> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      throw new BadRequestException("endDate must not be before startDate");
    }

    const company = await this.tx().company.findUniqueOrThrow({
      where: { id: companyId },
      select: { weekendDays: true },
    });
    const holidayDateKeys = await this.holidayDateKeysFor(companyId, start, end);
    return countWorkingDays(start, end, company.weekendDays, holidayDateKeys);
  }

  async submit(
    userId: string,
    companyId: string,
    dto: SubmitLeaveRequestDto,
    actor: RequestActor,
  ): Promise<LeaveRequest> {
    const employee = await this.ownEmployee(userId);

    const leaveType = await this.tx().leaveType.findFirst({
      where: { id: dto.leaveTypeId, active: true },
    });
    if (!leaveType) {
      throw new NotFoundException("Leave type not found");
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException("endDate must not be before startDate");
    }

    // Overlap check spans ALL of the employee's leave types, not just this
    // one — you can't be simultaneously on annual leave and sick leave.
    const overlapping = await this.tx().leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ["pending", "approved"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        "This request overlaps an existing pending or approved leave request",
      );
    }

    const request = await this.tx().leaveRequest.create({
      data: {
        companyId,
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        reason: dto.reason,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "submit",
      entity: "LeaveRequest",
      entityId: request.id,
      ipAddress: actor.ipAddress,
    });

    return request;
  }

  async cancel(userId: string, requestId: string, actor: RequestActor): Promise<LeaveRequest> {
    const request = await this.tx().leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { userId: true } } },
    });
    // Same existence-hiding pattern as Employee CRUD: doesn't exist and
    // exists-but-not-yours look identical from the outside.
    if (!request || request.employee.userId !== userId) {
      throw new NotFoundException("Leave request not found");
    }
    if (request.status !== "pending") {
      throw new ConflictException(
        "Only a pending request can be cancelled — once approved, ask a manager/admin to reject it",
      );
    }

    const updated = await this.tx().leaveRequest.update({
      where: { id: requestId },
      data: { status: "cancelled" },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "cancel",
      entity: "LeaveRequest",
      entityId: requestId,
      ipAddress: actor.ipAddress,
    });

    return updated;
  }

  async approve(
    callerId: string,
    companyId: string,
    scope: PermissionScope,
    requestId: string,
    options: { force?: boolean },
    actor: RequestActor,
  ): Promise<LeaveRequest> {
    const request = await this.loadForDecision(requestId, callerId, scope);
    if (request.status !== "pending") {
      throw new ConflictException("Only a pending request can be approved");
    }

    const workingDays = await this.previewWorkingDays(
      companyId,
      toDateKey(request.startDate),
      toDateKey(request.endDate),
    );

    const year = request.startDate.getUTCFullYear();
    const balance = await this.getOrCreateBalance(
      request.employeeId,
      request.leaveTypeId,
      year,
      companyId,
    );

    const isAdmin = scope === "all";
    const remaining = Number(balance.balance);
    const wouldGoNegative = remaining - workingDays < 0;
    if (wouldGoNegative && !(options.force && isAdmin)) {
      throw new ConflictException(
        `Insufficient leave balance: requesting ${workingDays} working day(s), ${remaining} remaining. ` +
          (isAdmin
            ? "Pass force:true to approve anyway."
            : "Only a company admin can override this."),
      );
    }

    await this.tx().leaveBalance.update({
      where: { id: balance.id },
      data: { balance: { decrement: workingDays } },
    });

    const updated = await this.tx().leaveRequest.update({
      where: { id: requestId },
      data: { status: "approved", approvedBy: callerId, workingDays },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "approve",
      entity: "LeaveRequest",
      entityId: requestId,
      ipAddress: actor.ipAddress,
      metadata: { workingDays, forced: wouldGoNegative && Boolean(options.force) },
    });

    return updated;
  }

  async reject(
    callerId: string,
    scope: PermissionScope,
    requestId: string,
    actor: RequestActor,
  ): Promise<LeaveRequest> {
    const request = await this.loadForDecision(requestId, callerId, scope);

    if (request.status === "pending") {
      // Never touched a balance — nothing to restore.
      const updated = await this.tx().leaveRequest.update({
        where: { id: requestId },
        data: { status: "rejected", rejectedBy: callerId },
      });
      await this.audit.record({
        userId: actor.userId,
        action: "reject",
        entity: "LeaveRequest",
        entityId: requestId,
        ipAddress: actor.ipAddress,
        metadata: { restored: false },
      });
      return updated;
    }

    if (request.status === "approved") {
      // Revoking a prior approval — restore EXACTLY the stored
      // `workingDays` snapshot, never a value recomputed against today's
      // Holiday table (which may have changed since approval).
      const year = request.startDate.getUTCFullYear();
      const balance = await this.tx().leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });
      if (balance && request.workingDays !== null) {
        await this.tx().leaveBalance.update({
          where: { id: balance.id },
          data: { balance: { increment: request.workingDays } },
        });
      }

      const updated = await this.tx().leaveRequest.update({
        where: { id: requestId },
        data: { status: "rejected", rejectedBy: callerId },
      });
      await this.audit.record({
        userId: actor.userId,
        action: "reject",
        entity: "LeaveRequest",
        entityId: requestId,
        ipAddress: actor.ipAddress,
        metadata: { restored: true, workingDays: request.workingDays },
      });
      return updated;
    }

    throw new ConflictException("Only a pending or approved request can be rejected");
  }

  async myRequests(userId: string): Promise<LeaveRequest[]> {
    const employee = await this.ownEmployee(userId);
    return this.tx().leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Excludes the CALLER's own request(s) unconditionally — not just from
   * the approve/reject actions (loadForDecision already blocks those),
   * but from this list too. A caller can never act on their own request
   * (see loadForDecision below), so surfacing it in what's meant to be a
   * review queue would only ever be confusing/misleading, never useful —
   * added in step 9.6 once the frontend's approvals screen made it
   * concretely observable that this endpoint returned it. See
   * DECISIONS.md.
   */
  async teamRequests(
    callerId: string,
    scope: PermissionScope,
    employeeId?: string,
    status?: LeaveStatus,
  ): Promise<LeaveRequest[]> {
    if (scope === "self") {
      throw new ForbiddenException("Insufficient scope to view team leave requests");
    }

    if (employeeId) {
      const visible = await this.employees.isVisible(employeeId, callerId, scope);
      if (!visible) return [];
      return this.tx().leaveRequest.findMany({
        where: {
          employeeId,
          employee: { userId: { not: callerId } },
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
    }

    const employeeWhere = await this.scopeWhere(callerId, scope);
    if (employeeWhere === null) return [];

    return this.tx().leaveRequest.findMany({
      where: {
        employee: { ...employeeWhere, userId: { not: callerId } },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async myBalances(userId: string, year: number): Promise<LeaveBalance[]> {
    const employee = await this.ownEmployee(userId);
    return this.tx().leaveBalance.findMany({
      where: { employeeId: employee.id, year },
      orderBy: { leaveTypeId: "asc" },
    });
  }

  /**
   * `/leave-balances` (step 9.6) — the manager/admin-facing counterpart to
   * `myBalances`, needed so an approver reviewing a pending request can
   * see the SAME balance context the employee saw when submitting it, not
   * approve blind. Same `isVisible` department-scope check every other
   * team-facing read in this app uses; a lazily-uncreated balance (never
   * approved before) legitimately returns an empty array, same as
   * `myBalances` would for that employee.
   */
  async teamBalances(
    callerId: string,
    scope: PermissionScope,
    employeeId: string,
    year: number,
  ): Promise<LeaveBalance[]> {
    const visible = await this.employees.isVisible(employeeId, callerId, scope);
    if (!visible) return [];
    return this.tx().leaveBalance.findMany({
      where: { employeeId, year },
      orderBy: { leaveTypeId: "asc" },
    });
  }

  /**
   * Shared load path for approve/reject: resolves the target request,
   * enforces "you cannot decide your own request" EXPLICITLY (never
   * inferred from scope — a manager who happens to manage their own
   * department would otherwise pass the visibility check), then the same
   * department-scope visibility check Employee/Attendance writes reuse.
   */
  private async loadForDecision(
    requestId: string,
    callerId: string,
    scope: PermissionScope,
  ): Promise<LeaveRequestWithEmployee> {
    const request = await this.tx().leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { userId: true } } },
    });
    if (!request) {
      throw new NotFoundException("Leave request not found");
    }

    if (request.employee.userId === callerId) {
      throw new ForbiddenException("You cannot approve or reject your own leave request");
    }

    const visible = await this.employees.isVisible(request.employeeId, callerId, scope);
    if (!visible) {
      throw new NotFoundException("Leave request not found");
    }

    return request;
  }

  private async scopeWhere(
    userId: string,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput | null> {
    if (scope === "all") return {};
    const departmentId = await this.employees.managedDepartmentId(userId);
    return departmentId ? { departmentId } : null;
  }

  private async holidayDateKeysFor(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<Set<string>> {
    const holidays = await this.tx().holiday.findMany({
      where: { date: { gte: start, lte: end }, OR: [{ companyId: null }, { companyId }] },
      select: { date: true },
    });
    return new Set(holidays.map((h) => toDateKey(h.date)));
  }

  /**
   * Lazily creates the (employee, leaveType, year) LeaveBalance row on
   * first need, prorated by hire date if this is the employee's hire
   * year — see `prorateAnnualDays` and DECISIONS.md. Every later year is
   * simply the full `daysPerYear` (no year-over-year carryover logic in
   * v1 — see DECISIONS.md for that limitation).
   */
  private async getOrCreateBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    companyId: string,
  ): Promise<LeaveBalance> {
    const existing = await this.tx().leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    });
    if (existing) return existing;

    const [employee, leaveType] = await Promise.all([
      this.tx().employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: { hireDate: true },
      }),
      this.tx().leaveType.findUniqueOrThrow({
        where: { id: leaveTypeId },
        select: { daysPerYear: true },
      }),
    ]);

    const proratedDays = prorateAnnualDays(leaveType.daysPerYear, employee.hireDate, year);

    return this.tx().leaveBalance.create({
      data: { companyId, employeeId, leaveTypeId, year, balance: proratedDays },
    });
  }
}
