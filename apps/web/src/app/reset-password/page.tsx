"use client";

import { type FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { apiFetch } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const { t, dir } = useTranslation();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p role="alert" className="font-body text-sm text-danger">
          {t("auth.resetPassword.invalidToken")}
        </p>
        <BackLink href="/login">{t("auth.resetPassword.backToLogin")}</BackLink>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!newPassword) {
      setFieldError(t("common.validation.required"));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFieldError(t("common.validation.passwordMinLength"));
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/password-reset/confirm", {
        method: "POST",
        body: { token, newPassword },
      });
      setSuccess(true);
    } catch {
      // This endpoint's only realistic failure mode is an invalid/expired
      // token (see PasswordResetTokenPayload verification backend-side) —
      // mapped directly rather than to the generic error copy.
      setFormError(t("auth.resetPassword.invalidToken"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {success ? (
          <>
            <p className="font-body text-sm text-neutral-900">{t("auth.resetPassword.success")}</p>
            <BackLink href="/login">{t("auth.resetPassword.backToLogin")}</BackLink>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <h1 className="font-heading text-lg text-neutral-900">{t("auth.resetPassword.title")}</h1>
            <TextField
              label={t("auth.resetPassword.newPassword")}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={fieldError}
            />
            {formError && (
              <p role="alert" className="font-body text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" loading={submitting}>
              {t("auth.resetPassword.submit")}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams() requires a Suspense boundary per Next's App Router
  // rules — this page has no other async data, so an empty fallback is
  // fine (resolves on the same tick in practice).
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
