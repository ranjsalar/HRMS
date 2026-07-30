import { randomBytes } from "crypto";

/**
 * Generates every secret a REAL production deployment needs — no
 * database connection, no side effects, purely random-value generation
 * and formatting. Run once per real deployment (`pnpm --filter @hrms/api
 * cli:generate-production-secrets`), paste the output into that
 * deployment's own `.env.production` (created directly on the VPS,
 * gitignored, never committed — same convention as `.env`/`.env.test`).
 *
 * Every value below is DISTINCT and RANDOM on every run — dev's `.env`
 * values (or any other environment's) must never be reused here. A
 * shared secret across environments defeats the entire point of having
 * separate ones (see DECISIONS.md, "Postgres role separation" and the
 * various "deliberately a different secret" comments throughout
 * env.validation.ts) — a leak in one environment would compromise every
 * environment sharing that value.
 */
function main(): void {
  const lines = [
    "# ── Postgres role passwords ─────────────────────────────────────",
    "# hrms (schema owner / DATABASE_MIGRATE_URL) — set when the",
    "# container/role is first created, not via bootstrap-roles.ts. If",
    "# using docker-compose.yml's postgres service, this is POSTGRES_PASSWORD.",
    `POSTGRES_PASSWORD=${randomSecret()}`,
    "",
    "# hrms_app / hrms_superadmin / hrms_auth — set by",
    "# `pnpm --filter @hrms/api db:bootstrap-roles` after migrating,",
    "# reading exactly these three variable names.",
    `HRMS_APP_DB_PASSWORD=${randomSecret()}`,
    `HRMS_SUPERADMIN_DB_PASSWORD=${randomSecret()}`,
    `HRMS_AUTH_DB_PASSWORD=${randomSecret()}`,
    "",
    "# ── Application secrets ─────────────────────────────────────────",
    `JWT_ACCESS_SECRET=${randomSecret()}`,
    `PASSWORD_RESET_SECRET=${randomSecret()}`,
    `TWO_FACTOR_PENDING_SECRET=${randomSecret()}`,
    `DOCUMENT_URL_SECRET=${randomSecret()}`,
    `PAYSLIP_URL_SECRET=${randomSecret()}`,
    "",
    "# AES-256-GCM field encryption key — MUST be exactly 32 raw bytes,",
    "# base64-encoded (not just a 32+ character string; see",
    "# .env.test.example's comment on this same variable). Rotating this",
    "# after data has been encrypted with a prior value makes that data",
    "# unreadable — back it up somewhere safe outside of git the moment",
    "# you generate it for a real deployment.",
    `FIELD_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  ];

  console.log(lines.join("\n"));
  console.log(
    "\n# Paste the above into that deployment's own .env.production (and the\n" +
      "# root .env if it also runs docker-compose's postgres service).\n" +
      "# Remaining values in .env.production.example (hostnames, ports, SMTP\n" +
      "# provider credentials, CORS_ORIGINS, FRONTEND_URL) are deployment-\n" +
      "# specific, not generatable — fill those in by hand.",
  );
}

/** 48 random bytes, base64-encoded — same as every "openssl rand -base64 48" comment throughout .env.example. */
function randomSecret(): string {
  return randomBytes(48).toString("base64");
}

main();
