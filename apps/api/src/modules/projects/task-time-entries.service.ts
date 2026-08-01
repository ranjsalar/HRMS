import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PermissionScope, Prisma, TaskTimeEntry } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import type { RequestActor } from "../employees/employees.service";
import { TasksService } from "./tasks.service";
import type { LogTaskTimeEntryDto } from "./dto/task-time-entry.dto";

/**
 * Deliberately the smallest surface in this module — logged and listable,
 * nothing more (Projects-Module-Plan.md §4: no aggregate dashboards, no
 * CSV export, no timesheet approval workflow). No update/delete: a time
 * entry is a log, not an editable record — matches the schema (no
 * `updatedAt` column on TaskTimeEntry, unlike every other mutable model
 * in this app).
 *
 * Logging is always self-authored — like AttendanceRecord clock-in, there
 * is no "log time on behalf of someone else" concept, regardless of
 * caller role. It follows Task's own write restriction (assignee-only),
 * not a separate scope tier: the `projects:edit` grant just gates whether
 * the caller can reach the endpoint at all (employee has it by default at
 * `self`, from step 2). Reviewing (listing) IS scope-tiered, following
 * AttendanceService.teamTimesheet's exact pattern — `self` sees only the
 * caller's own entries, `own_department`/`all` scope by the LOGGING
 * employee's department, not by Task/Project membership.
 */
@Injectable()
export class TaskTimeEntriesService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly tasks: TasksService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("TaskTimeEntriesService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async log(
    taskId: string,
    dto: LogTaskTimeEntryDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<TaskTimeEntry> {
    const own = await this.employees.findOwn(requestingUserId);
    if (!own) {
      throw new ForbiddenException("No employee record is linked to this account");
    }

    // The task must be visible to the caller AND assigned to them — same
    // "on tasks assigned to them" restriction as status updates
    // (TasksService.updateStatus at self scope), applied unconditionally
    // here since logging is always self-authored regardless of role.
    const task = await this.tasks.findOne(taskId, requestingUserId, scope);
    if (!task || task.assigneeId !== own.id) {
      throw new NotFoundException("Task not found");
    }

    const entry = await this.tx().taskTimeEntry.create({
      data: {
        companyId: task.companyId,
        taskId,
        employeeId: own.id,
        date: new Date(dto.date),
        hours: dto.hours,
        note: dto.note,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "log_time",
      entity: "Task",
      entityId: taskId,
      ipAddress: actor.ipAddress,
      metadata: { hours: dto.hours },
    });

    return entry;
  }

  async findMany(
    taskId: string,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<TaskTimeEntry[]> {
    // Same "existence isn't revealed outside scope" gate as everywhere
    // else — an out-of-scope task's time entries are a 404 on the task,
    // not an empty (but distinguishable) list.
    const task = await this.tasks.findOne(taskId, requestingUserId, scope);
    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const employeeWhere = await this.scopeWhere(requestingUserId, scope);
    if (employeeWhere === null) return [];

    return this.tx().taskTimeEntry.findMany({
      where: { taskId, employee: employeeWhere },
      orderBy: { date: "desc" },
    });
  }

  private async scopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput | null> {
    if (scope === "all") return {};

    if (scope === "own_department") {
      const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
      return managedDepartmentId ? { departmentId: managedDepartmentId } : null;
    }

    const own = await this.employees.findOwn(requestingUserId);
    return own ? { id: own.id } : null;
  }
}
