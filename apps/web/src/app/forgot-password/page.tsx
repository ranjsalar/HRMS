"use client";

import { type FormEvent, useState } from "react";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { apiFetch } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const { t, dir, locale } = useTranslation();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setFieldError(t("common.validation.required"));
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setFieldError(t("common.validation.emailInvalid"));
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      // Sends the locale this page is currently rendered in so the
      // password-reset EMAIL (backend-generated, not client-rendered)
      // matches — the backend has no other way to know a user's language
      // preference for this unauthenticated request. See DECISIONS.md.
      await apiFetch("/auth/password-reset/request", { method: "POST", body: { email, locale } });
      // The backend returns an identical response whether the email
      // exists or not (see auth.controller.ts) specifically to avoid
      // account enumeration — this branches only on the REQUEST
      // succeeding or genuinely failing (network/server error), never on
      // whether the account was found, so it can't undermine that.
      setSent(true);
    } catch {
      setFormError(t("common.errors.generic.message"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {sent ? (
          <p className="font-body text-sm text-neutral-900">{t("auth.forgotPassword.sent")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <h1 className="font-heading text-lg text-neutral-900">{t("auth.forgotPassword.title")}</h1>
            <p className="font-body text-sm text-neutral-900">{t("auth.forgotPassword.instructions")}</p>
            <TextField
              label={t("auth.forgotPassword.email")}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldError}
            />
            {formError && (
              <p role="alert" className="font-body text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" loading={submitting}>
              {t("auth.forgotPassword.submit")}
            </Button>
          </form>
        )}
        <BackLink href="/login">{t("auth.forgotPassword.backToLogin")}</BackLink>
      </div>
    </main>
  );
}
