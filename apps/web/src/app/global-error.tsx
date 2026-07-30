"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Next.js App Router's last-resort error boundary — catches React
 * render errors the rest of the tree didn't handle. MUST render its own
 * <html>/<body> (Next's own requirement: this fully replaces the root
 * layout when triggered, so RootLayout's own locale-aware rendering
 * isn't available here) — deliberately a plain English fallback, not a
 * missing-translation bug. Sentry.captureException is a no-op without
 * NEXT_PUBLIC_SENTRY_DSN set, same as everywhere else this pass. See
 * DECISIONS.md ("Infrastructure pass, item 6").
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body>
        <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>Please try refreshing the page. If the problem continues, contact support.</p>
        </div>
      </body>
    </html>
  );
}
