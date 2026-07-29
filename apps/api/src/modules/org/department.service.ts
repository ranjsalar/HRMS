import { Injectable } from "@nestjs/common";
import type { Department } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { CreateDepartmentDto, UpdateDepartmentDto } from "./dto/department.dto";

export interface OrgChartNode {
  id: string;
  name: string;
  managerEmployeeId: string | null;
  managerName: string | null;
  employeeCount: number;
  children: OrgChartNode[];
}

/**
 * Tenant-scoped only (via TenantContextStorage's tx, same as everywhere
 * else) — no department-level scoping the way Employee CRUD has, since
 * managing the org structure itself is a company_admin concern in the
 * default permission matrix (manager only gets org:view, scope "all", no
 * org:create/edit/delete at all — see default-role-permissions.ts).
 *
 * DELETE is a real hard delete, unlike Employee's soft-delete: Department
 * has no status field, and the schema's own FK design (Employee.departmentId
 * and Department.parentDepartmentId are both ON DELETE SET NULL) already
 * treats department deletion as "orphan what pointed here," not something
 * requiring a tombstone the way employee history does.
 */
@Injectable()
export class DepartmentService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("DepartmentService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  findMany(): Promise<Department[]> {
    return this.tx().department.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string): Promise<Department | null> {
    return this.tx().department.findUnique({ where: { id } });
  }

  create(companyId: string, dto: CreateDepartmentDto): Promise<Department> {
    return this.tx().department.create({
      data: { companyId, name: dto.name, parentDepartmentId: dto.parentDepartmentId },
    });
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department | null> {
    const result = await this.tx().department.updateMany({
      where: { id },
      data: dto,
    });
    if (result.count === 0) return null;
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.tx().department.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async orgChart(): Promise<OrgChartNode[]> {
    const [departments, employees] = await Promise.all([
      this.tx().department.findMany(),
      this.tx().employee.findMany({
        where: { status: { not: "terminated" } },
        select: { id: true, fullName: true, departmentId: true, managedDepartmentId: true },
      }),
    ]);

    const employeeCountByDept = new Map<string, number>();
    const managerByDept = new Map<string, { id: string; fullName: string }>();
    for (const employee of employees) {
      if (employee.departmentId) {
        employeeCountByDept.set(
          employee.departmentId,
          (employeeCountByDept.get(employee.departmentId) ?? 0) + 1,
        );
      }
      if (employee.managedDepartmentId) {
        managerByDept.set(employee.managedDepartmentId, {
          id: employee.id,
          fullName: employee.fullName,
        });
      }
    }

    const nodeById = new Map<string, OrgChartNode>();
    for (const dept of departments) {
      const manager = managerByDept.get(dept.id);
      nodeById.set(dept.id, {
        id: dept.id,
        name: dept.name,
        managerEmployeeId: manager?.id ?? null,
        managerName: manager?.fullName ?? null,
        employeeCount: employeeCountByDept.get(dept.id) ?? 0,
        children: [],
      });
    }

    const roots: OrgChartNode[] = [];
    for (const dept of departments) {
      const node = nodeById.get(dept.id)!;
      if (dept.parentDepartmentId && nodeById.has(dept.parentDepartmentId)) {
        nodeById.get(dept.parentDepartmentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
