/**
 * Client-side (browser) Sentry init — Next.js automatically loads this
 * file if present (App Router convention, replacing the older
 * sentry.client.config.ts pattern). Deliberately a no-op when
 * NEXT_PUBLIC_SENTRY_DSN is unset. NEXT_PUBLIC_ prefix is required (not
 * a style choice) — this code runs in the browser, so the DSN has to be
 * inlined into the client bundle at build time the same way
 * NEXT_PUBLIC_API_URL already is (see docker-compose.prod.yml). See
 * DECISIONS.md ("Infrastructure pass, item 6").
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
}

// Required export for Sentry's own navigation instrumentation (removes
// a build warning) — a no-op in practice alongside tracesSampleRate: 0
// above, since this pass's scope is error capture, not performance/
// navigation tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
