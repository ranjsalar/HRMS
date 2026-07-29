import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Employee, Prisma, PermissionScope } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { decryptField, encryptField } from "../../common/crypto/field-encryption";
import { AuditService } from "../audit/audit.service";
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  UpdateOwnEmployeeDto,
} from "./dto/employee.dto";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

// The ONLY fields a self-scoped employee may ever set via update() — every
// other field on UpdateEmployeeDto (salaryBase, nationalId, bankAccount,
// departmentId, branchId, fullName, jobTitle, hireDate, currency, status)
// is HR/admin-controlled. Checked explicitly by name below rather than by
// enumerating dto's own keys, since TS class-field declarations can end up
// present-but-undefined on the instance depending on compiler settings —
// naming each restricted field is unambiguous regardless of that. See
// DECISIONS.md.
const SELF_RESTRICTED_FIELDS = [
  "fullName",
  "nationalId",
  "jobTitle",
  "departmentId",
  "branchId",
  "hireDate",
  "salaryBase",
  "currency",
  "bankAccount",
] as const;

/**
 * Extends the minimal, read-only step-4 foundation (findMany/findOne, the
 * department-scoping proof) with the rest of Employee CRUD. The
 * scope-to-`where`-clause logic from step 4 is now shared by every write
 * too — `own_department` restricts UPDATE/soft-DELETE exactly like it
 * restricts SELECT, at the query layer, not a controller-level `if`
 * (`updateMany` with a scope-narrowed `where` either matches the target
 * row or it doesn't; there's no way to update a row outside scope by
 * knowing its id).
 *
 * nationalId/bankAccount are encrypted here, at the service boundary —
 * every write encrypts before the row reaches Prisma, every read decrypts
 * before the row leaves this service. Nothing above this layer (the
 * controller, the DB) ever sees plaintext except transiently in
 * request/response bodies over TLS.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly audit: AuditService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("EmployeesService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async findMany(requestingUserId: string, scope: PermissionScope): Promise<Employee[]> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return [];
    const employees = await this.tx().employee.findMany({ where, orderBy: { fullName: "asc" } });
    return employees.map((e) => this.decrypt(e));
  }

  async findOne(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Employee | null> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return null;
    const employee = await this.tx().employee.findFirst({ where: { id, ...where } });
    return employee ? this.decrypt(employee) : null;
  }

  async create(
    companyId: string,
    dto: CreateEmployeeDto,
    scope: PermissionScope,
    requestingUserId: string,
    actor: RequestActor,
  ): Promise<Employee> {
    let departmentId = dto.departmentId;

    if (scope === "own_department") {
      const managedDepartmentId = await this.managedDepartmentId(requestingUserId);
      if (!managedDepartmentId) {
        throw new ForbiddenException("No managed department to create employees in");
      }
      if (departmentId && departmentId !== managedDepartmentId) {
        throw new ForbiddenException("Cannot create an employee outside your managed department");
      }
      departmentId = managedDepartmentId;
    } else if (scope === "self") {
      throw new ForbiddenException("Insufficient scope to create employees");
    }

    const employee = await this.tx().employee.create({
      data: {
        companyId,
        fullName: dto.fullName,
        nationalId: encryptField(dto.nationalId),
        jobTitle: dto.jobTitle,
        departmentId,
        branchId: dto.branchId,
        hireDate: new Date(dto.hireDate),
        salaryBase: dto.salaryBase,
        currency: dto.currency,
        bankAccount: dto.bankAccount ? encryptField(dto.bankAccount) : undefined,
        phone: dto.phone,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "create",
      entity: "Employee",
      entityId: employee.id,
      ipAddress: actor.ipAddress,
    });

    // Already have the plaintext right here — no need to round-trip decrypt
    // what was just encrypted.
    return { ...employee, nationalId: dto.nationalId, bankAccount: dto.bankAccount ?? null };
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Employee | null> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return null;

    if (scope === "self") {
      const attempted = SELF_RESTRICTED_FIELDS.filter(
        (field) => (dto as Record<string, unknown>)[field] !== undefined,
      );
      if (attempted.length > 0) {
        throw new ForbiddenException(
          `Employees may only edit their own contact details, not: ${attempted.join(", ")}`,
        );
      }
    }

    if (scope === "own_department" && dto.departmentId) {
      const managedDepartmentId = await this.managedDepartmentId(requestingUserId);
      if (dto.departmentId !== managedDepartmentId) {
        throw new ForbiddenException("Cannot move an employee outside your managed department");
      }
    }

    const data: Prisma.EmployeeUpdateManyMutationInput = { ...dto, hireDate: undefined };
    if (dto.hireDate) data.hireDate = new Date(dto.hireDate);
    if (dto.nationalId) data.nationalId = encryptField(dto.nationalId);
    if (dto.bankAccount) data.bankAccount = encryptField(dto.bankAccount);

    const result = await this.tx().employee.updateMany({ where: { id, ...where }, data });
    if (result.count === 0) return null;

    await this.audit.record({
      userId: actor.userId,
      action: "update",
      entity: "Employee",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return this.findOne(id, requestingUserId, scope);
  }

  /** Status -> terminated. Never a hard delete: payroll/attendance/leave history must survive. */
  async softDelete(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return false;

    const result = await this.tx().employee.updateMany({
      where: { id, ...where },
      data: { status: "terminated" },
    });
    if (result.count === 0) return false;

    await this.audit.record({
      userId: actor.userId,
      action: "soft_delete",
      entity: "Employee",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return true;
  }

  /**
   * `/employees/me` — resolves the caller's OWN Employee row without them
   * ever needing to know their own Employee id, same principle as
   * Attendance/Leave's "never accept a client-supplied id for a
   * self-action." Reuses update()'s scope="self" path (and therefore its
   * allow-list enforcement above) rather than duplicating it — one
   * enforcement point, not two.
   */
  findOwn(requestingUserId: string): Promise<Employee | null> {
    return this.findOneBy({ userId: requestingUserId });
  }

  async updateOwn(
    requestingUserId: string,
    dto: UpdateOwnEmployeeDto,
    actor: RequestActor,
  ): Promise<Employee | null> {
    const own = await this.findOneBy({ userId: requestingUserId });
    if (!own) return null;
    return this.update(own.id, dto, requestingUserId, "self", actor);
  }

  private async findOneBy(where: Prisma.EmployeeWhereInput): Promise<Employee | null> {
    const employee = await this.tx().employee.findFirst({ where });
    return employee ? this.decrypt(employee) : null;
  }

  /** Exposed for DocumentsService — same department-scope rule applies to "does this employee belong to a department this caller may act on". */
  async isVisible(id: string, requestingUserId: string, scope: PermissionScope): Promise<boolean> {
    const where = await this.scopeWhere(requestingUserId, scope);
    if (where === null) return false;
    const employee = await this.tx().employee.findFirst({
      where: { id, ...where },
      select: { id: true },
    });
    return employee !== null;
  }

  private async scopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.EmployeeWhereInput | null> {
    if (scope === "all") return {};

    if (scope === "own_department") {
      const departmentId = await this.managedDepartmentId(requestingUserId);
      return departmentId ? { departmentId } : null;
    }

    return { userId: requestingUserId };
  }

  /** Exposed for AttendanceService — same "which department does this caller manage" resolution, reused to scope AttendanceRecord queries by employee.departmentId. */
  async managedDepartmentId(userId: string): Promise<string | null> {
    const employee = await this.tx().employee.findUnique({
      where: { userId },
      select: { managedDepartmentId: true },
    });
    return employee?.managedDepartmentId ?? null;
  }

  private decrypt(employee: Employee): Employee {
    return {
      ...employee,
      nationalId: decryptField(employee.nationalId),
      bankAccount: employee.bankAccount ? decryptField(employee.bankAccount) : null,
    };
  }
}
