"use client";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";

type ErrorKind = "forbidden" | "notFound" | "conflict" | "generic";

/**
 * Three distinct presentations, never one generic "Something went wrong"
 * — a permission denial, a real error, and "this doesn't exist" are
 * different situations a user should be able to tell apart at a glance.
 * Pass a caught `error` and this classifies it automatically via the
 * same ApiError subclasses api-client.ts throws; pass `kind` directly for
 * a state that didn't come from a caught error (e.g. an empty-permission
 * check done before ever calling the API).
 *
 * Retry is only offered for the generic case — retrying a 403 or 404
 * can't change the outcome, so offering it there would be misleading.
 */
export function ErrorState({
  error,
  kind,
  onRetry,
}: {
  error?: unknown;
  kind?: ErrorKind;
  onRetry?: () => void;
}) {
  const { t, dir } = useTranslation();

  const resolvedKind: ErrorKind =
    kind ??
    (error instanceof ForbiddenError
      ? "forbidden"
      : error instanceof NotFoundError
        ? "notFound"
        : error instanceof ConflictError
          ? "conflict"
          : "generic");

  return (
    <div
      role="alert"
      dir={dir}
      className="flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-4"
    >
      <p className="font-heading text-base font-semibold text-danger">
        {t(`common.errors.${resolvedKind}.title`)}
      </p>
      <p className="font-body text-sm text-neutral-900">
        {t(`common.errors.${resolvedKind}.message`)}
      </p>
      {resolvedKind === "generic" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border border-danger px-3 py-1 font-body text-sm text-danger hover:bg-danger/10"
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}
