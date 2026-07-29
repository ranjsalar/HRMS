import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { authenticator } from "otplib";
import { decryptField, encryptField } from "../../common/crypto/field-encryption";

export interface TwoFactorEnrollment {
  secret: string; // base32, for manual entry fallback
  otpauthUri: string; // for QR code rendering, frontend's job (step 9)
  encryptedSecret: string; // store this on User.twoFaSecret
}

@Injectable()
export class TwoFactorService {
  constructor(private readonly config: ConfigService) {}

  enroll(email: string): TwoFactorEnrollment {
    const secret = authenticator.generateSecret();
    const issuer = this.config.get<string>("TOTP_ISSUER") ?? "HRMS";
    const otpauthUri = authenticator.keyuri(email, issuer, secret);
    return { secret, otpauthUri, encryptedSecret: encryptField(secret) };
  }

  verifyCode(encryptedSecret: string, code: string): boolean {
    const secret = decryptField(encryptedSecret);
    return authenticator.check(code, secret);
  }

  static roleRequiresTwoFactor(role: string): boolean {
    return role === "superadmin" || role === "company_admin";
  }
}
