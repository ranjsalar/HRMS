import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PermissionScope, Prisma, Task } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import type { RequestActor } from "../employees/employees.service";
import { ProjectsService } from "./projects.service";
import type { CreateTaskDto, UpdateTaskDto } from "./dto/task.dto";

/**
 * A Task's visibility follows its parent Project's membership rule
 * (Projects-Module-Plan.md §3 treats Project and Task as one RBAC module,
 * "projects", with the same scope semantics) — `own_department` is
 * "the parent project has a member from a managed department," same as
 * ProjectsService. `self` is the one place Task genuinely differs from
 * Project: VIEW is broader ("a project I'm a member of, OR a task
 * assigned to me directly" — §3's own wording), but WRITE is narrower
 * (assigned-to-me only, status field only) — an employee who is a
 * project member but NOT the assignee can see a task, not touch it.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly projects: ProjectsService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("TasksService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async findMany(requestingUserId: string, scope: PermissionScope): Promise<Task[]> {
    const where = await this.viewScopeWhere(requestingUserId, scope);
    if (where === null) return [];
    return this.tx().task.findMany({ where, orderBy: { createdAt: "desc" } });
  }

  async findOne(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Task | null> {
    const where = await this.viewScopeWhere(requestingUserId, scope);
    if (where === null) return null;
    return this.tx().task.findFirst({ where: { id, ...where } });
  }

  async create(
    dto: CreateTaskDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Task> {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot create tasks");
    }

    // The target project must itself be within the caller's scope — a
    // manager can't create a task in a project outside their managed
    // department just by knowing its id, same "existence isn't revealed
    // outside scope" guarantee as everywhere else.
    const project = await this.projects.findOne(dto.projectId, requestingUserId, scope);
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const task = await this.tx().task.create({
      data: {
        companyId: project.companyId,
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        status: dto.status,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        createdBy: requestingUserId,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "create",
      entity: "Task",
      entityId: task.id,
      ipAddress: actor.ipAddress,
    });

    return task;
  }

  /** General update — title/description/status/assigneeId/dueDate. Never reachable at `self` scope; an employee's only mutation path is updateStatus() below. */
  async update(
    id: string,
    dto: UpdateTaskDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Task | null> {
    if (scope === "self") {
      throw new ForbiddenException(
        "Employees cannot edit task details — only a task's status, via PATCH /tasks/:id/status",
      );
    }
    const where = await this.writeScopeWhere(requestingUserId, scope);
    if (where === null) return null;

    const result = await this.tx().task.updateMany({
      where: { id, ...where },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    if (result.count === 0) return null;

    await this.audit.record({
      userId: actor.userId,
      action: "update",
      entity: "Task",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return this.tx().task.findUnique({ where: { id } });
  }

  /**
   * The employee allow-list the plan calls for: status only, and only on
   * a task assigned to the caller. At `own_department`/`all` scope this
   * is just a narrower-fielded alternative to update() (any task within
   * scope, not assignee-restricted) — the assignee restriction is
   * specifically a `self`-scope rule, not a route-wide one.
   */
  async updateStatus(
    id: string,
    status: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Task | null> {
    let where: Prisma.TaskWhereInput | null;
    if (scope === "self") {
      const own = await this.employees.findOwn(requestingUserId);
      if (!own) return null;
      where = { assigneeId: own.id };
    } else {
      where = await this.writeScopeWhere(requestingUserId, scope);
    }
    if (where === null) return null;

    const result = await this.tx().task.updateMany({
      where: { id, ...where },
      data: { status: status as Task["status"] },
    });
    if (result.count === 0) return null;

    await this.audit.record({
      userId: actor.userId,
      action: "update_status",
      entity: "Task",
      entityId: id,
      ipAddress: actor.ipAddress,
      metadata: { status },
    });

    return this.tx().task.findUnique({ where: { id } });
  }

  /** Real hard delete — the plan's own wording for Task ("delete") differs deliberately from Project's ("archive"); no soft/cancelled state exists on TaskStatus. Never reachable at `self` scope. */
  async remove(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot delete tasks");
    }
    const where = await this.writeScopeWhere(requestingUserId, scope);
    if (where === null) return false;

    const result = await this.tx().task.deleteMany({ where: { id, ...where } });
    if (result.count === 0) return false;

    await this.audit.record({
      userId: actor.userId,
      action: "delete",
      entity: "Task",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return true;
  }

  private async viewScopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.TaskWhereInput | null> {
    if (scope === "all") return {};

    if (scope === "own_department") {
      const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
      if (!managedDepartmentId) return null;
      return {
        project: { members: { some: { employee: { departmentId: managedDepartmentId } } } },
      };
    }

    const own = await this.employees.findOwn(requestingUserId);
    if (!own) return null;
    return {
      OR: [{ project: { members: { some: { employeeId: own.id } } } }, { assigneeId: own.id }],
    };
  }

  /** Same as viewScopeWhere for `all`/`own_department` — write access follows the same project-membership rule. Never called with `self`; every caller rejects that case explicitly before reaching here. */
  private async writeScopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.TaskWhereInput | null> {
    if (scope === "all") return {};

    const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
    if (!managedDepartmentId) return null;
    return { project: { members: { some: { employee: { departmentId: managedDepartmentId } } } } };
  }
}
