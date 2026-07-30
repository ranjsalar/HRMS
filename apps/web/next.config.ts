import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};

// withSentryConfig wraps the build to upload source maps to Sentry for
// readable stack traces — itself a no-op without SENTRY_AUTH_TOKEN (a
// separate, build-time-only credential from the runtime DSN above, also
// unset in every environment right now). silent:true keeps build output
// quiet about this rather than warning on every build in the common
// case (DSN unset) that this project runs in today. See DECISIONS.md
// ("Infrastructure pass, item 6").
export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
