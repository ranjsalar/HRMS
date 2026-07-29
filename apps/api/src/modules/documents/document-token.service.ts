import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { parseDurationMs } from "../auth/token.service";

export interface DocumentDownloadTokenPayload {
  documentId: string;
  companyId: string;
}

export interface IssuedDocumentToken {
  token: string;
  expiresAt: Date;
}

/**
 * The "signed URL" — since there's no S3 here, a signed URL is a
 * server-issued, short-lived JWT embedded in a query string that this
 * app's own download endpoint verifies, rather than an actual S3
 * presigned URL. Same properties that matter: short TTL, tamper-evident,
 * carries just enough to look the resource up (documentId + companyId,
 * both needed since the download endpoint is @Public() and has no
 * request.user to derive a company from — see DocumentsService.downloadByToken).
 *
 * Own dedicated secret (DOCUMENT_URL_SECRET), same reasoning as every
 * other token family in this app (pending-2FA, password-reset): a
 * document-download token must never be usable as, or accepted in place
 * of, any other kind of token.
 */
@Injectable()
export class DocumentTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(payload: DocumentDownloadTokenPayload): IssuedDocumentToken {
    const ttl = this.config.get<string>("DOCUMENT_URL_TTL") ?? "10m";
    const token = this.jwt.sign(payload, {
      secret: this.config.getOrThrow<string>("DOCUMENT_URL_SECRET"),
      expiresIn: ttl,
    });
    return { token, expiresAt: new Date(Date.now() + parseDurationMs(ttl)) };
  }

  verify(token: string): DocumentDownloadTokenPayload {
    try {
      return this.jwt.verify<DocumentDownloadTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("DOCUMENT_URL_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired document link");
    }
  }
}
