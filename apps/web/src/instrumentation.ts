/**
 * Next.js's own Instrumentation Hook (stable since Next 15, no config
 * flag needed) — register() runs once when the server process starts,
 * for both the Node.js and Edge runtimes. Deliberately a no-op when
 * NEXT_PUBLIC_SENTRY_DSN is unset — every environment right now (dev,
 * test, CI, and this project's current production compose stack). See
 * DECISIONS.md ("Infrastructure pass, item 6: error + uptime
 * monitoring") and apps/api/src/monitoring/sentry.ts for the identical
 * reasoning on the backend side.
 */
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
  }
}

export const onRequestError = async (
  ...args: Parameters<NonNullable<typeof import("@sentry/nextjs").captureRequestError>>
): Promise<void> => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
