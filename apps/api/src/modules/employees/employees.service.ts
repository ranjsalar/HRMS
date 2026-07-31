import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Employee, Prisma, PermissionScope } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { decryptField, encryptField } from "../../common/crypto/field-encryption";
import type { Locale } from "../../i18n/locale.type";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { NotificationsService } from "../notifications/notifications.service";
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  UpdateOwnEmployeeDto,
} from "./dto/employee.dto";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

export type EmployeeWithTemporaryPassword = Employee & { temporaryPassword?: string };

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
    private readonly password: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
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
  ): Promise<EmployeeWithTemporaryPassword> {
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

    // `role`/`locale` are only meaningful alongside `email` (they describe
    // the account being provisioned) — validated here as explicit service
    // logic rather than a class-validator ValidateIf chain, same reasoning
    // as the DTO's own comment. A manager (own_department scope) may
    // provision a login, per this build's existing "manager
    // employees:create is an opt-in per-company RBAC grant" precedent
    // (see employee-management.e2e-spec.ts, "Manager cross-department
    // CRUD") — but can never grant the manager role itself. See
    // DECISIONS.md.
    if (dto.role && !dto.email) {
      throw new BadRequestException(
        "`role` can only be set when creating a login (email is required)",
      );
    }
    if (dto.locale && !dto.email) {
      throw new BadRequestException(
        "`locale` can only be set when creating a login (email is required)",
      );
    }
    if (dto.role === "manager" && scope !== "all") {
      throw new ForbiddenException(
        "Only a company_admin can create an account with the manager role",
      );
    }

    let userId: string | undefined;
    let temporaryPassword: string | undefined;
    // Populated only when dto.email is set — used after employee.create()
    // below to send the welcome email last, matching SuperAdminService's
    // ordering (see the comment further down).
    let welcomeEmailParams: { locale: Locale; companyName: string } | undefined;

    if (dto.email) {
      const existing = await this.tx().user.findFirst({
        where: { companyId, email: dto.email },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A user with email "${dto.email}" already exists in this company.`,
        );
      }

      const company = await this.tx().company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, localeDefault: true },
      });
      const locale = dto.locale ?? (company.localeDefault as Locale);

      temporaryPassword = generateTemporaryPassword();
      const passwordHash = await this.password.hash(temporaryPassword);

      const user = await this.tx().user.create({
        data: {
          companyId,
          email: dto.email,
          passwordHash,
          role: dto.role ?? "employee",
          locale,
          mustChangePassword: true,
          twoFaEnabled: false, // mandatory for company_admin/superadmin only — not this endpoint's roles
        },
      });
      userId = user.id;
      welcomeEmailParams = { locale, companyName: company.name };
    }

    const employee = await this.tx().employee.create({
      data: {
        companyId,
        userId,
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
      metadata: dto.email ? { loginCreated: true, role: dto.role ?? "employee" } : undefined,
    });

    // Sent LAST, after the User/Employee rows and audit log already
    // exist, matching SuperAdminService's same ordering: a transient
    // email-delivery failure shouldn't erase an otherwise-successful
    // account creation, and the temp password is still in the API
    // response either way. Same value returned to the caller below and
    // emailed here — never regenerated between the two. See DECISIONS.md.
    if (dto.email && temporaryPassword && welcomeEmailParams) {
      const frontendUrl = this.config.getOrThrow<string>("FRONTEND_URL");
      await this.notifications.sendEmployeeWelcomeEmail({
        to: dto.email,
        locale: welcomeEmailParams.locale,
        employeeName: dto.fullName,
        companyName: welcomeEmailParams.companyName,
        temporaryPassword,
        loginUrl: `${frontendUrl}/login`,
      });
    }

    // Already have the plaintext right here — no need to round-trip decrypt
    // what was just encrypted.
    return {
      ...employee,
      nationalId: dto.nationalId,
      bankAccount: dto.bankAccount ?? null,
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
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

/** Same construction as create-company.ts / SuperAdminService's generateTemporaryPassword — see DECISIONS.md. */
function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}
