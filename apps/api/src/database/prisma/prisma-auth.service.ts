import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient, RoleName } from "@prisma/client";

export interface AuthLookupUser {
  id: string;
  email: string;
  passwordHash: string;
  role: RoleName;
  companyId: string | null;
  twoFaSecret: string | null;
  twoFaEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
}

/**
 * Dedicated connection for the pre-authentication login lookup — bound to
 * DATABASE_AUTH_URL, the hrms_auth role (see the add_hrms_auth_role
 * migration and DECISIONS.md for why this exists instead of routing login
 * through hrms_superadmin).
 *
 * Deliberately uses `$queryRaw`/`$executeRaw` (parameterized, not string
 * interpolation) instead of Prisma's typed `findMany`/`update` API. Two
 * reasons: (1) Prisma's `update()` implicitly writes `updatedAt` on every
 * call via `@updatedAt`, and hrms_auth only has column-level UPDATE grant
 * on `failedLoginAttempts`/`lockedUntil` — an ORM update would fail with a
 * permissions error. (2) keeping the exact column list explicit here, in
 * one place, makes it structurally obvious this service can never
 * accidentally touch more than what hrms_auth is granted, independent of
 * whatever Prisma's default select/return behavior happens to be.
 *
 * Only ever exposes narrow, purpose-built methods — never the raw Prisma
 * client surface — so nothing outside this file can add a new query
 * against this role by accident.
 */
@Injectable()
export class PrismaAuthService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>("DATABASE_AUTH_URL") } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * All users with this email, across every company — email is only
   * unique per-company (`@@unique([companyId, email])`), so more than one
   * row can come back. Callers disambiguate by verifying the submitted
   * password against each candidate.
   */
  async findUsersForLogin(email: string): Promise<AuthLookupUser[]> {
    return this.$queryRaw<AuthLookupUser[]>`
      SELECT
        id,
        email,
        "passwordHash",
        role,
        "companyId",
        "twoFaSecret",
        "twoFaEnabled",
        "failedLoginAttempts",
        "lockedUntil",
        "mustChangePassword"
      FROM "User"
      WHERE email = ${email}
    `;
  }

  async findUserById(userId: string): Promise<AuthLookupUser | null> {
    const rows = await this.$queryRaw<AuthLookupUser[]>`
      SELECT
        id,
        email,
        "passwordHash",
        role,
        "companyId",
        "twoFaSecret",
        "twoFaEnabled",
        "failedLoginAttempts",
        "lockedUntil",
        "mustChangePassword"
      FROM "User"
      WHERE id = ${userId}
    `;
    return rows[0] ?? null;
  }

  async recordFailedAttempt(
    userId: string,
    failedLoginAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.$executeRaw`
      UPDATE "User"
      SET "failedLoginAttempts" = ${failedLoginAttempts}, "lockedUntil" = ${lockedUntil}
      WHERE id = ${userId}
    `;
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    await this.recordFailedAttempt(userId, 0, null);
  }
}
