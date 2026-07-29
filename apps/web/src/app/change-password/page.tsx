"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

const MIN_PASSWORD_LENGTH = 8;

/**
 * The FORCED password-change flow specifically — reachable only while
 * authenticated with `mustChangePassword` still true (mirrors the
 * backend's MustChangePasswordGuard, which blocks every other endpoint
 * until this one succeeds). Not authenticated at all -> /login.
 * Authenticated with a current password already -> nothing to force,
 * bounce to "/". A voluntary "change my password" action from account
 * settings is a different, not-yet-built feature — see DECISIONS.md.
 */
export default function ChangePasswordPage() {
  const { status, mustChangePassword, clearMustChangePassword } = useAuth();
  const { t, dir } = useTranslation();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ currentPassword?: string; newPassword?: string }>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && !mustChangePassword) {
      router.replace("/");
    }
  }, [status, mustChangePassword, router]);

  if (status !== "authenticated" || !mustChangePassword) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-80" />
      </main>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!currentPassword) errors.currentPassword = t("common.validation.required");
    if (!newPassword) errors.newPassword = t("common.validation.required");
    else if (newPassword.length < MIN_PASSWORD_LENGTH) {
      errors.newPassword = t("common.validation.passwordMinLength");
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/password/change", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      // Flips the local flag; the effect above then redirects to "/" —
      // one redirect path, not a second explicit one here.
      clearMustChangePassword();
    } catch {
      // Covers both "current password is incorrect" and any other
      // failure with the same generic, translated copy — no dedicated
      // message for the wrong-current-password case in this v1 scope.
      setFormError(t("common.errors.generic.message"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4" noValidate>
        <h1 className="font-heading text-lg text-neutral-900">{t("auth.changePassword.title")}</h1>
        <p className="font-body text-sm text-neutral-900">{t("auth.changePassword.instructions")}</p>
        <TextField
          label={t("auth.changePassword.currentPassword")}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={fieldErrors.currentPassword}
        />
        <TextField
          label={t("auth.changePassword.newPassword")}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={fieldErrors.newPassword}
        />
        {formError && (
          <p role="alert" className="font-body text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={submitting}>
          {t("auth.changePassword.submit")}
        </Button>
      </form>
    </main>
  );
}
