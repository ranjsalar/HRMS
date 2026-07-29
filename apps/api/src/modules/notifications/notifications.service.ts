import { Inject, Injectable } from "@nestjs/common";
import type { Locale } from "../../i18n/locale.type";
import en from "../../i18n/en/emails.json";
import ar from "../../i18n/ar/emails.json";
import ku from "../../i18n/ku/emails.json";
import { EMAIL_SERVICE, type EmailService } from "../../common/email/email.interface";

const TRANSLATIONS: Record<Locale, typeof en> = { en, ar, ku };

/**
 * One method per notification TYPE (currently just password reset), all
 * sharing the same injected `EmailService` — adding a future type (leave
 * approved/rejected, document expiring, etc.) means adding one more
 * method here that builds its own subject/body from its own i18n keys and
 * calls `this.email.send(...)`, not touching `EmailService`/
 * `SmtpEmailService`/any existing caller. That's the whole point of
 * keeping "how do we send an email" (EmailService) and "what does THIS
 * notification say" (this class) as separate layers from the start.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(EMAIL_SERVICE) private readonly email: EmailService) {}

  async sendPasswordResetEmail(to: string, locale: Locale, resetLink: string): Promise<void> {
    const t = TRANSLATIONS[locale].passwordReset;
    const dir = locale === "en" ? "ltr" : "rtl";

    const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>${escapeHtml(t.body)}</p>
    <p>
      <a href="${escapeHtml(resetLink)}" style="display: inline-block; padding: 10px 20px; background: #0f5c5c; color: #fff; text-decoration: none; border-radius: 6px;">
        ${escapeHtml(t.linkText)}
      </a>
    </p>
    <p style="color: #666; font-size: 13px;">${escapeHtml(t.ignoreNotice)}</p>
  </body>
</html>`;

    const text = `${t.body}\n\n${t.linkText}: ${resetLink}\n\n${t.ignoreNotice}`;

    await this.email.send({ to, subject: t.subject, html, text });
  }
}

/** Minimal, deliberately narrow — the only untrusted value ever interpolated into this HTML is the reset link itself (a server-issued JWT, not user input), but escaping it costs nothing and removes any doubt. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
