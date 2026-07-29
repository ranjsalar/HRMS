import { randomBytes } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { authenticator } from "otplib";
import { TwoFactorService } from "./two-factor.service";

describe("TwoFactorService", () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
  });

  function buildService(): TwoFactorService {
    return new TwoFactorService(new ConfigService({ TOTP_ISSUER: "HRMS-Test" }));
  }

  it("enrolls with a secret, an otpauth URI, and an encrypted form of the secret", () => {
    const service = buildService();
    const enrollment = service.enroll("admin@example.com");

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(enrollment.otpauthUri).toContain("otpauth://totp/");
    expect(enrollment.otpauthUri).toContain("HRMS-Test");
    expect(enrollment.encryptedSecret).not.toBe(enrollment.secret);
  });

  it("verifies a code generated from the same secret", () => {
    const service = buildService();
    const enrollment = service.enroll("admin@example.com");
    const code = authenticator.generate(enrollment.secret);

    expect(service.verifyCode(enrollment.encryptedSecret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const service = buildService();
    const enrollment = service.enroll("admin@example.com");

    expect(service.verifyCode(enrollment.encryptedSecret, "000000")).toBe(false);
  });

  describe("roleRequiresTwoFactor", () => {
    it("is true for superadmin and company_admin", () => {
      expect(TwoFactorService.roleRequiresTwoFactor("superadmin")).toBe(true);
      expect(TwoFactorService.roleRequiresTwoFactor("company_admin")).toBe(true);
    });

    it("is false for manager and employee", () => {
      expect(TwoFactorService.roleRequiresTwoFactor("manager")).toBe(false);
      expect(TwoFactorService.roleRequiresTwoFactor("employee")).toBe(false);
    });
  });
});
