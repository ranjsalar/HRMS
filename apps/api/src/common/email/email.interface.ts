export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Email-sending abstraction so callers never talk to nodemailer (or any
 * specific provider) directly — same reasoning, same shape, as
 * `StorageService` (`common/storage/storage.interface.ts`): swapping the
 * underlying transport means writing one new class against this
 * interface and changing the DI binding, not touching any calling code.
 * The current (only) implementation is SMTP-based, which already covers
 * "swap providers" as a config change (SMTP_HOST/SMTP_USER/etc), not a
 * code change — see `SmtpEmailService` and DECISIONS.md.
 */
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SERVICE = Symbol("EMAIL_SERVICE");
