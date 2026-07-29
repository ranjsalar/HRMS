"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { apiFetch, UnauthorizedError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

type Step =
  | { kind: "credentials" }
  | { kind: "2fa_verify"; pendingToken: string }
  | { kind: "2fa_enroll"; pendingToken: string; secret: string; otpauthUri: string };

interface EnrollResponse {
  secret: string;
  otpauthUri: string;
}
interface SessionResponse {
  accessToken: string;
  mustChangePassword: boolean;
}

const CODE_PATTERN = /^\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { login, establishSession, status } = useAuth();
  const { t, dir } = useTranslation();
  const router = useRouter();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; code?: string }>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Single source of truth for "where does a login attempt end up" — every
  // success path (immediate ok, 2FA verify, 2FA enable) calls
  // establishSession/login, which flips `status` to "authenticated"; this
  // effect is the only place that then navigates away. The home page's
  // own useRequireAuth takes it from there if mustChangePassword is set.
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  useEffect(() => {
    if (step.kind !== "2fa_enroll") {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(step.otpauthUri)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  if (status === "loading" || status === "authenticated") {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-10 w-80" />
      </main>
    );
  }

  async function handleCredentialsSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = t("common.validation.required");
    else if (!EMAIL_PATTERN.test(email)) errors.email = t("common.validation.emailInvalid");
    if (!password) errors.password = t("common.validation.required");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      if (res.status === "2fa_required") {
        setStep({ kind: "2fa_verify", pendingToken: res.pendingToken });
      } else if (res.status === "2fa_enrollment_required") {
        const enrollment = await apiFetch<EnrollResponse>("/auth/2fa/enroll", {
          method: "POST",
          body: { pendingToken: res.pendingToken },
        });
        setStep({ kind: "2fa_enroll", pendingToken: res.pendingToken, ...enrollment });
      }
      // status:"ok" needs no branch here — login() already called
      // establishSession, and the effect above handles navigation.
    } catch (error) {
      setFormError(
        error instanceof UnauthorizedError
          ? t("auth.login.invalidCredentials")
          : t("common.errors.generic.message"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent, pendingToken: string) {
    event.preventDefault();
    if (!CODE_PATTERN.test(code)) {
      setFieldErrors({ code: t("common.validation.codeInvalid") });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const session = await apiFetch<SessionResponse>("/auth/2fa/verify", {
        method: "POST",
        body: { pendingToken, code },
      });
      await establishSession(session.accessToken, session.mustChangePassword);
    } catch (error) {
      setFormError(
        error instanceof UnauthorizedError
          ? t("auth.twoFactor.invalidCode")
          : t("common.errors.generic.message"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnableSubmit(event: FormEvent, pendingToken: string) {
    event.preventDefault();
    if (!CODE_PATTERN.test(code)) {
      setFieldErrors({ code: t("common.validation.codeInvalid") });
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const session = await apiFetch<SessionResponse>("/auth/2fa/enable", {
        method: "POST",
        body: { pendingToken, code },
      });
      await establishSession(session.accessToken, session.mustChangePassword);
    } catch (error) {
      setFormError(
        error instanceof UnauthorizedError
          ? t("auth.twoFactor.invalidCode")
          : t("common.errors.generic.message"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main dir={dir} className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl text-primary">{t("app.name")}</h1>
          <LanguageSwitcher />
        </div>

        {step.kind === "credentials" && (
          <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-4" noValidate>
            <h2 className="font-heading text-lg text-neutral-900">{t("auth.login.title")}</h2>
            <TextField
              label={t("auth.login.email")}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldErrors.email}
            />
            <TextField
              label={t("auth.login.password")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
            />
            {formError && (
              <p role="alert" className="font-body text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" loading={submitting}>
              {t("auth.login.submit")}
            </Button>
            <Link href="/forgot-password" className="font-body text-sm text-primary hover:underline">
              {t("auth.login.forgotPassword")}
            </Link>
          </form>
        )}

        {step.kind === "2fa_verify" && (
          <form
            onSubmit={(event) => handleVerifySubmit(event, step.pendingToken)}
            className="flex flex-col gap-4"
            noValidate
          >
            <h2 className="font-heading text-lg text-neutral-900">{t("auth.twoFactor.verifyTitle")}</h2>
            <p className="font-body text-sm text-neutral-900">{t("auth.twoFactor.verifyInstructions")}</p>
            <TextField
              label={t("auth.twoFactor.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={fieldErrors.code}
            />
            {formError && (
              <p role="alert" className="font-body text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" loading={submitting}>
              {t("auth.twoFactor.verifySubmit")}
            </Button>
          </form>
        )}

        {step.kind === "2fa_enroll" && (
          <form
            onSubmit={(event) => handleEnableSubmit(event, step.pendingToken)}
            className="flex flex-col gap-4"
            noValidate
          >
            <h2 className="font-heading text-lg text-neutral-900">{t("auth.twoFactor.enrollTitle")}</h2>
            <p className="font-body text-sm text-neutral-900">{t("auth.twoFactor.enrollInstructions")}</p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URI from the qrcode package, not something next/image's remote optimizer applies to
              <img src={qrDataUrl} alt="" className="h-40 w-40 self-center" />
            )}
            <p className="break-all rounded-md bg-neutral-100 p-2 text-center font-body text-xs text-neutral-900">
              {t("auth.twoFactor.secretLabel")}: {step.secret}
            </p>
            <TextField
              label={t("auth.twoFactor.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={fieldErrors.code}
            />
            {formError && (
              <p role="alert" className="font-body text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" loading={submitting}>
              {t("auth.twoFactor.enableSubmit")}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
