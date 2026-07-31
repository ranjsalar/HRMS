import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RoleName } from "@prisma/client";
import { PrismaSuperAdminService } from "../../database/prisma/prisma-superadmin.service";
import { PrismaAuthService, type AuthLookupUser } from "../../database/prisma/prisma-auth.service";
import { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";
import { DEFAULT_LOCALE, type Locale } from "../../i18n/locale.type";
import { NotificationsService } from "../notifications/notifications.service";
import { PasswordService } from "./password.service";
import { LockoutService } from "./lockout.service";
import { TokenService } from "./token.service";
import { TwoFactorService, type TwoFactorEnrollment } from "./two-factor.service";

export interface LoginOk {
  status: "ok";
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  mustChangePassword: boolean;
}
export interface LoginTwoFactorRequired {
  status: "2fa_required";
  pendingToken: string;
}
export interface LoginTwoFactorEnrollmentRequired {
  status: "2fa_enrollment_required";
  pendingToken: string;
}
export type LoginResult = LoginOk | LoginTwoFactorRequired | LoginTwoFactorEnrollmentRequired;

export interface FullSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  mustChangePassword: boolean;
}

const GENERIC_LOGIN_ERROR = "Invalid email or password";

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaSuperAdmin: PrismaSuperAdminService,
    private readonly scoped: TenantScopedRunner,
    private readonly password: PasswordService,
    private readonly lockout: LockoutService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, plaintextPassword: string): Promise<LoginResult> {
    const candidates = await this.prismaAuth.findUsersForLogin(email);

    const unlocked = candidates.filter((c) => !this.lockout.isLocked(c.lockedUntil));
    let authenticated: AuthLookupUser | undefined;
    for (const candidate of unlocked) {
      if (await this.password.verify(candidate.passwordHash, plaintextPassword)) {
        authenticated = candidate;
        break;
      }
    }

    if (!authenticated) {
      await Promise.all(unlocked.map((c) => this.recordFailedLogin(c)));
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (authenticated.companyId) {
      await this.rejectIfCompanyNotActive(authenticated.companyId);
    }

    await this.prismaAuth.resetFailedAttempts(authenticated.id);

    if (authenticated.twoFaEnabled) {
      return {
        status: "2fa_required",
        pendingToken: this.tokens.issuePendingToken({
          sub: authenticated.id,
          purpose: "2fa_verify",
        }),
      };
    }

    if (TwoFactorService.roleRequiresTwoFactor(authenticated.role)) {
      return {
        status: "2fa_enrollment_required",
        pendingToken: this.tokens.issuePendingToken({
          sub: authenticated.id,
          purpose: "2fa_enroll",
        }),
      };
    }

    const session = await this.issueFullSession(authenticated);
    return { status: "ok", ...session };
  }

  async verifyTwoFactorAndLogin(pendingToken: string, code: string): Promise<FullSession> {
    const { sub } = this.verifyPending(pendingToken, "2fa_verify");
    const user = await this.prismaAuth.findUserById(sub);
    if (!user || !user.twoFaEnabled || !user.twoFaSecret) {
      throw new UnauthorizedException("Invalid 2FA session");
    }
    if (!this.twoFactor.verifyCode(user.twoFaSecret, code)) {
      throw new UnauthorizedException("Invalid 2FA code");
    }
    return this.issueFullSession(user);
  }

  async enrollTwoFactor(
    pendingToken: string,
  ): Promise<Omit<TwoFactorEnrollment, "encryptedSecret">> {
    const { sub } = this.verifyPending(pendingToken, "2fa_enroll");
    const user = await this.prismaAuth.findUserById(sub);
    if (!user) {
      throw new UnauthorizedException("Invalid 2FA session");
    }

    const enrollment = this.twoFactor.enroll(user.email);
    await this.scoped.run(user.companyId, (client) =>
      client.user.update({
        where: { id: user.id },
        data: { twoFaSecret: enrollment.encryptedSecret },
        select: { id: true },
      }),
    );

    const { secret, otpauthUri } = enrollment;
    return { secret, otpauthUri };
  }

  async enableTwoFactor(pendingToken: string, code: string): Promise<FullSession> {
    const { sub } = this.verifyPending(pendingToken, "2fa_enroll");
    const user = await this.prismaAuth.findUserById(sub);
    if (!user || !user.twoFaSecret) {
      throw new UnauthorizedException("Call /auth/2fa/enroll first");
    }
    if (!this.twoFactor.verifyCode(user.twoFaSecret, code)) {
      throw new UnauthorizedException("Invalid 2FA code");
    }

    await this.scoped.run(user.companyId, (client) =>
      client.user.update({
        where: { id: user.id },
        data: { twoFaEnabled: true },
        select: { id: true },
      }),
    );

    return this.issueFullSession({
      id: user.id,
      companyId: user.companyId,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
  }

  /** Rotation: old token is revoked, a new one issued. */
  async refresh(rawRefreshToken: string): Promise<FullSession> {
    const tokenHash = this.tokens.hashRefreshToken(rawRefreshToken);

    // Refresh tokens are looked up by hash across all tenants, same
    // structural reason as login-by-email: we don't know the company yet.
    // Uses the Super Admin connection for the lookup only, scoped
    // immediately after by the token owner's actual companyId for the
    // rotation write — this endpoint has no hrms_auth-style narrow role of
    // its own (RefreshToken has no column suited to that pattern the way
    // User's login-relevant columns did), so BYPASSRLS is unavoidable for
    // just this one read. See DECISIONS.md.
    const existing = await this.prismaSuperAdmin.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: true },
    });

    if (!existing || existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = existing.user;

    await this.scoped.run(user.companyId, (client) =>
      client.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
        select: { id: true },
      }),
    );

    return this.issueFullSession({
      id: user.id,
      companyId: user.companyId,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(rawRefreshToken);
    const existing = await this.prismaSuperAdmin.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: { select: { companyId: true } } },
    });
    if (!existing) return;

    await this.scoped.run(existing.user.companyId, (client) =>
      client.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
        select: { id: true },
      }),
    );
  }

  /** Always returns the same generic result — never reveals whether the email exists. */
  async requestPasswordReset(email: string, locale?: Locale): Promise<void> {
    const [user] = await this.prismaAuth.findUsersForLogin(email);
    if (!user) return;

    const resetToken = this.tokens.issuePasswordResetToken(user.id, user.passwordHash);

    // The link points at the WEB app's reset-password PAGE
    // (apps/web/src/app/reset-password/page.tsx), which reads ?token=
    // and POSTs it to /auth/password-reset/confirm itself — never the
    // bare API endpoint directly (that's a POST-only JSON route; nothing
    // useful happens if a browser GETs it from an email click).
    const frontendUrl = this.config.getOrThrow<string>("FRONTEND_URL");
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Real delivery (step 8.5 closure) — was previously logged instead of
    // emailed. Rendered in the locale the visitor was viewing the
    // forgot-password PAGE in (sent by the frontend, request-scoped —
    // see PasswordResetRequestDto), not `user.locale`: PrismaAuthService's
    // `hrms_auth` connection is a deliberately narrow, column-level-
    // GRANTed role that was never granted SELECT on `locale`, and — even
    // if it were — nothing anywhere in this codebase ever writes to
    // `User.locale`, so it would only ever read back the schema default.
    // Request-time locale is the only value that's actually meaningful
    // right now. See DECISIONS.md.
    await this.notifications.sendPasswordResetEmail(email, locale ?? DEFAULT_LOCALE, resetLink);
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const { sub, currentHashFingerprint } = this.verifyPasswordReset(token);
    const user = await this.prismaAuth.findUserById(sub);
    if (!user) {
      throw new UnauthorizedException("Invalid or expired reset token");
    }
    if (this.tokens.hashFingerprint(user.passwordHash) !== currentHashFingerprint) {
      // Password already changed since this token was issued (or reused after use).
      throw new UnauthorizedException("Invalid or expired reset token");
    }

    const newHash = await this.password.hash(newPassword);
    await this.scoped.run(user.companyId, (client) =>
      client.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, mustChangePassword: false },
        select: { id: true },
      }),
    );
  }

  async changePassword(
    userId: string,
    companyId: string | null,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prismaAuth.findUserById(userId);
    if (!user || !(await this.password.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const newHash = await this.password.hash(newPassword);
    await this.scoped.run(companyId, (client) =>
      client.user.update({
        where: { id: userId },
        data: { passwordHash: newHash, mustChangePassword: false },
        select: { id: true },
      }),
    );
  }

  // ── internals ──────────────────────────────────────────────────────

  /**
   * A correct password is not enough — a suspended (or archived) company's
   * users must be refused with an honest, specific reason, not just fail
   * open because RLS/tenant-scoping alone doesn't apply at login time
   * (there is no tenant transaction yet; the login lookup itself uses the
   * cross-tenant hrms_auth connection). Checked via the Super Admin
   * connection since there's no tenant context to scope this read to
   * either. Deliberately runs BEFORE resetFailedAttempts/2FA — a blocked
   * account shouldn't reset lockout state or spend a 2FA round-trip.
   *
   * Both non-"active" statuses are blocked here, not just "suspended":
   * this endpoint's Company.status column has no other legitimate value
   * once a company exists, and there is no scenario where "archived"
   * should still allow login even though the suspend/reactivate dashboard
   * endpoint (see SuperAdminService) only ever toggles active<->suspended
   * and never sets "archived" itself. See DECISIONS.md.
   */
  private async rejectIfCompanyNotActive(companyId: string): Promise<void> {
    const company = await this.prismaSuperAdmin.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (!company || company.status === "active") return;

    throw new UnauthorizedException(
      company.status === "suspended"
        ? "This company's account has been suspended. Contact your HRMS administrator."
        : "This company's account is no longer active. Contact your HRMS administrator.",
    );
  }

  private async recordFailedLogin(candidate: AuthLookupUser): Promise<void> {
    const { failedLoginAttempts, lockedUntil } = this.lockout.recordFailure(
      candidate.failedLoginAttempts,
    );
    await this.prismaAuth.recordFailedAttempt(candidate.id, failedLoginAttempts, lockedUntil);
  }

  private async issueFullSession(user: {
    id: string;
    companyId: string | null;
    role: RoleName;
    mustChangePassword: boolean;
  }): Promise<FullSession> {
    const accessToken = this.tokens.issueAccessToken({
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
    });
    const { raw, hash } = this.tokens.generateRefreshTokenValue();
    const expiresAt = this.tokens.refreshTokenExpiry();

    await this.scoped.run(user.companyId, (client) =>
      client.refreshToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt },
      }),
    );

    return {
      accessToken,
      refreshToken: raw,
      refreshTokenExpiresAt: expiresAt,
      mustChangePassword: user.mustChangePassword,
    };
  }

  // TokenService's verify methods throw raw jsonwebtoken errors (it's a
  // computational service with no notion of HTTP) — every call site here
  // converts that into a proper 401 instead of letting an unhandled
  // JsonWebTokenError bubble up as a 500.
  private verifyPending(
    token: string,
    purpose: Parameters<TokenService["verifyPendingToken"]>[1],
  ): ReturnType<TokenService["verifyPendingToken"]> {
    try {
      return this.tokens.verifyPendingToken(token, purpose);
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
  }

  private verifyPasswordReset(token: string): ReturnType<TokenService["verifyPasswordResetToken"]> {
    try {
      return this.tokens.verifyPasswordResetToken(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired reset token");
    }
  }
}
