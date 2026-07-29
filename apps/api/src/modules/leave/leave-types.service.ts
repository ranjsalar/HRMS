import { Injectable } from "@nestjs/common";
import type { LeaveType } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { CreateLeaveTypeDto, UpdateLeaveTypeDto } from "./dto/leave-type.dto";

/**
 * Never hard-deletes — once a LeaveType has any LeaveRequest/LeaveBalance
 * history, removing the row would orphan that history's foreign key.
 * `remove()` deactivates (`active: false`) instead, same reasoning as
 * Employee soft-delete (step 5). Deactivated types stay visible to
 * `findMany` for admins managing them, but `findActive` (what employees see
 * when submitting a request) excludes them.
 */
@Injectable()
export class LeaveTypesService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("LeaveTypesService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  findActive(): Promise<LeaveType[]> {
    return this.tx().leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  }

  findAll(): Promise<LeaveType[]> {
    return this.tx().leaveType.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string): Promise<LeaveType | null> {
    return this.tx().leaveType.findUnique({ where: { id } });
  }

  create(companyId: string, dto: CreateLeaveTypeDto): Promise<LeaveType> {
    return this.tx().leaveType.create({
      data: {
        companyId,
        name: dto.name,
        daysPerYear: dto.daysPerYear,
        requiresApproval: dto.requiresApproval ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateLeaveTypeDto): Promise<LeaveType | null> {
    const result = await this.tx().leaveType.updateMany({ where: { id }, data: dto });
    if (result.count === 0) return null;
    return this.findOne(id);
  }

  async deactivate(id: string): Promise<boolean> {
    const result = await this.tx().leaveType.updateMany({
      where: { id },
      data: { active: false },
    });
    return result.count > 0;
  }
}
