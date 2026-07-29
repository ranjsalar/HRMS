import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { RoleName } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string;
  companyId: string | null;
  role: RoleName;
}

export interface RefreshTokenValue {
  raw: string; // sent to the client, stored only as a hash
  hash: string; // what's persisted in RefreshToken.tokenHash
}

export type PendingTokenPurpose = "2fa_verify" | "2fa_enroll";

export interface PendingTokenPayload {
  sub: string;
  purpose: PendingTokenPurpose;
}

export interface PasswordResetTokenPayload {
  sub: string;
  // sha256 fingerprint of the passwordHash that was current when this
  // token was issued — verification re-checks this against the user's
  // *current* passwordHash so the token stops working the moment the
  // password actually changes (including via this same token, once used).
  currentHashFingerprint: string;
}

/**
 * Purely computational — no DB access. Refresh token persistence
 * (creating/revoking RefreshToken rows) depends on which Prisma
 * connection applies (tenant-scoped vs. Super Admin, per whether the user
 * has a companyId), which is a per-request decision AuthService makes;
 * keeping that out of this service keeps it trivially unit-testable.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issueAccessToken(user: AccessTokenPayload): string {
    return this.jwt.sign(
      { sub: user.sub, companyId: user.companyId, role: user.role },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: this.config.get<string>("JWT_ACCESS_TTL"),
      },
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  /** Random opaque value — refresh tokens are never JWTs (nothing to decode client-side). */
  generateRefreshTokenValue(): RefreshTokenValue {
    const raw = randomBytes(32).toString("base64url");
    return { raw, hash: this.hashRefreshToken(raw) };
  }

  hashRefreshToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  refreshTokenExpiry(now: Date = new Date()): Date {
    const ttl = this.config.get<string>("JWT_REFRESH_TTL") ?? "7d";
    return new Date(now.getTime() + parseDurationMs(ttl));
  }

  /**
   * Short-lived token issued after password verification but before 2FA is
   * complete (either "verify your existing 2FA code" or "you must enroll
   * 2FA before you can proceed" — mandatory for superadmin/company_admin).
   * Signed with a dedicated secret, never JWT_ACCESS_SECRET, so it can
   * never be accepted anywhere a full access token is expected — see
   * DECISIONS.md.
   */
  issuePendingToken(payload: PendingTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>("TWO_FACTOR_PENDING_SECRET"),
      expiresIn: this.config.get<string>("TWO_FACTOR_PENDING_TTL"),
    });
  }

  /** Throws if the token is invalid/expired, or its purpose doesn't match what the caller expects. */
  verifyPendingToken(token: string, expectedPurpose: PendingTokenPurpose): PendingTokenPayload {
    const payload = this.jwt.verify<PendingTokenPayload>(token, {
      secret: this.config.getOrThrow<string>("TWO_FACTOR_PENDING_SECRET"),
    });
    if (payload.purpose !== expectedPurpose) {
      throw new Error("Unexpected pending token purpose");
    }
    return payload;
  }

  hashFingerprint(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  issuePasswordResetToken(userId: string, currentPasswordHash: string): string {
    return this.jwt.sign(
      { sub: userId, currentHashFingerprint: this.hashFingerprint(currentPasswordHash) },
      {
        secret: this.config.getOrThrow<string>("PASSWORD_RESET_SECRET"),
        expiresIn: this.config.get<string>("PASSWORD_RESET_TTL"),
      },
    );
  }

  verifyPasswordResetToken(token: string): PasswordResetTokenPayload {
    return this.jwt.verify<PasswordResetTokenPayload>(token, {
      secret: this.config.getOrThrow<string>("PASSWORD_RESET_SECRET"),
    });
  }
}

const DURATION_RE = /^(\d+)(s|m|h|d)$/;
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parses the small subset of duration strings this app actually uses (e.g. "15m", "7d"). */
export function parseDurationMs(duration: string): number {
  const match = DURATION_RE.exec(duration);
  if (!match) {
    throw new Error(`Unsupported duration format: "${duration}"`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
