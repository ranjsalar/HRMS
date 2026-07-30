# HRMS

Multi-tenant HR & Payroll SaaS for companies in Kurdistan and Iraq. See
`HRMS-Project-Plan.md` and `HRMS-Technical-Architecture-Security-Design-Spec.md`
for scope, architecture, and security requirements — both are binding.
Architecture/implementation decisions not already covered by those two
documents are logged in `DECISIONS.md`.

## Monorepo layout

- `apps/api` — NestJS backend (modular monolith)
- `apps/web` — Next.js frontend
- `packages/shared` — shared types, Zod validation, i18n key-parity tooling

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- pnpm 9+
- Docker + Docker Compose (Postgres, Redis, and optionally the dev
  containers for `api`/`web`)

### pnpm install caveat (Windows)

`corepack enable pnpm` can fail with `EPERM: operation not permitted, open
'C:\Program Files\nodejs\pnpx'` on machines where the Node.js install
directory isn't writable without elevation — this happened on the primary
dev machine for this project. If that happens, skip corepack and install
pnpm globally instead:

```sh
npm install -g pnpm@9
```

Then verify with `pnpm -v`. This has no effect on how the project runs —
it's purely a one-time local tooling fix. If you hit the same `EPERM` on a
different machine, this is the known fix; no need to re-diagnose it.

## Getting started

```sh
pnpm install

# Root .env — used by docker-compose (containers reach Postgres/Redis via
# the `postgres`/`redis` service names).
cp .env.example .env

# apps/api/.env — used by the Prisma CLI and seed scripts run directly on
# the host (outside Docker), so they reach Postgres/Redis via localhost
# instead. Same secrets as the root .env, different hostnames/ports.
cp apps/api/.env.example apps/api/.env
# edit both files: fill in real secrets, and if port 5432 is already taken
# on your machine (check with `docker compose up -d postgres` — auth errors
# against seemingly-correct credentials are the symptom), remap the
# "5432:5432" line in docker-compose.yml and the host-side port in
# apps/api/.env together, e.g. to 5433. See DECISIONS.md.

docker compose up -d postgres redis
pnpm --filter @hrms/api exec prisma migrate deploy   # applies migrations, needs DATABASE_MIGRATE_URL
pnpm --filter @hrms/api db:bootstrap-roles           # sets hrms_app / hrms_superadmin / hrms_auth passwords
pnpm --filter @hrms/api db:seed                      # demo companies, default permissions, holidays
pnpm --filter @hrms/api db:verify-rls                # proves tenant isolation actually holds
pnpm --filter @hrms/api db:verify-auth-scope         # proves the login role's grants are as narrow as intended

pnpm dev                     # runs api + web via Turborepo
```

### Production secrets

Every secret in `apps/api/.env.example` / `apps/api/.env.production.example`
(Postgres role passwords, JWT/token-signing secrets, `FIELD_ENCRYPTION_KEY`,
document/payslip URL-signing secrets) must be freshly generated for a real
deployment — **never** reuse dev's or test's values. A secret shared across
environments means a leak in one compromises all of them.

```sh
pnpm --filter @hrms/api cli:generate-production-secrets
```

Prints a ready-to-paste block of every generatable secret, freshly random on
each run (including a correctly-formatted `FIELD_ENCRYPTION_KEY` — a real
base64-encoded 32-byte value, not just a long string). Paste the output into
that deployment's own `apps/api/.env.production` — created once, directly on
the production host, gitignored, never committed (same convention as `.env`
and `.env.test`). Remaining values in `.env.production.example` (hostnames,
`CORS_ORIGINS`, `FRONTEND_URL`, SMTP provider credentials) are
deployment-specific and not generatable — fill those in by hand. Run this
once per real deployment, not once for the whole project.

### Creating a company (no public signup)

There is no signup UI by design. New tenants are provisioned via CLI, which
creates the `Company` row, its first `company_admin` user with a one-time
temporary password (forced change on first login), and default
permissions:

```sh
pnpm --filter @hrms/api cli:create-company -- \
  --name "Acme LLC" --city Erbil --adminEmail admin@acme.com
```

The temporary password is printed once and isn't recoverable — relay it to
the customer over a secure channel. 2FA enrollment is mandatory for
`company_admin`/`superadmin` and happens on that account's first login
(`2fa_enrollment_required` → `POST /auth/2fa/enroll` → `POST /auth/2fa/enable`).

See `apps/api/src/database/` for the Prisma schema, migrations, and seed
scripts, and `DECISIONS.md` for why the database roles are set up the way
they are (RLS enforcement depends on it) and why the Postgres port may need
remapping on Windows.
