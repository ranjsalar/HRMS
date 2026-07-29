import { z } from "zod";

// Maps NODE_ENV to the exact env file ConfigModule.forRoot loads (see
// app.module.ts). Explicit, not left to ConfigModule's undocumented
// default (which loads plain ".env" from cwd regardless of NODE_ENV) —
// that default is what let apps/api/.env's dev values silently leak into
// the e2e test process for any var .env.test didn't happen to also
// define (rate-limiting.e2e-spec.ts caught this live). NODE_ENV itself
// must already be set in process.env BEFORE ConfigModule.forRoot runs —
// see test/setup-env.ts and package.json's "start" script.
const ENV_FILE_BY_NODE_ENV: Record<string, string> = {
  development: ".env",
  test: ".env.test",
  production: ".env.production",
};

export function resolveEnvFilePath(nodeEnv: string | undefined): string {
  return ENV_FILE_BY_NODE_ENV[nodeEnv ?? "development"] ?? ".env";
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().url(),
  // Required at boot, not optional: PrismaSuperAdminService is a global
  // provider instantiated at startup regardless of whether any given
  // request needs it, so a missing value must fail fast rather than at
  // first use.
  DATABASE_SUPERADMIN_URL: z.string().url(),
  // Same reasoning: PrismaAuthService (hrms_auth-bound) is also a global
  // provider connected at startup.
  DATABASE_AUTH_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  // Refresh tokens are opaque random values (hashed before storage in
  // RefreshToken.tokenHash), not JWTs — there's nothing to sign, so there
  // is no JWT_REFRESH_SECRET. See DECISIONS.md.
  JWT_REFRESH_TTL: z.string().default("7d"),

  PASSWORD_RESET_SECRET: z.string().min(32),
  PASSWORD_RESET_TTL: z.string().default("30m"),

  // Signs short-lived "pending" tokens issued between password verification
  // and completed 2FA (verify or first-time enrollment) — deliberately a
  // different secret than JWT_ACCESS_SECRET so a pending token can never be
  // mistaken for (or accepted as) a full access token, even if a payload
  // shape check were ever loosened by accident.
  TWO_FACTOR_PENDING_SECRET: z.string().min(32),
  TWO_FACTOR_PENDING_TTL: z.string().default("5m"),

  TOTP_ISSUER: z.string().default("HRMS"),

  FIELD_ENCRYPTION_KEY: z.string().min(32),

  // Local disk root for stored documents — outside the web root, never
  // served statically. Defaults to <repo>/storage/documents (a sibling of
  // apps/, resolved relative to wherever the process runs from).
  DOCUMENT_STORAGE_PATH: z.string().default("./storage/documents"),

  // Signs short-lived document-download tokens (the "signed URL" — see
  // DocumentsService). Deliberately its own secret, same reasoning as
  // TWO_FACTOR_PENDING_SECRET: a document-download token should never be
  // usable anywhere else, and vice versa.
  DOCUMENT_URL_SECRET: z.string().min(32),
  DOCUMENT_URL_TTL: z.string().default("10m"),

  // Local disk root for generated payslip PDFs — same "outside web root,
  // never served statically" rule as documents, kept as its own path
  // (not reusing DOCUMENT_STORAGE_PATH) since payslips are a distinct,
  // more sensitive retention/backup concern.
  PAYSLIP_STORAGE_PATH: z.string().default("./storage/payslips"),

  // Signs short-lived payslip-download tokens — same reasoning as
  // DOCUMENT_URL_SECRET, deliberately a distinct secret so a payslip
  // token can never double as a document token or vice versa.
  PAYSLIP_URL_SECRET: z.string().min(32),
  PAYSLIP_URL_TTL: z.string().default("10m"),

  CORS_ORIGINS: z.string().default(""),

  // Auth-endpoint IP throttle limits (per 60s window) — see AuthModule
  // and DECISIONS.md. Defaults are the production-appropriate values.
  // Overridden higher in dev's .env: the dev API server is a single
  // long-running process, and apps/web's real-backend integration test
  // suite logs into it many times per run — production's correct
  // 10/60s would trip on our OWN tests, not just attackers. Left at
  // the strict defaults in .env.test on purpose:
  // test/rate-limiting.e2e-spec.ts asserts these exact numbers against
  // dedicated, short-lived app instances.
  AUTH_LOGIN_RATE_LIMIT: z.coerce.number().default(10),
  AUTH_STRICT_RATE_LIMIT: z.coerce.number().default(5),

  // Base URL of the WEB app (not this API) — used to build links inside
  // emails (password reset, and future notification types) that a user
  // clicks in their browser. Deliberately distinct from CORS_ORIGINS
  // (that's "who may call this API"; this is "where does a human land").
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  // SMTP transport for the Notifications module (step 8.5 closure —
  // real password-reset delivery). Points at the local MailDev catcher in
  // dev (docker-compose service `maildev`, SMTP on 1025, no auth needed —
  // SMTP_USER/SMTP_PASSWORD stay empty); swapped for a real provider's
  // SMTP credentials in production via env vars only, no code change. See
  // DECISIONS.md.
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  // NOT z.coerce.boolean() — that calls JS's Boolean(str) on the raw env
  // string, and Boolean("false") is true (any non-empty string is
  // truthy). Caught live: with z.coerce.boolean(), SMTP_SECURE=false in
  // .env was silently becoming `true`, making nodemailer attempt an
  // implicit TLS handshake against MailDev's plaintext-only port 1025 —
  // "SSL routines:ssl3_get_record:wrong version number". See
  // DECISIONS.md.
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().default("HRMS <no-reply@hrms.local>"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data;
}
