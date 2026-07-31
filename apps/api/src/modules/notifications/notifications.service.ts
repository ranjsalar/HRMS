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

  /**
   * Sent once, at company-provisioning time, by the Super Admin dashboard
   * (see SuperAdminService) — deliberately English-only, with strings
   * inlined here rather than added to the en/ar/ku emails.json structure
   * the rest of NotificationsService uses. Every other email in this
   * class is addressed to a company's own employees, who pick their UI
   * locale (see PasswordResetRequestDto); this one is addressed to a
   * newly-created company_admin by the founder (the only superadmin),
   * describing a superadmin-only surface that is itself English-only (see
   * DECISIONS.md, "Super Admin dashboard: English-only"). Adding ar/ku
   * keys with no real translated content — or worse, English text copied
   * under ar/ku keys — would misrepresent this as a localized email when
   * it structurally never can be one. If that ever changes, this should
   * move into the TRANSLATIONS-keyed pattern like sendPasswordResetEmail.
   */
  async sendCompanyAdminWelcomeEmail(params: {
    to: string;
    adminName: string;
    companyName: string;
    temporaryPassword: string;
    loginUrl: string;
  }): Promise<void> {
    const { to, adminName, companyName, temporaryPassword, loginUrl } = params;
    const subject = `Your HRMS account for ${companyName}`;

    const html = `<!doctype html>
<html lang="en" dir="ltr">
  <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>Hi ${escapeHtml(adminName)},</p>
    <p>An HRMS account has been created for you as the administrator of <strong>${escapeHtml(companyName)}</strong>.</p>
    <p>
      Email: ${escapeHtml(to)}<br />
      Temporary password: <code>${escapeHtml(temporaryPassword)}</code>
    </p>
    <p>
      <a href="${escapeHtml(loginUrl)}" style="display: inline-block; padding: 10px 20px; background: #0f5c5c; color: #fff; text-decoration: none; border-radius: 6px;">
        Log in
      </a>
    </p>
    <p style="color: #666; font-size: 13px;">You'll be required to set a new password the first time you log in.</p>
  </body>
</html>`;

    const text = `Hi ${adminName},\n\nAn HRMS account has been created for you as the administrator of ${companyName}.\n\nEmail: ${to}\nTemporary password: ${temporaryPassword}\n\nLog in: ${loginUrl}\n\nYou'll be required to set a new password the first time you log in.`;

    await this.email.send({ to, subject, html, text });
  }

  /**
   * Sent when a company_admin (or a manager granted employees:create — see
   * EmployeesService) provisions a login for a new employee/manager.
   * Unlike sendCompanyAdminWelcomeEmail, this one IS routed through the
   * en/ar/ku TRANSLATIONS pattern — its recipients are a real pilot
   * company's own staff, who pick their own locale, not the founder. See
   * DECISIONS.md.
   */
  async sendEmployeeWelcomeEmail(params: {
    to: string;
    locale: Locale;
    employeeName: string;
    companyName: string;
    temporaryPassword: string;
    loginUrl: string;
  }): Promise<void> {
    const { to, locale, employeeName, companyName, temporaryPassword, loginUrl } = params;
    const t = TRANSLATIONS[locale].employeeWelcome;
    const dir = locale === "en" ? "ltr" : "rtl";
    const vars = { name: employeeName, companyName };

    const subject = interpolate(t.subject, vars);
    const body = interpolate(t.body, vars);

    const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>${escapeHtml(body)}</p>
    <p>
      ${escapeHtml(t.emailLabel)}: ${escapeHtml(to)}<br />
      ${escapeHtml(t.passwordLabel)}: <code>${escapeHtml(temporaryPassword)}</code>
    </p>
    <p>
      <a href="${escapeHtml(loginUrl)}" style="display: inline-block; padding: 10px 20px; background: #0f5c5c; color: #fff; text-decoration: none; border-radius: 6px;">
        ${escapeHtml(t.linkText)}
      </a>
    </p>
    <p style="color: #666; font-size: 13px;">${escapeHtml(t.passwordNotice)}</p>
  </body>
</html>`;

    const text = `${body}\n\n${t.emailLabel}: ${to}\n${t.passwordLabel}: ${temporaryPassword}\n\n${t.linkText}: ${loginUrl}\n\n${t.passwordNotice}`;

    await this.email.send({ to, subject, html, text });
  }
}

/** Replaces every {{key}} token with vars[key] — this module's only translated strings that ever carry a runtime value (company/person names), so a full i18n interpolation library would be overkill. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}

/** Minimal, deliberately narrow — the only untrusted value ever interpolated into this HTML is the reset link itself (a server-issued JWT, not user input), but escaping it costs nothing and removes any doubt. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
