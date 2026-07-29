import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { parseDurationMs, TokenService } from "./token.service";

function buildService(): TokenService {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: "test_access_secret_at_least_32_characters",
    JWT_ACCESS_TTL: "15m",
    JWT_REFRESH_TTL: "7d",
    TWO_FACTOR_PENDING_SECRET: "test_two_factor_pending_secret_at_least_32ch",
    TWO_FACTOR_PENDING_TTL: "5m",
  });
  return new TokenService(new JwtService(), config);
}

describe("parseDurationMs", () => {
  it("parses minutes, hours, and days", () => {
    expect(parseDurationMs("15m")).toBe(15 * 60 * 1000);
    expect(parseDurationMs("1h")).toBe(60 * 60 * 1000);
    expect(parseDurationMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("throws on an unsupported format", () => {
    expect(() => parseDurationMs("nonsense")).toThrow();
  });
});

describe("TokenService", () => {
  it("issues an access token that verifies back to the same claims", () => {
    const service = buildService();
    const token = service.issueAccessToken({
      sub: "user-1",
      companyId: "company-1",
      role: "company_admin",
    });

    const payload = service.verifyAccessToken(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.companyId).toBe("company-1");
    expect(payload.role).toBe("company_admin");
  });

  it("rejects a tampered access token", () => {
    const service = buildService();
    const token = service.issueAccessToken({
      sub: "user-1",
      companyId: "company-1",
      role: "employee",
    });
    const tampered = token.slice(0, -2) + "xx";
    expect(() => service.verifyAccessToken(tampered)).toThrow();
  });

  it("generates a refresh token whose hash matches hashRefreshToken(raw)", () => {
    const service = buildService();
    const { raw, hash } = service.generateRefreshTokenValue();
    expect(service.hashRefreshToken(raw)).toBe(hash);
  });

  it("generates a different raw/hash pair on each call", () => {
    const service = buildService();
    const a = service.generateRefreshTokenValue();
    const b = service.generateRefreshTokenValue();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("computes a refresh token expiry consistent with JWT_REFRESH_TTL", () => {
    const service = buildService();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiry = service.refreshTokenExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("issues and verifies a pending token for the matching purpose", () => {
    const service = buildService();
    const token = service.issuePendingToken({ sub: "user-1", purpose: "2fa_verify" });
    const payload = service.verifyPendingToken(token, "2fa_verify");
    expect(payload.sub).toBe("user-1");
  });

  it("rejects a pending token verified against the wrong purpose", () => {
    const service = buildService();
    const token = service.issuePendingToken({ sub: "user-1", purpose: "2fa_enroll" });
    expect(() => service.verifyPendingToken(token, "2fa_verify")).toThrow();
  });

  it("a pending token cannot be verified as an access token (different secret)", () => {
    const service = buildService();
    const pendingToken = service.issuePendingToken({ sub: "user-1", purpose: "2fa_verify" });
    expect(() => service.verifyAccessToken(pendingToken)).toThrow();
  });
});
