import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { parseDurationMs } from "../auth/token.service";

export interface PayslipDownloadTokenPayload {
  payslipId: string;
  companyId: string;
}

export interface IssuedPayslipToken {
  token: string;
  expiresAt: Date;
}

/**
 * Same "signed URL via server-issued short-lived JWT" pattern as
 * DocumentTokenService (step 5), with its own dedicated secret
 * (PAYSLIP_URL_SECRET) — a payslip-download token must never be usable
 * as, or accepted in place of, a document-download token or vice versa,
 * even though both end up embedded the same way in a `?token=...` query
 * string on their respective @Public() download endpoints.
 */
@Injectable()
export class PayslipTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(payload: PayslipDownloadTokenPayload): IssuedPayslipToken {
    const ttl = this.config.get<string>("PAYSLIP_URL_TTL") ?? "10m";
    const token = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>("PAYSLIP_URL_SECRET"),
      expiresIn: ttl,
    });
    return { token, expiresAt: new Date(Date.now() + parseDurationMs(ttl)) };
  }

  verify(token: string): PayslipDownloadTokenPayload {
    try {
      return this.jwt.verify<PayslipDownloadTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("PAYSLIP_URL_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired payslip link");
    }
  }
}
