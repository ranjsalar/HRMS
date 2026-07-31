import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaSuperAdminService } from "../../database/prisma/prisma-superadmin.service";
import { PasswordService } from "../auth/password.service";
import { NotificationsService } from "../notifications/notifications.service";
import { buildRolePermissionRows } from "../../database/seeds/default-role-permissions";
import type { CreateCompanyDto, UpdateCompanyStatusDto } from "./dto/company.dto";

export interface CompanyListItem {
  id: string;
  name: string;
  city: string;
  status: string;
  employeeCount: number;
  createdAt: Date;
}

export interface CreateCompanyResult {
  company: { id: string; name: string; city: string; status: string; createdAt: Date };
  admin: { id: string; email: string };
  // Returned exactly once, to the caller only — never persisted in
  // plaintext, never retrievable again after this response. See
  // DECISIONS.md.
  temporaryPassword: string;
}

/**
 * Every method here uses PrismaSuperAdminService (the BYPASSRLS
 * hrms_superadmin connection) directly, never the tenant-scoped
 * connection — same pattern the create-company CLI has always used, for
 * the same structural reason: creating a Company row (or reading across
 * all companies for the list view) is impossible under RLS, since there
 * is no existing company_id to SET LOCAL to. SuperAdminGuard is what
 * confirms, server-side, that the caller is actually a superadmin before
 * any of this runs — this service itself enforces nothing about who may
 * call it (same division of responsibility as PrismaSuperAdminService's
 * own class comment).
 *
 * Audit logging bypasses AuditService deliberately: that service writes
 * through TenantContextStorage's tx, which only exists for tenant-scoped
 * (companyId-bearing) requests — TenantScopeInterceptor never opens one
 * for a superadmin session. AuditLog.companyId is NOT nullable, but both
 * actions here always have a concrete company id in hand (the
 * just-created company, or the target of a status change), so writing
 * directly via the superadmin connection is both possible and correct —
 * no separate exemption or schema change needed. See DECISIONS.md.
 */
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaSuperAdminService,
    private readonly password: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async listCompanies(): Promise<CompanyListItem[]> {
    const companies = await this.prisma.company.findMany({
      select: {
        id: true,
        name: true,
        city: true,
        status: true,
        createdAt: true,
        _count: { select: { employees: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      status: c.status,
      employeeCount: c._count.employees,
      createdAt: c.createdAt,
    }));
  }

  async createCompany(
    dto: CreateCompanyDto,
    actor: { userId: string; ipAddress: string },
  ): Promise<CreateCompanyResult> {
    const existing = await this.prisma.company.findFirst({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`A company named "${dto.name}" already exists.`);
    }

    const company = await this.prisma.company.create({
      data: {
        name: dto.name,
        city: dto.city,
        ...(dto.timezone ? { timezone: dto.timezone } : {}),
        ...(dto.localeDefault ? { localeDefault: dto.localeDefault } : {}),
      },
    });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.password.hash(temporaryPassword);

    const admin = await this.prisma.user.create({
      data: {
        companyId: company.id,
        email: dto.adminEmail,
        passwordHash,
        role: "company_admin",
        mustChangePassword: true,
        twoFaEnabled: false, // mandatory for this role, enrolled on first login
      },
    });

    await this.prisma.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: company.id,
        userId: actor.userId,
        action: "create",
        entity: "Company",
        entityId: company.id,
        ipAddress: actor.ipAddress,
      },
    });

    // Same temporaryPassword value used here as the one returned to the
    // caller below — computed exactly once, never regenerated. See
    // DECISIONS.md.
    const frontendUrl = this.config.getOrThrow<string>("FRONTEND_URL");
    await this.notifications.sendCompanyAdminWelcomeEmail({
      to: admin.email,
      adminName: dto.adminName,
      companyName: company.name,
      temporaryPassword,
      loginUrl: `${frontendUrl}/login`,
    });

    return {
      company: {
        id: company.id,
        name: company.name,
        city: company.city,
        status: company.status,
        createdAt: company.createdAt,
      },
      admin: { id: admin.id, email: admin.email },
      temporaryPassword,
    };
  }

  async setCompanyStatus(
    companyId: string,
    dto: UpdateCompanyStatusDto,
    actor: { userId: string; ipAddress: string },
  ): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
      throw new NotFoundException("Company not found");
    }

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { status: dto.status },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: actor.userId,
        action: dto.status === "suspended" ? "suspend" : "reactivate",
        entity: "Company",
        entityId: companyId,
        metadata: { previousStatus: existing.status, newStatus: dto.status },
        ipAddress: actor.ipAddress,
      },
    });

    return { id: updated.id, status: updated.status };
  }
}

/** Same construction as the create-company CLI's generateTemporaryPassword — see DECISIONS.md. */
function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}
