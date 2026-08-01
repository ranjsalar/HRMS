import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PermissionScope, Prisma, Project } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import type { RequestActor } from "../employees/employees.service";
import type { AddProjectMemberDto, CreateProjectDto, UpdateProjectDto } from "./dto/project.dto";

const MEMBER_INCLUDE = {
  members: {
    include: { employee: { select: { id: true, fullName: true, departmentId: true } } },
  },
} satisfies Prisma.ProjectInclude;

type ProjectWithMembers = Prisma.ProjectGetPayload<{ include: typeof MEMBER_INCLUDE }>;

/**
 * `own_department` here means "at least one ProjectMember from a managed
 * department" (Projects-Module-Plan.md §3) — a project has no home
 * department of its own (deliberately: projects are commonly
 * cross-departmental), so this scope is resolved entirely through
 * membership, unlike EmployeesService.scopeWhere's direct
 * `{ departmentId }` filter.
 *
 * Write actions (update/archive/add-member/remove-member) reuse the exact
 * same scopeWhere as view — a manager can only act on a project already
 * visible to them. `self` scope is rejected outright for every write:
 * employees never create or manage projects (Projects-Module-Plan.md §3),
 * only their own tasks (a later step).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("ProjectsService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async findMany(requestingUserId: string, scope: PermissionScope): Promise<Project[]> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return [];
    return this.tx().project.findMany({ where, orderBy: { createdAt: "desc" } });
  }

  async findOne(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<ProjectWithMembers | null> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return null;
    return this.tx().project.findFirst({ where: { id, ...where }, include: MEMBER_INCLUDE });
  }

  async create(
    companyId: string,
    dto: CreateProjectDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Project> {
    // Belt-and-suspenders, same reasoning as update()/archive() rejecting
    // self scope: nothing currently grants an employee projects:create at
    // any scope, but RBAC grants are configurable per-company (see
    // /rbac/permissions) and nothing stops a future misconfiguration from
    // creating a nonsensical "employee, self" row. The plan is explicit
    // employees never create projects — enforce that here too, not just
    // by relying on the default matrix never granting it. See
    // DECISIONS.md.
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot create projects");
    }

    const project = await this.tx().project.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        createdBy: requestingUserId,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "create",
      entity: "Project",
      entityId: project.id,
      ipAddress: actor.ipAddress,
    });

    return project;
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Project | null> {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot edit projects");
    }
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return null;

    const result = await this.tx().project.updateMany({
      where: { id, ...where },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
    if (result.count === 0) return null;

    await this.audit.record({
      userId: actor.userId,
      action: "update",
      entity: "Project",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return this.tx().project.findUnique({ where: { id } });
  }

  /** Soft "archive" — status -> cancelled. Never a hard delete, matching every other module's history-preservation convention. */
  async archive(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot archive projects");
    }
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return false;

    const result = await this.tx().project.updateMany({
      where: { id, ...where },
      data: { status: "cancelled" },
    });
    if (result.count === 0) return false;

    await this.audit.record({
      userId: actor.userId,
      action: "archive",
      entity: "Project",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return true;
  }

  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ) {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot manage project membership");
    }
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) throw new NotFoundException("Project not found");

    const project = await this.tx().project.findFirst({ where: { id: projectId, ...where } });
    if (!project) throw new NotFoundException("Project not found");

    // Tenant-scoped by construction — this query runs inside the same
    // RLS-scoped transaction, so an employeeId from another company
    // simply won't be found, the same "existence isn't revealed across
    // tenants" guarantee every other cross-entity reference in this app
    // relies on.
    const employee = await this.tx().employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException("Employee not found");

    try {
      const member = await this.tx().projectMember.create({
        data: { companyId: project.companyId, projectId, employeeId: dto.employeeId },
        include: { employee: { select: { id: true, fullName: true, departmentId: true } } },
      });

      await this.audit.record({
        userId: actor.userId,
        action: "add_member",
        entity: "Project",
        entityId: projectId,
        ipAddress: actor.ipAddress,
        metadata: { employeeId: dto.employeeId },
      });

      return member;
    } catch (error) {
      // Unique constraint on [projectId, employeeId] — same employee added twice.
      if (isUniqueConstraintError(error)) {
        throw new ConflictException("This employee is already a member of this project");
      }
      throw error;
    }
  }

  async removeMember(
    projectId: string,
    employeeId: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    if (scope === "self") {
      throw new ForbiddenException("Employees cannot manage project membership");
    }
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return false;

    const project = await this.tx().project.findFirst({ where: { id: projectId, ...where } });
    if (!project) return false;

    const result = await this.tx().projectMember.deleteMany({ where: { projectId, employeeId } });
    if (result.count === 0) return false;

    await this.audit.record({
      userId: actor.userId,
      action: "remove_member",
      entity: "Project",
      entityId: projectId,
      ipAddress: actor.ipAddress,
      metadata: { employeeId },
    });

    return true;
  }

  private async scopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.ProjectWhereInput | null> {
    if (scope === "all") return {};

    if (scope === "own_department") {
      const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
      if (!managedDepartmentId) return null;
      return { members: { some: { employee: { departmentId: managedDepartmentId } } } };
    }

    const own = await this.employees.findOwn(requestingUserId);
    if (!own) return null;
    return { members: { some: { employeeId: own.id } } };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
