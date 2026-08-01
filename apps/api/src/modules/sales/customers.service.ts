import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Customer, CustomerContact, PermissionScope, Prisma } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import type { RequestActor } from "../employees/employees.service";
import type { CreateCustomerDto, UpdateCustomerDto } from "./dto/customer.dto";
import type {
  CreateCustomerContactDto,
  UpdateCustomerContactDto,
} from "./dto/customer-contact.dto";

const CONTACTS_INCLUDE = {
  contacts: { orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }] },
} satisfies Prisma.CustomerInclude;

type CustomerWithContacts = Prisma.CustomerGetPayload<{ include: typeof CONTACTS_INCLUDE }>;

/**
 * READ is deliberately company-wide; WRITE is owner-scoped. This is the
 * one genuinely unusual thing about this service, and it is a confirmed
 * product decision (Sales-CRM-Module-Plan.md §3), not an oversight:
 *
 * The most expensive real failure in a small sales team is two reps
 * unknowingly working the same customer — duplicate records, duplicate
 * outreach, occasionally two competing quotes reaching the same buyer.
 * Owner-scoping the customer LIST causes that directly. The genuinely
 * sensitive commercial data (deal amount, stage, quoted prices) lives on
 * Deal/SalesOrder, which ARE owner-scoped. So a rep can see THAT a
 * customer exists and who owns it — exactly what prevents the collision —
 * without seeing anyone else's numbers.
 *
 * What keeps that safe is step 2's decision that `employee` gets NO sales
 * grant by default: a company opts a specific person in, per company, via
 * /rbac/permissions. RbacGuard has already rejected anyone without a
 * sales:view grant before this service is reached.
 *
 * Note the direction: the granted scope is the NARROW one, and this
 * service widens deliberately for reads. A Sales entity added later
 * without special handling therefore defaults to owner-scoped
 * (fail-closed), never company-wide. See DECISIONS.md, step 2.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("CustomersService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  // ── Reads: company-wide by design (see the class comment) ───────────

  findMany(): Promise<Customer[]> {
    return this.tx().customer.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string): Promise<CustomerWithContacts | null> {
    return this.tx().customer.findFirst({ where: { id }, include: CONTACTS_INCLUDE });
  }

  // ── Writes: owner-scoped ────────────────────────────────────────────

  async create(
    companyId: string,
    dto: CreateCustomerDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Customer> {
    const ownerId = await this.resolveOwnerForWrite(dto.ownerId, requestingUserId, scope);

    const customer = await this.tx().customer.create({
      data: {
        companyId,
        name: dto.name,
        type: dto.type,
        ownerId,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        notes: dto.notes,
        createdBy: requestingUserId,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "create",
      entity: "Customer",
      entityId: customer.id,
      ipAddress: actor.ipAddress,
    });

    return customer;
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Customer | null> {
    const where = await this.writeScopeWhere(requestingUserId, scope);
    if (where === null) return null;

    const existing = await this.tx().customer.findFirst({ where: { id, ...where } });
    if (!existing) return null;

    // Reassigning an owner is itself an owner-scoped action — a
    // self-scoped rep can't hand their customer to someone else, and a
    // manager can't push one outside their managed department.
    const ownerId =
      dto.ownerId === undefined
        ? undefined
        : await this.resolveOwnerForWrite(dto.ownerId, requestingUserId, scope);

    const updated = await this.tx().customer.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        ownerId,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        notes: dto.notes,
      },
    });

    await this.audit.record({
      userId: actor.userId,
      action: "update",
      entity: "Customer",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return updated;
  }

  /**
   * Hard delete, guarded. `Deal.customerId`, `SalesOrder.customerId`, and
   * `CustomerContact.customerId` are all `ON DELETE RESTRICT` — so without
   * this check the FK violation surfaces as an unhandled 500, exactly the
   * bug the Projects step-7 audit found on `DELETE /tasks/:id`. Designed
   * in here from the start rather than rediscovered later.
   *
   * Blocks rather than cascades, matching the founder's explicit decision
   * on the analogous Task case: preserve history over silent data loss,
   * and make the smallest safe change. Cascading a customer's own contacts
   * (which are arguably just its child records, unlike deals and orders
   * which are real business history) is a plausible later refinement — not
   * invented now, since the plan never asked for it.
   */
  async remove(
    id: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    const where = await this.writeScopeWhere(requestingUserId, scope);
    if (where === null) return false;

    const existing = await this.tx().customer.findFirst({
      where: { id, ...where },
      select: { id: true },
    });
    if (!existing) return false;

    const [dealCount, orderCount, contactCount] = await Promise.all([
      this.tx().deal.count({ where: { customerId: id } }),
      this.tx().salesOrder.count({ where: { customerId: id } }),
      this.tx().customerContact.count({ where: { customerId: id } }),
    ]);

    const blockers: string[] = [];
    if (dealCount > 0) blockers.push(`${dealCount} deal(s)`);
    if (orderCount > 0) blockers.push(`${orderCount} sales order(s)`);
    if (contactCount > 0) blockers.push(`${contactCount} contact(s)`);

    if (blockers.length > 0) {
      throw new ConflictException(
        `This customer cannot be deleted because it still has ${blockers.join(", ")}. Remove or reassign them first.`,
      );
    }

    await this.tx().customer.delete({ where: { id } });

    await this.audit.record({
      userId: actor.userId,
      action: "delete",
      entity: "Customer",
      entityId: id,
      ipAddress: actor.ipAddress,
    });

    return true;
  }

  // ── Contacts — write access follows the parent customer's ───────────

  async addContact(
    customerId: string,
    dto: CreateCustomerContactDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<CustomerContact> {
    const customer = await this.requireWritableCustomer(customerId, requestingUserId, scope);

    const contact = await this.tx().customerContact.create({
      data: {
        companyId: customer.companyId,
        customerId,
        fullName: dto.fullName,
        jobTitle: dto.jobTitle,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary ?? false,
      },
    });

    if (contact.isPrimary) {
      await this.setPrimaryExclusively(customerId, contact.id);
    }

    await this.audit.record({
      userId: actor.userId,
      action: "add_contact",
      entity: "Customer",
      entityId: customerId,
      ipAddress: actor.ipAddress,
      metadata: { contactId: contact.id },
    });

    return contact;
  }

  async updateContact(
    customerId: string,
    contactId: string,
    dto: UpdateCustomerContactDto,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<CustomerContact | null> {
    await this.requireWritableCustomer(customerId, requestingUserId, scope);

    const existing = await this.tx().customerContact.findFirst({
      where: { id: contactId, customerId },
      select: { id: true },
    });
    if (!existing) return null;

    const updated = await this.tx().customerContact.update({
      where: { id: contactId },
      data: {
        fullName: dto.fullName,
        jobTitle: dto.jobTitle,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary,
      },
    });

    if (updated.isPrimary) {
      await this.setPrimaryExclusively(customerId, contactId);
    }

    await this.audit.record({
      userId: actor.userId,
      action: "update_contact",
      entity: "Customer",
      entityId: customerId,
      ipAddress: actor.ipAddress,
      metadata: { contactId },
    });

    return updated;
  }

  async removeContact(
    customerId: string,
    contactId: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<boolean> {
    await this.requireWritableCustomer(customerId, requestingUserId, scope);

    const result = await this.tx().customerContact.deleteMany({
      where: { id: contactId, customerId },
    });
    if (result.count === 0) return false;

    await this.audit.record({
      userId: actor.userId,
      action: "remove_contact",
      entity: "Customer",
      entityId: customerId,
      ipAddress: actor.ipAddress,
      metadata: { contactId },
    });

    return true;
  }

  // ── Internals ───────────────────────────────────────────────────────

  /** Exactly one primary contact per customer. Enforced here rather than by a DB constraint — Postgres partial unique indexes aren't expressible in the Prisma schema, and this runs inside the same tenant-scoped transaction as the write. */
  private async setPrimaryExclusively(customerId: string, contactId: string): Promise<void> {
    await this.tx().customerContact.updateMany({
      where: { customerId, id: { not: contactId } },
      data: { isPrimary: false },
    });
  }

  private async requireWritableCustomer(
    customerId: string,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Customer> {
    const where = await this.writeScopeWhere(requestingUserId, scope);
    // Deliberately the same 404 whether the customer doesn't exist or is
    // outside the caller's write scope — but note reads are company-wide,
    // so this only ever hides "you may not write to this", never "this
    // customer exists".
    if (where === null) throw new NotFoundException("Customer not found");

    const customer = await this.tx().customer.findFirst({ where: { id: customerId, ...where } });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  /**
   * Owner-based write scope. Unlike Projects (membership-based), this
   * resolves through `Employee.departmentId` on the OWNER — the same
   * shape as AttendanceService.teamTimesheet and TaskTimeEntriesService.
   *
   * A customer with no owner is writable only at `all` scope: it belongs
   * to nobody's department and is nobody's own, so neither narrower scope
   * can match it. Deliberate — "claiming" an unowned customer would be a
   * real feature, and the plan didn't ask for one.
   */
  private async writeScopeWhere(
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<Prisma.CustomerWhereInput | null> {
    if (scope === "all") return {};

    if (scope === "own_department") {
      const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
      if (!managedDepartmentId) return null;
      return { owner: { departmentId: managedDepartmentId } };
    }

    const own = await this.employees.findOwn(requestingUserId);
    if (!own) return null;
    return { ownerId: own.id };
  }

  /** Validates an explicit ownerId against the caller's scope, or defaults to the caller's own Employee record ("you own what you create"). */
  private async resolveOwnerForWrite(
    requestedOwnerId: string | undefined,
    requestingUserId: string,
    scope: PermissionScope,
  ): Promise<string | undefined> {
    const own = await this.employees.findOwn(requestingUserId);

    if (requestedOwnerId === undefined) {
      // An admin with no Employee record (structurally possible) simply
      // creates an unowned customer, which they can still manage at `all`
      // scope.
      return own?.id;
    }

    if (scope === "all") return requestedOwnerId;

    if (scope === "self") {
      if (!own || requestedOwnerId !== own.id) {
        throw new ForbiddenException("You can only assign customers to yourself");
      }
      return requestedOwnerId;
    }

    const managedDepartmentId = await this.employees.managedDepartmentId(requestingUserId);
    const target = managedDepartmentId
      ? await this.tx().employee.findFirst({
          where: { id: requestedOwnerId, departmentId: managedDepartmentId },
          select: { id: true },
        })
      : null;
    if (!target) {
      throw new ForbiddenException(
        "You can only assign customers to employees in the department you manage",
      );
    }
    return requestedOwnerId;
  }
}
