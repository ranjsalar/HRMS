import * as Sentry from "@sentry/node";

/**
 * Deliberately a no-op when SENTRY_DSN is unset — which is every
 * environment right now (dev, test, CI, and this project's current
 * production compose stack). Code-complete, wired into
 * GlobalExceptionFilter (see that file), but not actively sending
 * anywhere until the founder creates a real Sentry account and provides
 * a DSN — a cost/context-switch decision, not a technical blocker. See
 * DECISIONS.md ("Infrastructure pass, item 6: error + uptime
 * monitoring"). Verified end-to-end against a real, self-hosted,
 * Sentry-protocol-compatible service (GlitchTip) before being
 * considered done — the same "verify against a real self-hosted
 * equivalent" standard applied to MailDev (email) and MinIO (S3
 * storage) elsewhere in this pass.
 *
 * Called as the very first thing in main.ts's bootstrap — Sentry's own
 * docs recommend initializing before anything else so it can capture
 * errors during the app's own startup sequence, not just once request
 * handling begins.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Errors only, no performance tracing/profiling — this pass's scope
    // is "capture real errors," not a full APM setup. Traces sampling
    // at 0 keeps this a pure error-reporting integration, not something
    // that speculatively adds request-tracing overhead nobody asked for.
    tracesSampleRate: 0,
  });
}
