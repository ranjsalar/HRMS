import { Injectable } from "@nestjs/common";
import type { Branch } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { CreateBranchDto, UpdateBranchDto } from "./dto/branch.dto";

@Injectable()
export class BranchService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("BranchService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  findMany(): Promise<Branch[]> {
    return this.tx().branch.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string): Promise<Branch | null> {
    return this.tx().branch.findUnique({ where: { id } });
  }

  create(companyId: string, dto: CreateBranchDto): Promise<Branch> {
    return this.tx().branch.create({ data: { companyId, name: dto.name, city: dto.city } });
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch | null> {
    const result = await this.tx().branch.updateMany({ where: { id }, data: dto });
    if (result.count === 0) return null;
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.tx().branch.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
