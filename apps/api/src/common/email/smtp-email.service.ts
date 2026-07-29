import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailService } from "./email.interface";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * SMTP is the transport, not the provider — this works unchanged against
 * literally any SMTP endpoint: the local MailDev catcher in dev
 * (docker-compose service `maildev`, no auth), or a real provider
 * (Resend/Postmark/SES/Brevo/a domain's own mail server) in production.
 * Provider choice becomes a config change (SMTP_HOST/SMTP_USER/etc), not
 * a code change or a new SDK dependency — same reasoning as
 * `LocalDiskStorageService` taking its root path as a constructor
 * argument rather than a hardcoded env var name. See DECISIONS.md ("Real
 * password-reset email delivery") for why SMTP+nodemailer specifically,
 * over a provider-specific SDK.
 */
export class SmtpEmailService implements EmailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // MailDev (dev) takes no auth at all — an empty user/pass would make
      // nodemailer attempt AUTH and fail against a server that never asked
      // for it, so auth is omitted entirely unless a user is configured.
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
