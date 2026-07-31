# Architecture & Product Decisions Log

A running log of decisions made during implementation that aren't already
specified in `HRMS-Project-Plan.md` or
`HRMS-Technical-Architecture-Security-Design-Spec.md`. Newest entries at the
top. Each entry: what was decided, why, and what would prompt revisiting it.

---

## 2026-07-31 — Verification-pass item 1: employee account creation (the actual production blocker)

Closes the single most consequential gap the verification pass found:
`POST /employees` could create an `Employee` record but never a linked
`User` — every login-capable account in this entire build (CLI, Super
Admin dashboard) was for a company's first admin only. A pilot company's
admin had no way to onboard a second real person. Fixed by extending the
SAME endpoint (not a new one), mirroring the Super Admin dashboard's
create-company-and-admin flow: optional `email`/`role`/`locale` fields on
`CreateEmployeeDto` — providing `email` provisions a real `User`, linked
via the pre-existing (but previously never-set) `Employee.userId`
column, with a securely generated temp password shown once and emailed.

### `email` stays optional, not required — record-only creation is preserved

`Employee.userId` is nullable by schema design, and this build already
had four passing e2e tests creating employee RECORDS with no intent of
ever giving them logins. Rather than force every future `POST /employees`
caller to supply an email (breaking that precedent and forcing a
placeholder email onto e.g. a contractor who'll never use the system),
`email` stays optional: omit it for the old record-only behavior
(unchanged, still tested), provide it to also provision a login. `role`/
`locale` are only meaningful alongside `email` and are rejected with 400
if sent without it — validated as explicit service logic, not a
class-validator cross-field chain, for the same "read more clearly as
real code" reasoning already used elsewhere in this module.

### Manager account-creation reuses an EXISTING, already-tested RBAC precedent unchanged

The founder asked whether managers should be able to create employees at
all. They already could, in a narrow sense: `EmployeesService.create()`'s
`own_department` handling — forcing the new employee into the manager's
own department, rejecting an explicit mismatch — has existed since step
4/5, and `employee-management.e2e-spec.ts`'s "Manager cross-department
CRUD" suite already proved it, via a per-company `RolePermission` grant
the founder can add through the existing `/rbac/permissions` UI
(`employees:create`, scope `own_department` — deliberately NOT a
default-role-permissions.ts entry, matching how it already wasn't one).
Login-provisioning inherits this unchanged: a manager with that grant can
create a real employee login in their own department, but is hard-blocked
(403, structural check, not just "hidden in the UI") from ever setting
`role: "manager"` — only a `company_admin` (scope `"all"`) can grant the
manager role. Proven with real e2e tests for both the positive case
(manager creates a real employee login) and both negative cases
(role-escalation attempt; cross-department attempt).

### The welcome email is genuinely localized — unlike the Super Admin dashboard's

Deliberately different from `sendCompanyAdminWelcomeEmail`: this
recipient is a real pilot company's own staff member, who picks their own
language, not the founder. Added a new `employeeWelcome` key group to
`apps/api/src/i18n/{en,ar,ku}/emails.json` (subject/body/labels, real
Arabic and Sorani translations — same "machine/placeholder-quality,
needs a native-speaker review pass before launch" caveat already logged
for the rest of this app's translations, not a new one) and a small
`interpolate()` helper in `NotificationsService` (the first email in this
codebase whose translated strings carry runtime values — `{{name}}`/
`{{companyName}}` — every prior email either had no variables in its
translated text or built dynamic parts outside the translated string
entirely). The locale used is whichever the creating admin picks in the
form (defaulting to the company's own `localeDefault`) — the one point
before a brand-new employee's first login where their language
preference can plausibly be known at all, and also written to the new
`User.locale` value itself (previously write-never anywhere in this
codebase — a real, if incidental, first use of that column for its
actual purpose).

### Frontend: extends the Team page, not a new screen

No "add employee" UI existed anywhere before this — confirmed by the
verification pass. Built directly into `apps/web/src/app/team/page.tsx`
(the screen a company_admin/manager already uses for everything else
team-related), not a separate route: a toggleable `AddEmployeeForm`
component plus a one-time temp-password banner, matching the Super Admin
dashboard's identical display-once convention. `AddEmployeeForm` takes
`isAdmin` as a plain prop from the page (which already has a real session
via `useAuth()`) rather than reading `useAuth()` internally — a cleaner,
more testable shape that also sidesteps a real, if test-only, hazard
found while building the real-backend integration test: `AuthProvider`'s
own mount-time silent-refresh-on-mount effect races against and can wipe
out a directly-established test session (no real cookie jar in this
`fetch`/jsdom test environment), so components a test needs to drive
without going through the actual `/login` page are better off taking
auth-derived booleans as props than reading `useAuth()` themselves.
Localized in en/ar/ku (unlike the Super Admin dashboard) — this screen is
used by real company staff, not the founder alone.

### What's verified

Real backend, not mocked, both ends: `apps/api/test/
employee-account-creation.e2e-spec.ts` (12 tests) — record-only creation
still works unchanged, the full create→email→login→password-change→
real-self-service flow (a genuinely fresh employee clocking in and
submitting a real leave request, not a fixture), the role-grant RBAC
boundary (company_admin can grant manager, a manager cannot, proven
both ways), the department-scoping boundary reused from the existing
manager-creation precedent, and real Arabic email delivery via MailDev.
`apps/web/src/features/team/add-employee.integration.spec.tsx` (3
tests) — the actual form creating a real account with the on-screen and
emailed passwords confirmed byte-identical, the duplicate-email error
surfaced in the real UI, and record-only creation producing no password
banner. Full existing suites re-run clean afterward: backend 107 e2e +
130 unit tests, frontend 164 unit/component + 29 real-backend
integration tests (14 files) — no regressions. Real production `next
build` of the changed route succeeds.

---

## 2026-07-31 — Super Admin dashboard: frontend

Second chunk of the Super Admin dashboard (see the backend entry
directly below this one). One page, `/superadmin`: a company list,
a "New company" form, and a per-row Suspend/Reactivate toggle — matching
the three backend endpoints exactly, nothing added.

### English-only, confirmed and implemented as a genuine constraint, not just a default

The founder asked me to confirm the English-only reasoning made sense.
It does: this surface is used exclusively by the founder (the only
superadmin), never by a pilot company's employees, so there is no
audience for `ar`/`ku` content here at all. Implemented as an actual
constraint, not an accident of the current locale cookie defaulting to
"en": `SuperAdminDashboard.tsx` and `/superadmin/page.tsx` contain zero
calls to `useTranslation()`/`t()` — every string is a plain English
literal, and `formatDate()` is called with the "en" locale pinned
explicitly rather than reading the viewer's cookie. A superadmin who had
previously set an `ar`/`ku` locale cookie (e.g. from testing the rest of
the app) still sees this page fully in English. The page also uses its
own small header instead of the shared `AppNav` component, since
`AppNav` pulls in `LanguageSwitcher` and links to company-scoped pages
that don't apply to a superadmin session.

### A necessary side effect: superadmin now needs a real landing page

Before this pass, "superadmin" was a role that only ever acted via CLI —
nothing routed a superadmin session through the web login UI at all.
Giving it one for the first time exposed a real, immediate problem: the
existing post-login redirect target (`/`, the employee/manager
dashboard) renders `ClockWidget`/`LeaveBalanceWidget`/`HolidaysWidget`,
all of which assume a company-scoped session with a real `Employee`
record — a superadmin has neither. Fixed in `apps/web/src/app/page.tsx`:
a superadmin session is redirected to `/superadmin` immediately, before
any of those widgets render. This is a direct, unavoidable consequence
of this feature (not scope creep) — without it, the very first thing the
founder would see after using this new dashboard's login path is a page
full of error panels.

### Row-level bug found via the real-backend integration test, not by inspection

The Suspend/Reactivate button's handler originally called the same
`load()` function the initial page load uses, which sets the top-level
`loading` flag — that flag controls whether the ENTIRE company list
renders or gets replaced by the loading skeleton. Toggling a single
row's status therefore briefly unmounted and remounted the whole list on
every click, including the row just acted on. This didn't show up by
reading the code; it showed up as a real, reproducible timeout in
`superadmin.integration.spec.tsx` (a DOM reference held across the
update went stale once React tore down and rebuilt that list item) —
confirmed via a direct `curl` PATCH against the real dev API that the
backend update itself completed instantly, isolating the bug to the
frontend's re-render strategy. Fixed by patching just the affected row
in local state from the real PATCH response, instead of re-fetching and
re-rendering the whole list. Same bug would have caused a visible flicker
for a real user, not just a broken test.

### What's verified

Real backend, not mocked: `superadmin.integration.spec.tsx` (3 tests) —
create-company through the actual form (temp password banner rendered,
new row appears with the right status/employee count), suspend +
reactivate via the actual toggle button with the row updating in place,
and a duplicate-name submission surfacing the exact server error message
without silently returning to the list. Required adding a stable
superadmin login fixture to `seed-frontend-auth-fixtures.ts` (2FA
pre-enrolled, same fixed-secret convention as the existing
`company_admin` fixture) since no superadmin fixture existed before this
pass — no prior frontend test needed one. Full existing frontend suite
re-run clean afterward: 164 unit/component tests (37 files) and all 12
real-backend integration spec files (23 tests total, including this new
one) — no regressions from the `AppNav`/home-page routing changes.

---

## 2026-07-31 — Super Admin dashboard: backend (endpoints, guard, audit, suspend-blocks-login)

New scope, per the founder's explicit brief: replace the CLI-only
company/admin provisioning with a real, minimal web dashboard — three
endpoints (list companies, create company + first admin, suspend/
reactivate), superadmin-gated, tested. This entry covers the backend
chunk; the frontend UI is a separate entry once built. Several judgment
calls were delegated explicitly ("your call, document the reasoning") —
recorded below.

### A new, non-RBAC authorization path was required — RbacGuard doesn't fit

Every existing HTTP endpoint that checks authorization does it through
`@RequirePermission(module, action)` + `RbacGuard` + `PermissionCheckService`
— fundamentally a per-company RolePermission lookup. Superadmin sessions
have `companyId: null` and no tenant transaction ever opens for them
(`TenantScopeInterceptor` explicitly skips when there's no companyId —
its own comment already anticipated this: "must use PrismaSuperAdminService
directly, gated by a confirmed-superadmin check in the RBAC guard layer").
`RbacController` (the one other place a superadmin session was considered)
explicitly REJECTS `companyId: null` rather than trying to handle it —
there was no precedent to extend.

Built a new, deliberately separate mechanism instead of forcing this
through the tenant-scoped RBAC system: `@RequireSuperAdmin()` (a
`SetMetadata` marker, same shape as `@Public()`) + `SuperAdminGuard` (a
direct `request.user.role === "superadmin"` check), applied via
`@UseGuards(SuperAdminGuard)` at the controller level on the new
`SuperAdminController` — not registered globally in `app.module.ts`,
since it's only relevant to this one controller. It runs after the
global guard chain (Nest resolves global guards before controller-level
ones), so `request.user` is always populated by `AuthGuard` by the time
it runs. Deliberately fails CLOSED on a missing `@RequireSuperAdmin()`
(the opposite default from `@Public()`/`@RequirePermission()`) — this
controller has no legitimate non-superadmin route, so "undecorated"
should never mean "allowed." Proven with a real e2e test: a
`company_admin` token gets a clean 403 (not a 404, not a hang) on all
three routes, and no token at all gets 401.

### Audit logging bypasses `AuditService` — it structurally can't be used here

`AuditService.record()` writes through `TenantContextStorage`'s
transaction and THROWS if none exists — by design, so an audit entry and
the write it describes always commit or roll back together. Superadmin
operations use `PrismaSuperAdminService` directly; no tenant transaction
ever exists for them. Rather than weakening `AuditService`'s invariant
(e.g. making the tenant-context check optional) for the sake of one
caller, `SuperAdminService` writes `AuditLog` rows directly via the
superadmin connection. This is safe because `AuditLog.companyId` is
NOT nullable but is always concretely known at both call sites (the
just-created company's id; the target company's id for a status change)
— there's no case here needing a "no company yet" row. `userId` is the
acting superadmin's own id.

### Suspend/reactivate — endpoint scope vs. what login actually blocks

The founder asked explicitly whether "archived" (a third `CompanyStatus`
enum value, pre-existing in the schema) needs handling in this pass.
Decision: the suspend/reactivate ENDPOINT only ever accepts
`"active"`/`"suspended"` (`UpdateCompanyStatusDto` rejects `"archived"`
with a 400) — there's no UI or use case for archiving a company in this
pass, matching the founder's explicit scope boundary ("no editing beyond
status" implicitly means no new status semantics either). However, the
LOGIN-TIME check (`AuthService.rejectIfCompanyNotActive`) blocks ANY
non-`"active"` status, including a hypothetical `"archived"` row set
some other way (direct DB access, a future admin tool) — since the
status value is already in hand at that point and an inactive company's
users should never be able to log in regardless of which inactive state
caused it. Proven with a real e2e test that sets `status: "archived"`
directly via the superadmin connection (bypassing the dashboard
entirely) and confirms login is still refused.

RLS alone does NOT block a suspended company's users from logging in —
there is no tenant transaction/RLS context at all during the login
lookup (`PrismaAuthService`'s cross-tenant `hrms_auth` connection, used
specifically because the company isn't known yet). This was called out
explicitly in the founder's brief and implemented as an explicit check
(`AuthService.rejectIfCompanyNotActive`, using the superadmin connection
since there's nothing to scope the read to yet either), not assumed.
Runs BEFORE `resetFailedAttempts`/2FA — a blocked account shouldn't reset
lockout state or spend a 2FA round-trip. Verified live: suspending mid-
session doesn't revoke an already-issued access token (unchanged,
existing short-TTL behavior — same trade-off `MustChangePasswordGuard`'s
comment already documents for its own claim), but blocks every
subsequent login attempt with a specific, honest message
("...suspended..." vs. "...no longer active...").

### Welcome email: inline English strings, not the en/ar/ku emails.json structure

The founder asked me to decide between extending the existing
locale-keyed `i18n/{en,ar,ku}/emails.json` pattern (used by
`sendPasswordResetEmail`) or a simpler one-off, and to document the
reasoning. Went with a one-off: `NotificationsService
.sendCompanyAdminWelcomeEmail` has its English strings inlined directly,
not added to the emails.json files. Every other email in that class is
addressed to a company's own employees, who pick their own UI locale;
this one is addressed to a newly-created company_admin by the founder
(the only superadmin), announcing access to a dashboard surface that is
itself English-only by design (see below) — there is no real scenario
where this email is ever anything but English. Adding `ar`/`ku` keys
with no genuine translated content (or worse, English text copied under
those keys) would misrepresent it as localized when it structurally
never can be. If that ever changes, this should move into the
`TRANSLATIONS`-keyed pattern like `sendPasswordResetEmail`.

### Admin "name" is not persisted — used only to greet in the welcome email

The dashboard's create-company form collects "admin's name," but `User`
has no name column (names live on `Employee`, a separate model this
admin account has no row in — the CLI never created one either).
Decision: accept `adminName` in `CreateCompanyDto`, use it once to
personalize the welcome email's greeting, and don't persist it anywhere.
Adding a `User.fullName` column (or auto-creating an `Employee` row for
every company_admin) is a real, reasonable future extension if the
founder wants the name tracked/displayed elsewhere later, but wasn't
built now — out of scope per the founder's own "resist scope creep"
framing, and there's no existing consumer of a company_admin's display
name anywhere in the app today.

### Rate limiting: no new code needed

The founder asked to flag rate limiting "if any [unauthenticated
surface] exists." It doesn't: every route on `SuperAdminController`
requires a valid access token (no `@Public()` anywhere in this module),
so `GeneralApiThrottlerGuard` — already global, already covering every
authenticated route — applies here automatically. No new throttler was
added.

### What's verified vs. not

Fully verified against the real dev stack: all three endpoints, the
RBAC 403/401 boundary, suspend/reactivate + the login-blocking check
(including the "archived, set outside the dashboard" case), the
create-company flow end-to-end through real MailDev delivery (confirming
the emailed and on-screen temp password values are byte-identical), and
a freshly created company_admin completing mandatory 2FA enrollment +
mandatory password change and then using the system normally
(`GET /auth/me`) — see `apps/api/test/superadmin.e2e-spec.ts` (15
tests). Full existing e2e suite (95 tests, 12 files) and unit suite (130
tests) re-run clean afterward — no regressions from the `AuthService
.login()` change. Frontend dashboard UI is the next chunk, not yet
built.

---

## 2026-07-30 — CI follow-up: the earlier payroll timeout fix missed a second, backend-side test waiting on the same job

The item-8 CI entry's "fifth issue" fixed `apps/web/src/features/payroll/
payslips.integration.spec.tsx`'s timeout, reasoning that a slower CI
runner needed more headroom for BullMQ payslip-PDF generation. A
SEPARATE re-run of the exact same CI commit failed again, in the same
job, on `apps/api/test/payroll.e2e-spec.ts` — a different file, in a
different app, waiting on the SAME underlying job, that never got the
same fix because it's a different test entirely. Founder caught this
and correctly identified it as a real, reproducible gap, not more
flakiness — confirmed by reading the actual failure: `"the run reaches
'finalized'..."` timed out at Jest's default 5000ms, and the other two
failures in that file were downstream of that one never reaching
"finalized," not independent problems.

### Root cause: the test's own internal retry budget already exceeded Jest's default timeout, even locally

`waitForRunStatus`'s default (30 attempts × 300ms = 9000ms) was ALREADY
longer than Jest's un-overridden default per-test timeout (5000ms) —
this was a latent bug on any machine, not something that only appears
on a slow CI runner. It happened not to matter locally because the real
PDF job usually finishes well under 5s here. Fixed with an explicit
per-test timeout (30000ms, the third argument to `it(...)`) on just
this one test — not a global Jest config change, per the founder's
explicit instruction: this is a legitimately long-running async wait on
a real background job, not a sign of a hung test, and other tests
shouldn't get a longer default just because this one needs it. Also
bumped `waitForRunStatus`'s own default budget to 80 attempts (24s), so
the inner retry loop and the outer Jest ceiling both have real margin,
not one barely covering the other.

### Verified by actually simulating a slow CI runner, not just re-running fast

Per the founder's explicit instruction not to "push and hope": added a
TEMPORARY, env-var-gated artificial delay
(`TEST_SLOW_PDF_MS`) directly inside `PayrollPdfService.processRun` —
the actual method both the queue-driven job and a direct re-invocation
call — ran the suite with a genuinely aggressive 20-second injected
delay (not a token amount), confirmed both affected tests completed
in ~20s with real margin under their new 30s budgets, then fully
reverted the temporary hook (`git diff` confirmed zero trace left).

This stress test caught a SECOND real gap that hadn't manifested in
the actual CI failure yet: `"PDF generation is idempotent..."` directly
calls `payrollPdfService.processRun()` a second time (bypassing the
queue, to test the job's own idempotency guard) and ALSO had no
explicit timeout — under the injected 20s delay it independently hit
the same 5000ms default, not merely as a downstream consequence of the
first test failing. In the real CI run this hadn't been observed
because the FIRST test already failed the precondition it depends on
(a finalized run) before this one's own timing could matter — but the
underlying weakness was real and would have surfaced on its own under
different timing. Given explicit evidence (not speculation) that this
exact call can take 20+ seconds under slow conditions, added the same
30s explicit timeout here too.

### Verification

Full backend e2e suite (11 files/80 tests) re-run twice under NORMAL
(non-stressed) conditions after reverting the temporary delay — stable
both times. Pushed and confirmed the real GitHub Actions run, not just
the local repro, per the founder's explicit instruction.

---

## 2026-07-30 — Infrastructure pass, item 6: Error + uptime monitoring

`@sentry/node` (`apps/api/src/monitoring/sentry.ts`, wired into
`main.ts`'s bootstrap and `GlobalExceptionFilter`) and `@sentry/nextjs`
(`apps/web/src/instrumentation.ts` + `instrumentation-client.ts` +
`global-error.tsx`) — both **deliberately inactive** (`SENTRY_DSN`/
`NEXT_PUBLIC_SENTRY_DSN` unset everywhere right now) per the founder's
explicit deferral: they understand the Sentry free tier requires no
card, but are holding off creating the account to avoid a context-
switch. Code-complete; activates via one env var once they do, no code
change.

### Verified against real, self-hosted GlitchTip — not just "doesn't crash without a DSN"

Same reasoning as MailDev (email) and MinIO (S3 storage) elsewhere in
this pass: GlitchTip is open-source, Sentry-protocol-compatible, and
self-hostable, so this could be verified for real without needing the
founder's deferred Sentry account. Stood up a real GlitchTip instance
(Postgres + Redis + web + worker, all in Docker), created a real
organization/project/DSN via its Django management shell (no web UI
click-through available in this environment), and confirmed BOTH apps'
wiring end-to-end:

- **`apps/api`**: called the actual `initSentry()` + `Sentry.captureException`
  code path `GlobalExceptionFilter` uses, with a real DSN — the error
  appeared as a real GlitchTip Issue with the exact message thrown.
- **`apps/web`**: harder to verify — a raw Node/tsx script calling
  `@sentry/nextjs`'s exports directly failed (`Sentry.captureException
  is not a function`), because that package's server/client conditional
  exports only resolve correctly through Next.js's own bundler/runtime,
  not a plain `import()` outside it. Verified instead through the REAL
  runtime: temporarily added a gated (`THROW_TEST_ERROR=1`) throw to the
  one genuine Server Component in this app (`layout.tsx` — every actual
  page is `"use client"`, confirmed by grep before relying on this),
  built and ran the real standalone production server with a real DSN,
  hit it with a real HTTP request, got a real 500, and confirmed the
  exact error landed in GlitchTip via `instrumentation.ts`'s
  `onRequestError` hook. Reverted the temporary throw immediately after
  — never landed in a commit.

GlitchTip's worker needed to be started as a SEPARATE process from its
web container for events to actually get processed (not just accepted
by the ingest endpoint) — the first attempt looked like it worked
(`Sentry.flush()` returned `true`, meaning the HTTP POST succeeded) but
no Issue appeared until a worker was actually consuming the queue. A
reminder that "the SDK reported success" and "the server actually
processed and stored it" are different claims — checked both.

### Fixed three real build-time warnings, not suppressed

`@sentry/nextjs`'s build wrapper (`withSentryConfig` in `next.config.ts`)
surfaced three actionable issues on the first real build: a deprecated
config option (`disableLogger` → `webpack.treeshake.removeDebugLogging`),
a missing `onRouterTransitionStart` export needed for navigation
instrumentation, and a missing `global-error.tsx` for React render-error
capture. Fixed all three properly (not via the suppression env var
Sentry itself offers) — `global-error.tsx` in particular is genuinely
valuable, not just warning-silencing: it's the only way this app
captures React render errors specifically, as opposed to the
request/exception-level errors `GlobalExceptionFilter`
(`apps/api`)/`onRequestError` (`apps/web`) already handle.

### Scope: errors only, not performance/tracing

`tracesSampleRate: 0` on both SDKs — this pass is "capture real errors,"
not a full APM/tracing setup nobody asked for. `onRouterTransitionStart`
is wired (removes a build warning) but is a no-op in practice given the
0% trace sample rate.

### Uptime monitoring: no code, a recommendation instead

Genuinely different from error monitoring — an uptime checker needs a
real public URL to poll, which doesn't exist until a real domain is
deployed (item 4's Caddy config is ready, but real DNS/hosting doesn't
exist yet either). Nothing to build: `GET /api/health` (`apps/api`,
already exists, already `@Public()`) and `GET /` (`apps/web`) are both
already suitable targets. Recommend UptimeRobot's free tier (50
monitors, 5-minute checks, no card required) once a real domain exists
— pick this up as part of whatever session actually deploys to a real
domain, not now.

### Verification

Full backend unit suite (21 files/130 tests) and e2e suite (11
files/80 tests) re-run green after wiring `Sentry.captureException`
into `GlobalExceptionFilter`. Full frontend suite re-run green after
reverting the temporary test throw. GlitchTip infrastructure and the
temporary throw both fully torn down/reverted — nothing from this
verification pass persists in the codebase or running environment.

---

## 2026-07-30 — Infrastructure pass, item 5: Automated backups

`scripts/backup-postgres.sh` / `scripts/restore-postgres.sh` — plain
bash, not Node/ts-node like this project's other admin scripts,
deliberately: these run unattended from cron on the VPS host and need
to work without a `pnpm install`/current `node_modules` being present.
`pg_dump`/`psql` (via `docker compose exec` into the running `postgres`
service) and `mc` (the MinIO client — downloaded once, cached; works
against real AWS S3, DigitalOcean Spaces, or MinIO, since all speak the
same S3 API) are the only two tools required.

### Scheduling: host crontab, not a Docker sidecar

One plain script + one crontab line, not an always-on backup container
— matches this project's "don't over-engineer" standard, and a cron
job that can fail loudly to a log file is simpler to reason about at
3am than a container that needs its own restart/health semantics for
something that only needs to run once a day.

### Verified with a REAL backup and a REAL restore onto a genuinely empty Postgres cluster — not "backups exist"

Ran a real `pg_dump` against the actual dev database (6 companies, real
seeded data), uploaded it to a real local MinIO bucket (same
reasoning as item 7 — self-hosted, zero external account, real S3 API,
not assumed compatible), then restored it onto a **completely separate,
freshly-created Postgres container** (not the same database it came
from — that wouldn't prove anything) and confirmed the row counts and
schema matched.

### Real, non-obvious bug found by that restore: role-scoped RLS policies/grants silently failed on first attempt

The first restore attempt "succeeded" (exit code 0, "Restore complete")
but scrolled past dozens of `ERROR: role "hrms_app"/"hrms_superadmin"/
"hrms_auth" does not exist` — `psql` doesn't stop on individual
statement errors by default, so a cursory glance at "did it exit
cleanly" would have missed this entirely. Checked what actually
survived: the core `tenant_isolation` RLS policy and all real data were
present, but the `hrms_auth`-specific policies
(`auth_lockout_update`/`auth_lookup_select`) were silently missing.
Root cause: `pg_dump` captures exactly one DATABASE's contents; Postgres
ROLES are CLUSTER-level objects, never included in a database dump —
restoring onto a cluster that doesn't already have `hrms_app`/
`hrms_superadmin`/`hrms_auth` created means every GRANT and role-scoped
POLICY statement in the dump references a role that doesn't exist yet,
and fails individually while the rest of the script keeps going.
Confirmed the fix by re-testing on a truly fresh cluster in the correct
order — `prisma migrate deploy` + `db:bootstrap-roles` FIRST (creating
the roles), restore SECOND — and this time `grep -i error` on the full
restore output came back empty, with all three policies on `User`
present and correct. `restore-postgres.sh`'s own header comment carries
the full explanation and correct command order, not just README.md,
since a real disaster-recovery scenario is exactly the moment someone
is least likely to go looking for a separate doc.

### Retention and off-VPS storage

14-day retention (`mc rm --older-than`), configurable via
`RETENTION_DAYS`. Off-VPS storage is the SAME deferred-DigitalOcean-
Spaces situation as item 7 — the scripts are code-complete and really
verified against MinIO, but no real bucket exists yet per the founder's
explicit cost-driven deferral. A real deployment needs a real bucket
before the daily cron job has anywhere real to upload to; until then,
backups aren't actually scheduled anywhere production-real, which is
consistent with there being no real production deployment yet either.

---

## 2026-07-30 — Infrastructure pass, item 7: File storage (S3-compatible backend)

`S3StorageService` (`common/storage/s3-storage.service.ts`) implements
the existing `StorageService` interface using `@aws-sdk/client-s3` —
works against real AWS S3, DigitalOcean Spaces, or any other
S3-API-compatible service, differing only by configured endpoint/
credentials. **Code-complete and REALLY tested, but deliberately NOT
the active backend anywhere** — local disk remains active in dev, test,
CI, and this project's production compose stack, per the founder's
explicit, cost-driven deferral of DigitalOcean Spaces (see the earlier
"deliberately deferred" entry). Switching a real deployment is exactly
one env var (`STORAGE_DRIVER=s3` + the `S3_*` values), not a code
change — the whole point of building to the existing interface.

### Verified against real MinIO, not just typechecked — same reasoning as choosing MailDev for email

A self-hosted, zero-external-account, real S3-API-compatible target —
avoids needing to create (and eventually pay for) a real DigitalOcean
Spaces bucket just to prove the CODE works, exactly the same logic
already applied to MailDev over Mailtrap for email. `test/
s3-storage.manual-spec.ts` proves real save/read/exists/delete against
a real running MinIO container — deliberately named `*.manual-spec.ts`,
not `*.e2e-spec.ts`, so it's NOT picked up by the standard `pnpm
test:e2e`/CI run (neither dev's `docker-compose.yml` nor CI runs a MinIO
service — adding one as a permanent dependency of the routine suite
isn't justified for a backend that isn't active anywhere yet). Run
explicitly via `pnpm --filter @hrms/api test:s3-storage` — the file's
own header comment has the exact `docker run` commands.

### Real bug found by that verification: `GetObject`'s "not found" error has a different shape than `HeadObject`'s

`read()`'s original error handling checked `instanceof NotFound` — the
AWS SDK v3's typed error class, but one specifically shaped for
`HeadObjectCommand`'s 404 response (which is why `exists()`'s bare
`catch` already worked fine). `GetObjectCommand`'s real "missing key"
response is a differently-named error (`NoSuchKey`), so the "genuinely
missing key throws our own `NotFoundException`" test failed against
real MinIO with the SDK's raw message instead. Fixed by checking
`error instanceof S3ServiceException && error.$metadata.httpStatusCode
=== 404` — the HTTP status code, not a specific named error class, is
what's actually guaranteed consistent across `GetObject` vs
`HeadObject` AND across providers (AWS S3/MinIO/DigitalOcean Spaces),
none of which are guaranteed to shape their "not found" XML identically.

### One bucket, key-prefixed, not two buckets

`LocalDiskStorageService` uses two separate root directories
(`DOCUMENT_STORAGE_PATH`/`PAYSLIP_STORAGE_PATH`) for the same logical
separation `S3StorageService` achieves via a `keyPrefix` constructor
option (`"documents"`/`"payslips"`) within ONE configured bucket —
matches how a single DigitalOcean Spaces bucket is typically organized
(folders, not multiple paid buckets) rather than requiring two separate
bucket names/credentials for what's still one deployment.

### Shared `createStorageService()` factory, not duplicated branching in both modules

`DocumentsModule` and `PayrollModule` each bind `STORAGE_SERVICE` via
their own `useFactory`, previously both directly instantiating
`LocalDiskStorageService`. `common/storage/storage.factory.ts` now
centralizes the local-vs-s3 decision (reading `STORAGE_DRIVER`, default
`"local"`) in one place both modules call, rather than duplicating the
branch. `S3_*` env vars are deliberately OPTIONAL at the Zod schema
level — required only via `getOrThrow()` inside the factory, and only
reached when `STORAGE_DRIVER=s3` is actually selected, so a local-disk
deployment (every environment right now) never needs dummy S3 values
just to pass boot-time validation. Verified this fails LOUDLY and
immediately (not silently/lazily) when misconfigured, via a dedicated
unit test (`storage.factory.spec.ts`).

### Verification

`storage.factory.spec.ts` (4 unit tests: correct class per driver,
throws immediately on missing S3 config) and `s3-storage.manual-spec.ts`
(5 tests against real MinIO, all passing after the `NoSuchKey` fix)
both green. Full backend unit suite (21 files/130 tests) and e2e suite
(11 files/80 tests) re-run green after wiring the shared factory into
both consuming modules — confirms `LocalDiskStorageService` remains
correctly active by default, unaffected by this change.

---

## 2026-07-30 — Infrastructure pass, item 4: Reverse proxy + TLS (Caddy)

`docker-compose.prod.yml` (distinct from the dev-only root
`docker-compose.yml`) + `Caddyfile`, built on top of item 3's
Dockerfiles. Postgres/Redis have no published host ports in this file
(only reachable from other containers on the compose network — real
production shouldn't expose either to the host/internet at all); Caddy
is the only thing bound to 80/443.

### Caddy over Nginx

Automatic HTTPS — a real Let's Encrypt certificate for a real public
domain, or an automatic internal-CA certificate when none exists yet
(`{$DOMAIN:localhost}` in the Caddyfile) — in about 40 lines total, no
certbot/cron-renewal machinery to operate. Matches this project's
"don't over-engineer" standard at solo-dev scale better than Nginx +
certbot's more numerous moving parts.

### Same-origin architecture: the frontend calls a relative `/api` path, not an absolute URL

Caddy routes `/api/*` to the `api` service and everything else to
`web`, both from the SAME public origin. `NEXT_PUBLIC_API_URL` is a
Next.js build-time constant (inlined into the client bundle, not
readable at runtime — a real framework constraint, not an oversight),
so `docker-compose.prod.yml` passes it as a Docker build ARG set to the
literal string `/api`. Verified this is safe before relying on it: grepped
every `apiFetch`/`resolveApiUrl` call site and confirmed every one lives
inside a `"use client"` component (browser-only, never server-rendered)
— a relative string passed to the browser's own `fetch()` resolves
against `window.location` automatically; Node's server-side `fetch()`
would have thrown on a relative URL, which is why this needed checking
before assuming it was safe, not after.

### General API-wide rate limiting: moved to the app level, not Caddy

The architecture spec's original suggestion — rate limiting at the
proxy layer — turned out to need a non-stock Caddy build. `caddy:2-alpine`
has no `rate_limit` directive at all; it ships from the third-party
`caddy-ratelimit` plugin, which requires compiling a custom image via
`xcaddy`. Confirmed by actually running `caddy validate` against the
stock image (`unrecognized directive: rate_limit`), not assumed from
Caddy's docs. Real ongoing build/maintenance complexity, for a solo
founder, purely to relocate protection this project already has working
and tested (`@nestjs/throttler`) into a different layer for its own
sake — not justified. Implemented instead as a global `APP_GUARD` in
`AppModule` (`GENERAL_API_RATE_LIMIT`, default 300/60s per IP,
per-endpoint — see below for why "per-endpoint" and not "one shared
budget for the whole API").

### Two real, non-obvious `@nestjs/throttler` bugs found wiring this up

1. **`ThrottlerModule` is internally `@Global()`.** A second, separate
   `.forRootAsync()` call in `AppModule` (alongside AuthModule's
   existing one for "authLogin"/"authStrict") silently collided on the
   same global provider tokens instead of coexisting — whichever
   registration "wins" is the only one any `ThrottlerGuard` anywhere in
   the app actually sees. Result: AuthController's existing, already-
   shipped, already-tested throttling on login/password-reset/2FA
   **stopped firing entirely** (real e2e test failures — `rate-
   limiting.e2e-spec.ts` expected 429s and got 401s instead — not a
   hypothetical). Fixed by consolidating into ONE registration (now
   living in `AppModule`, since it's global anyway), with all three
   named throttlers together; `AuthModule` no longer registers
   `ThrottlerModule` itself, only references the shared names via its
   existing `@Throttle()`/`@SkipThrottle()` decorators.
2. **A plain `ThrottlerGuard` used as a global `APP_GUARD` would have
   throttled the ENTIRE API to 5-10 requests/min.** The guard applies
   every throttler registered in its scope to every route it covers —
   for a global guard, that's every route in the app, including
   AuthController's much stricter "authLogin"(10)/"authStrict"(5)
   limits, meant only for three specific routes. Fixed with a thin
   `GeneralApiThrottlerGuard` subclass (`common/guards/
   general-api-throttler.guard.ts`) that filters `this.throttlers` down
   to only `"generalApi"` after the base class populates it — the only
   way found to make one guard enforce a DIFFERENT subset of a shared
   registration than another. Verified with a dedicated test
   (`general-rate-limiting.e2e-spec.ts`) that overrides
   `GENERAL_API_RATE_LIMIT` to 8 for its own app instance and asserts a
   real 429 at request 9 on a plain `/health` call — specifically NOT
   at request 6 (which is what `authStrict`'s limit would produce if
   the filtering silently broke), so this test would catch a regression
   in either direction, not just "did it throttle at all."

Consequence of the per-handler keying this library uses (confirmed
earlier in the original rate-limiting pass): "general API-wide" means
every ENDPOINT independently gets its own 300/60s budget from a given
IP, not one shared counter across the whole API surface — heavy
legitimate use of one endpoint can never accidentally throttle a
different one. Considered this the more sensible interpretation, not
just an artifact of the library's design.

### Two real bugs found only by actually deploying the full stack locally, not by reading the compose file back

1. **A DB password containing `/`/`+` broke Prisma's connection-string
   parser** (`P1013: invalid port number in database URL`) the moment a
   freshly-generated password was actually plugged into a real
   `DATABASE_URL`. Plain base64 isn't URL-safe. Fixed
   `generate-production-secrets.ts` to use base64URL specifically for
   the four DB passwords (which get embedded in connection strings) —
   every other secret stays plain base64 (unaffected, never URL-parsed).
2. **`.dockerignore` pattern semantics differ from `.gitignore` in a way
   that leaked real secrets into a built image.** A bare pattern (no
   `**/` prefix) only matches at the build context ROOT, not at any
   depth — the version written for item 3 excluded a hypothetical root
   `.env` but did NOT exclude `apps/api/.env`, `apps/api/.env.test`, or
   `apps/api/.env.production`, which all got copied directly into a
   built image layer, including this project's own real generated
   production secrets. Found by literally listing a built image's
   contents (`docker run ... find /workspace -iname '.env*'`), not by
   reading the ignore file back — this class of bug is specifically the
   kind that "looks right" on inspection. Fixed by rewriting every
   pattern with an explicit `**/` prefix. **The specific secrets
   generated and used for this local verification were displayed in
   tool output during this session and must be treated as compromised
   — a real deployment must generate its own, never reuse these.**
3. **`docker compose` auto-loads a root-level `.env` for `${VAR}`
   substitution regardless of which compose file is run with `-f`.**
   This project already has a root `.env` (dev's Postgres credentials,
   used by the separate dev `docker-compose.yml`) — running
   `docker-compose.prod.yml` without an explicit `--env-file` silently
   pulled DEV's `POSTGRES_PASSWORD` in for the PROD compose file's own
   variable substitution, a completely different mechanism from
   `apps/api/.env.production`'s `env_file:` (which only supplies the
   `api` service's own runtime environment, not compose-file-level
   substitution). A real deployment needs to be aware this is two
   separate mechanisms with two separate files, or pass `--env-file`
   explicitly — noted here since it's exactly the kind of thing that
   works by accident in a quick test and fails confusingly for real.

### Verification

Full local production deployment, for real: built both images fresh,
ran migrations + role bootstrap + seed via a dedicated one-off container
(the build stage, which still has the Prisma CLI the runtime image
deliberately excludes), brought up Postgres/Redis/api/web/Caddy
together, and confirmed through the actual proxy over HTTPS (Caddy's
internal CA, `curl -k`): a real page loads (200), HTTP→HTTPS redirect
works automatically (308), all security headers present (HSTS, CSP,
X-Content-Type-Options, Referrer-Policy), `/api/*` correctly reaches the
API (real login, real Postgres round-trip, real JWT), and static JS
assets serve through the proxy too. Confirmed the final runtime images
contain zero `.env*` files after the dockerignore fix. **Not verified
this session**: real Let's Encrypt certificate issuance (needs a real
public domain + DNS, which doesn't exist yet) and actual browser-side
JS execution/CSP-violation-free interactivity (no headless browser
available) — both flagged explicitly rather than assumed working;
recommend one real manual browser click-through once a real domain
exists, low risk given the CSP's `'unsafe-inline'` is deliberately
permissive for exactly this reason. Full backend unit + e2e suites
re-run green after all app-level changes (`AppModule`/`AuthModule`
throttler consolidation).

---

## 2026-07-30 — Infrastructure pass, item 3: Production Dockerfiles

`apps/api/Dockerfile` and `apps/web/Dockerfile` — multi-stage builds,
non-root user, no dev dependencies or TypeScript source in the final
image. Both actually built (`docker build`) and actually run
(`docker run`, real requests against real running containers) before
being considered done — every issue below was found that way, not by
reading the Dockerfile back.

### `apps/api`: `pnpm deploy --prod`, not a hand-rolled prod-only install

pnpm workspace `node_modules` are symlink-heavy (into a shared
content-addressable store) — copying that verbatim across Docker build
stages breaks the symlinks' absolute targets. `pnpm deploy --prod`
materializes a real, non-symlinked, production-only dependency tree for
exactly one workspace package (no devDependencies — no jest/ts-node/
@nestjs/cli/typescript, and no `@hrms/shared`, which is a devDependency
here, imported by exactly one test file and no runtime code path,
verified by grep before relying on that). Confirmed working with a
standalone local test (outside Docker) before writing the Dockerfile
around it.

### `apps/api` bug: `pnpm deploy` silently produced a stub Prisma client

The image built successfully and looked fine, but crashed at container
startup: `TypeError: client_1.Prisma.Decimal is not a constructor`.
Root cause: `pnpm deploy` does a FRESH dependency resolution into its
target directory, not a copy of the build stage's already-`prisma
generate`-d `node_modules` — `@prisma/client`'s own postinstall hook
runs again there, can't find `schema.prisma` relative to the new
location, and silently falls back to Prisma's own placeholder client
(`default-index.ts`) instead of erroring loudly. Confirmed by literally
diffing the deployed `.prisma/client/index.js` (65 lines, the stub)
against a real generated one (500+ lines) — the build log gives zero
indication this happened; typechecking is unaffected since `.d.ts`
files are unrelated to this. Also found, empirically: `prisma generate`
resolves WHERE to write the client by walking up from the **schema
file's own location** looking for `node_modules` — not from the
process's cwd. Pointing `--schema` at the original source copy (even
while `cd`'d into the deploy output) is a no-op for the deploy tree; the
schema file has to physically exist inside the deployed directory for
the walk-up to land there. Fixed by copying `schema.prisma` into the
deploy output first, then regenerating against that copy specifically,
using the build stage's own `prisma` CLI (a devDependency, deliberately
absent from the deployed tree itself, but the stage that produced that
tree still has it).

### `apps/web`: Next.js `output: "standalone"`, not `pnpm deploy`

Unlike `apps/api`, Next's own build-time file tracer already produces a
minimal, self-contained `node_modules` subset when `output:
"standalone"` is set (`next.config.ts`) — adding `pnpm deploy` on top
would be redundant with, and untested against, Next's own mechanism.
Verified locally OUTSIDE Docker first: built with `output:"standalone"`,
manually copied `.next/static`/`public` into the standalone tree per
Next's own documented requirement (standalone output does NOT include
these automatically), ran `node server.js`, confirmed both a real page
and a real static JS chunk served correctly — only then written into
the Dockerfile.

**Nesting subtlety, found by testing**: in a monorepo, standalone
output nests as `apps/web/server.js` (mirroring the workspace layout),
with `node_modules` split across two levels — a hoisted root copy and a
package-local copy — that Node's own directory walk-up resolves
correctly only if that exact relative nesting is preserved. Copying just
the `apps/web` subtree in isolation (flattening it to the image root)
would silently break module resolution for anything hoisted to the root
level; copying the whole `.next/standalone` tree and keeping `WORKDIR`
nested to match (`/app/apps/web`) is what makes it work.

**`NEXT_PUBLIC_API_URL` is a genuine Next.js constraint, not an
oversight**: `NEXT_PUBLIC_*` vars are inlined into the client bundle at
BUILD time, not read at runtime — `apps/web/src/lib/api-client.ts`'s
`process.env.NEXT_PUBLIC_API_URL` becomes a literal string baked into
the JS the browser downloads. Exposed as a Docker `ARG` so a real
deployment can pass its real API origin at build time. The actually
-correct long-term fix is a same-origin reverse proxy (item 4, next) so
the frontend can use a relative `/api` path and never need to know the
API's real URL at build time at all — noted here so the `ARG` isn't
mistaken for the final design, just what's needed until item 4 exists.

### `.dockerignore` bug: an over-broad pattern excluded real source code

Modeled after `.gitignore`'s `/storage/` (the root-level runtime
uploads directory), but added an extra unanchored `**/storage/` line
intending to also match nested cases — except `apps/api/src/common/
storage/` (the actual `StorageService` interface + `LocalDiskStorageService`
source, real application code) matched too, and the build failed with
"Cannot find module" errors for files that genuinely exist on disk.
Fixed by keeping only the leading-slash-anchored `/storage/`, matching
`.gitignore`'s own already-correct pattern exactly rather than "improving"
it. Found immediately by running `docker build`, not by reading the
`.dockerignore` back and reasoning about glob semantics.

### Verification

Both images actually built and actually run: `apps/api`'s image
connected to the real dev-compose Postgres/Redis/MailDev over the
`hrms_default` Docker network and handled a real login (real Argon2id
check, real Postgres query, real JWT issuance); `apps/web`'s image
served a real page and a real static asset. Image sizes: ~447MB
(`apps/api`), ~339MB (`apps/web`) — reasonable for Node+Prisma and
Node+Next respectively, not optimized further since neither is
excessive. Test containers/images cleaned up afterward.

---

## 2026-07-30 — Infrastructure pass: DigitalOcean Spaces and Sentry deliberately deferred (cost/context-switch, not forgotten)

At kickoff of the infrastructure pass, the founder made two explicit
scope calls, recorded here so neither reads as an oversight later:

- **DigitalOcean Spaces (items 5, backups, and 7, file storage) held
  off.** Real recurring cost (~$5/mo minimum) that the founder does not
  want to start incurring before this is closer to an actual pilot
  deployment. `StorageService`'s S3-compatible implementation is being
  built and kept ready against the existing interface (see the file
  storage entry once written), but no bucket exists, no credentials
  exist, and local disk stays the ACTIVE backend for documents/payslips
  — unchanged from every prior step of this build. Revisit once a real
  deployment is imminent; wiring in real credentials at that point is a
  config change, not a code change, by design.
- **Sentry (item 6, error monitoring) held off**, despite the free tier
  genuinely requiring no card — purely to avoid a context-switch away
  from the current work. SDK wiring is being built and kept in place
  (present in code, not actively configured to send anywhere), ready to
  activate the moment the founder creates an account and shares a DSN.

Both are cost/attention decisions belonging to the founder, not
technical blockers — noted explicitly per their own instruction not to
let either look like something forgotten.

---

## 2026-07-30 — Infrastructure pass, item 8: CI (GitHub Actions)

`.github/workflows/ci.yml` — four jobs on every push/PR: `lint-typecheck`,
`backend-unit` (no services needed — confirmed no unit spec touches a
real Postgres connection), `backend-e2e` (real Postgres/Redis/MailDev
service containers, full role-bootstrap/RLS-verification sequence from
README.md, then the real e2e suite), and `frontend` (builds and boots a
real API instance, seeds the frontend's stable fixture accounts, then
runs `apps/web`'s suite against it — its `*.integration.spec.tsx` files
hit real HTTP, matching this project's no-mocking philosophy for the
frontend too, not just the backend).

No GitHub remote existed before this pass (zero commits, in fact — see
the separate note on the initial commit). Repo created by the founder;
pushed the initial commit and this workflow directly per their explicit
instruction.

### Four real bugs found by the first few actual CI runs — none guessable from local-only testing

Every prior step this session ran real infrastructure locally before
calling anything done; CI is the first time this project's code has run
on infrastructure this session never touched (a clean checkout, a
different OS, ephemeral fresh containers with no accumulated local
state). That gap surfaced four genuine bugs on the first three runs,
none of them CI-configuration typos in the trivial sense — each is a
real fact about the app or its test suite that local runs never had a
chance to expose:

1. **`lint-typecheck` never ran `prisma generate`.** Without it,
   `@prisma/client`'s generated types don't exist, and
   `@typescript-eslint`'s type-aware `no-unsafe-*` rules degrade to
   treating every Prisma-touching value as `any` — 10 false errors
   across files nobody touched this pass (`tenant-scope.interceptor.ts`,
   `seed.ts`, `rbac.guard.ts`, `global-exception.filter.ts`,
   `current-permission-scope.decorator.ts`). Every other job already ran
   `prisma generate`; this job was the one gap. Fixed by adding it.

2. **MailDev's image ships a broken Docker `HEALTHCHECK`, and GitHub
   Actions waits on it.** `docker ps` had already shown this container
   reporting "unhealthy" in local dev all session (a known, previously
   accepted cosmetic quirk, since the actual REST API worked fine
   locally) — but GitHub Actions' service-container startup genuinely
   blocks on a container's Docker-level health status and fails the job
   if it never turns healthy, which local dev never cared about. Fixing
   this took two attempts: the first override (`wget --spider
   http://localhost:1080/`) failed identically to the broken default.
   Traced by exec'ing into the actual running container and testing
   directly (`docker exec ... wget ...`, then `netstat` inside the
   container): the app listens on port 1080 **IPv4-only**
   (`0.0.0.0:1080`), but `localhost` resolves to IPv6 (`::1`) first
   inside this image, which has nothing listening there — "Connection
   refused." Using `127.0.0.1` explicitly fixed it. Verified by testing
   the exact command inside the container before changing the workflow,
   not by guessing and re-pushing repeatedly.

3. **`password-reset-delivery.e2e-spec.ts` hardcodes `expect(mail.from[0]
   .address).toBe("no-reply@hrms.test")`** — matching `.env.test`'s exact
   value. CI's `backend-e2e` job doesn't read `.env.test` at all (no such
   file exists in a fresh CI checkout — gitignored, never committed); it
   sets env vars directly via the workflow's own `env:` block, and that
   block had invented its own CI-specific `EMAIL_FROM`
   (`no-reply@hrms.ci`) instead of matching `.env.test`'s real value.
   Fixed by setting CI's `EMAIL_FROM` to the literal same value
   `.env.test` uses — the correct mental model is "CI's `backend-e2e`
   job env stands in for `.env.test`," not "CI gets its own arbitrary
   values wherever a test happens not to assert on the exact string."

4. **A genuinely latent bug in `leave-approvals.integration.spec.tsx`**,
   masked by this project's own shared local dev database having
   accumulated stray pending-approval state over the session: `await
   screen.findByText(/Pending leave approvals|No pending leave
   requests\./, ...)` throws `TestingLibraryElementError: Found multiple
   elements` whenever the queue is GENUINELY empty, because the static
   heading ("Pending leave approvals," always rendered) and the empty
   state message ("No pending leave requests.") are BOTH present in the
   DOM simultaneously in that case — `findByText` requires exactly one
   match. Locally this never fired because the dev DB was never actually
   empty of pending approvals by the time this test ran. CI's genuinely
   fresh, empty database exposed it immediately. Fixed by replacing the
   ambiguous either/or `findByText` with a `waitFor` using
   `queryByText`/`querySelector` (which tolerate zero-or-many matches),
   checking for either signal without asserting exact-one-match
   semantics — the real intent was "wait until loading has settled,"
   which doesn't require picking exactly one of two simultaneously-valid
   signals.

### How these were diagnosed without a GitHub-authenticated log viewer

Unauthenticated `curl`/`WebFetch` against the GitHub Actions API can read
run/job status and check-run annotations for a public repo, but NOT
download full job logs (`403 — Must have admin rights`), and
`WebFetch`'s HTML-to-markdown rendering of the Actions UI didn't
reliably surface full jest output either (JS-rendered content). `gh` CLI
isn't installed in this environment. For bug #4 specifically (no useful
annotation text at all, just "Process completed with exit code 1"),
reproduced the exact failure by spinning up fresh, isolated Postgres/
Redis/MailDev containers on non-conflicting local ports and running the
EXACT command sequence from the workflow file against them with the
same env values — this surfaced the real jest/vitest output directly,
without needing GitHub's log UI at all, and is arguably a more reliable
diagnostic method than log-scraping would have been anyway.

### A fifth issue: `waitForFinalized`'s timeout, genuinely CI-runner-specific

After the four bugs above were fixed, `backend-e2e` passed for real, but
`frontend` still failed — `payslips.integration.spec.tsx` timed out
waiting for a payroll run to reach `"finalized"` (BullMQ payslip-PDF
generation) within its 30s retry budget. Unlike the previous four, this
one did NOT reproduce locally — ran the exact failing test alone, then
the entire 48-file suite, twice, against fresh isolated containers and
a production-built server: 184/184 pass every time, the payroll test
finishing in ~1-4s. This is a genuine hardware/resource difference
between this dev machine and GitHub's shared runners, not a structural
bug — treated accordingly rather than chased further locally. Bumped
`waitForFinalized`'s budget from 100 attempts (30s) to 250 (75s),
comfortably under the outer test's own 120s timeout, as reasonable
headroom for a slower CI runner.

### Verification

Each fix verified against the same local reproduction before pushing,
then confirmed for real against actual GitHub-hosted runners (not just
assumed from the local repro) via the Actions API. Local reproduction
containers torn down and normal dev environment restored afterward.

---

## 2026-07-30 — Infrastructure pass, item 2: Production secrets generation

`pnpm --filter @hrms/api cli:generate-production-secrets`
(`src/database/seeds/generate-production-secrets.ts`, following the same
one-off-CLI-script convention as `bootstrap-roles.ts`/`create-company.ts`)
prints every secret a real deployment needs, freshly random on each run:
the three Postgres role passwords, `POSTGRES_PASSWORD`, and the five
32+-byte app secrets (`JWT_ACCESS_SECRET`, `PASSWORD_RESET_SECRET`,
`TWO_FACTOR_PENDING_SECRET`, `DOCUMENT_URL_SECRET`, `PAYSLIP_URL_SECRET`),
plus a correctly-formatted `FIELD_ENCRYPTION_KEY` (a genuine
base64-encoded 32-byte value via Node's `crypto.randomBytes`, not just a
long string — this one has to be exactly right or field
encryption/decryption breaks).

Pure generation, no side effects — doesn't touch any database or write
any file itself. Deliberately NOT auto-writing `.env.production`
directly: the founder still needs to fill in deployment-specific,
non-generatable values (real hostnames, `CORS_ORIGINS`, `FRONTEND_URL`,
SMTP provider credentials) by hand regardless, so a copy-paste-then-edit
workflow against the new `apps/api/.env.production.example` template is
simpler than a script that half-writes a file the founder must then
finish editing anyway.

**Core rule, stated explicitly in both the script's own output and
`.env.production.example`'s header**: never copy a value from
`.env`/`.env.test`/`.env.example` into a real `.env.production` — every
environment's secrets must be independently generated. This is the same
reasoning already established for why `JWT_ACCESS_SECRET` and
`TWO_FACTOR_PENDING_SECRET` are deliberately different secrets from each
other (a compromise of one token type should never cascade into
another) — extended here across environments, not just across token
purposes within one environment.

Run once per real deployment, not once for the whole project — noted in
the README's new "Production secrets" section alongside the existing
"Getting started" sequence.

---

## 2026-07-30 — Infrastructure pass, item 1: Config hygiene — `envFilePath` keyed to `NODE_ENV`

First item of the infrastructure pass, carried forward explicitly from
the rate-limiting/password-reset pass: `ConfigModule.forRoot()` had no
`envFilePath`, so it silently defaulted to loading plain `.env` (dev)
from cwd regardless of `NODE_ENV` — the root cause of the
`AUTH_LOGIN_RATE_LIMIT` bleed-through bug found and worked around (by
mirroring the var into `.env.test`) in the previous pass. This entry is
the proper fix, not another workaround — and turned into a real
investigation with two genuine findings, not a one-line change.

### The straightforward part: `resolveEnvFilePath(NODE_ENV)`

`env.validation.ts` now exports `resolveEnvFilePath`, mapping
`development` → `.env`, `test` → `.env.test`, `production` →
`.env.production`. `app.module.ts` passes this to
`ConfigModule.forRoot({ envFilePath: ... })`. Straightforward, but not
sufficient on its own — see below.

### The real finding: Prisma's generated client has its OWN independent `.env` auto-loader, invisible to `NODE_ENV`

Verified via direct instrumentation (checkpointed `console.log`s around
each import), not assumed: merely `import`ing `@prisma/client` —
before `AppModule`, before `ConfigModule.forRoot()` ever runs — already
had dev's `.env` values in `process.env`. Confirmed in
`@prisma/client/runtime/library.js`: the generated client's own
constructor calls an internal `tryLoadEnv({rootEnvPath, schemaEnvPath})`
that dotenv-loads whatever `.env` file was baked in relative to
`schema.prisma` at `prisma generate` time — completely independent of
`NODE_ENV`, `ConfigModule`, or anything else in this app. Since dotenv's
default behavior is "never override an already-set `process.env` key,"
whichever loader runs FIRST wins for any given key — and Prisma's
auto-load runs the moment `@prisma/client` is first `require`d, which
happens as soon as `AppModule`'s own import chain touches `PrismaModule`
— i.e., before `ConfigModule.forRoot()`'s factory body (which lives
inside the SAME module's `imports` array) ever gets a chance to run its
own load.

**Fix**: whichever entrypoint runs first must explicitly load the
correct file BEFORE anything ever touches `@prisma/client`, winning the
race deliberately instead of hoping `ConfigModule` gets there first (it
can't):
- `test/setup-env.ts` (Jest `setupFiles`, guaranteed to run before any
  test file's own imports) explicitly `dotenv`-loads `.env.test` itself,
  not just setting `NODE_ENV` and trusting `ConfigModule` to load it
  later (an intermediate version of this fix tried exactly that
  "set NODE_ENV only" approach and failed a real test — see below).
- `src/bootstrap-env.ts` (NEW) does the equivalent for the real app —
  `main.ts`'s first import, before `reflect-metadata` or `NestFactory`,
  loading `resolveEnvFilePath(process.env.NODE_ENV)` explicitly.
- `ConfigModule.forRoot({ envFilePath: ... })` is kept too, as
  defense-in-depth and self-documentation — by the time it runs the
  correct values are normally already in `process.env` from one of the
  above, making this a harmless no-op in practice, but it's what makes
  `ConfigService`'s own internal store correctly reflect them.

`dotenv` (removed from `apps/api/package.json` as apparently-unused
right after the previous pass's `setup-env.ts` simplification) had to be
re-added — a direct sign, in hindsight, that the "just set NODE_ENV"
simplification had removed real functionality, not dead code.

### The honest limit of what's achievable: a var that exists ONLY in `.env`, with no `.env.test` counterpart, cannot be fully isolated

Built `test/env-isolation.e2e-spec.ts` to prove the fix, initially with
a canary var (`DEV_ONLY_ENV_ISOLATION_CANARY`) that existed ONLY in
`.env`, asserting it stayed `undefined` under `NODE_ENV=test`. It
failed — consistently, even after the fix above. Root cause: the fix
makes `.env.test`'s load win the race FOR KEYS `.env.test` ACTUALLY
SETS (dotenv's "don't override" protects a key that's already there).
A key present ONLY in `.env`, absent from `.env.test` entirely, has
NOTHING to race against — `.env.test`'s load never touches it, so when
Prisma's own auto-load eventually runs (at `PrismaClient`
instantiation, later in the same process), it freely sets it, since
nothing set it first. This is a structural property of Prisma's client,
not a bug in this app's config code, and there is no documented Prisma
option to disable its auto-load.

Rather than paper over this with a workaround, adjusted the test (and
this entry) to state the ACTUALLY-achievable, ACTUALLY-real guarantee:
a var that legitimately differs between environments, defined
EXPLICITLY in both `.env` and `.env.test` (already this project's
established convention — see e.g. `.env.test`'s own comments on
`PASSWORD_RESET_TTL`), resolves to the correct environment's value. This
is exactly what broke in the original `AUTH_LOGIN_RATE_LIMIT` incident
and exactly what's now fixed and tested — `ENV_ISOLATION_CANARY` exists
in both files with deliberately different values (`dev-value` /
`test-value`), and the test asserts the test value wins. **Practical
consequence for future env vars**: a new var MUST be added to every
relevant env file explicitly, never left dev-only "for now" — leaving it
dev-only doesn't just risk it being unset elsewhere, it GUARANTEES the
dev value eventually leaks in via Prisma regardless of `NODE_ENV`.

### A second real bug, found only because this investigation made a test fail fast: unhandled `'error'` events on BullMQ's Redis connections

`env-isolation.e2e-spec.ts`'s minimal `beforeAll`/`afterAll` (essentially
just `app.init()` then almost immediately `app.close()`, far faster than
any other e2e file, which all do real fixture setup/HTTP work in
between) crashed the entire Jest process with `Unhandled error:
Connection is closed`, traced to BullMQ's internals. Root cause, found
by reading `PayrollWorkerService`/`PayrollQueueService`: neither ever
attached an `.on("error", ...)` listener to their own raw `IORedis`
connections or (for the worker) the `Worker` instance itself — only
`.on("failed", ...)` for job failures. Node's `EventEmitter` throws
(crashing the whole process) when an `"error"` event fires with no
listener. This is a REAL production risk, not just a test artifact: any
genuine Redis connection blip in production — not just an artificially
fast test teardown — would have crashed the entire API process instead
of logging and continuing. Fixed by adding `.on("error", ...)` handlers
(logging via each service's own `Logger`) to `PayrollQueueService`'s
connection+queue and `PayrollWorkerService`'s connection+worker. A
narrower remaining race in BullMQ's own internal `blockingConnection`
setup (only reproducible by closing the app within milliseconds of
creating it — not a realistic shutdown scenario) was resolved by having
`env-isolation.e2e-spec.ts` do one real request before closing, matching
every other e2e file's natural pattern, rather than chasing further into
third-party library internals for a race that doesn't reflect real
production timing.

### Verification

Full backend e2e suite (10 files — 9 pre-existing + this pass's new
`env-isolation.e2e-spec.ts` — 79 tests), full backend unit suite (20
files, 126 tests), and the full frontend suite all re-run green. Real
dev server (`pnpm run dev`, not just Jest) restarted fresh and confirmed
booting cleanly with `bootstrap-env.ts` in place, `GET /api/health`
responding correctly.

---

## 2026-07-29 — Post-9: Rate limiting on auth endpoints (`@nestjs/throttler`)

First of two closure items from the production-readiness inventory review
(the other is real password-reset delivery — separate entry below). Wired
in `@nestjs/throttler` (already a dependency, previously unused) on
exactly three endpoints, per the founder's explicit scope: `POST /auth/
login`, `POST /auth/password-reset/request`, `POST /auth/2fa/verify`.

### Scoped to these three routes only — no global/app-wide rate limit added

`ThrottlerModule.forRoot(...)` is registered in `AuthModule`, not
`AppModule`, and `ThrottlerGuard` is applied per-route via `@UseGuards()` +
`@Throttle()` on each of the three handlers — **not** registered as a
global `APP_GUARD`. A general API-wide rate limit was deliberately left
out of scope for this pass: the architecture spec already places that at
the reverse-proxy layer ("All API endpoints behind a reverse proxy
(Nginx/Caddy) with rate limiting at the proxy layer, before requests even
reach the app") — that's part of the upcoming infrastructure pass, not
this one. Adding a second, app-level general limit now would mean two
overlapping systems to keep in sync later; this pass is specifically the
defense-in-depth layer for the three endpoints that have no proxy in
front of them yet in dev, and would still be worth keeping even once one
exists in production.

### Limits: 10/60s for login, 5/60s for password-reset/request and 2fa/verify — IP-based (the library's default tracker, `req.ip`)

Login gets the looser of the two because it's the ONLY one of the three
endpoints that already has an independent defense: `LockoutService`
(step 3) locks a specific ACCOUNT after 5 consecutive wrong-password
attempts, exponential backoff up to 24h, regardless of source IP. The IP
throttle here guards a different axis — total REQUEST VOLUME from one IP,
regardless of which account(s) it's aimed at (credential stuffing across
many emails, or a raw brute-force script). Set deliberately looser than
the lockout's own 5-attempt threshold so a legitimate user mistyping a
password twice, or several people on a shared office/NAT IP logging in
around the same moment, is never what trips it.

`password-reset/request` and `2fa/verify` get the stricter 5/60s because,
unlike login, **neither has any other defense at all**:
- `password-reset/request` has no lockout concept (nothing is being
  authenticated) — IP throttling is the only thing standing between an
  attacker and either spamming a real user's inbox with reset links or
  extracting an account-existence timing signal despite the intentionally
  identical response body.
- `2fa/verify` has no tracking of repeated wrong TOTP codes at all — only
  the `pendingToken`'s own `TWO_FACTOR_PENDING_TTL` (5 minutes) bounds the
  attack window. Unthrottled, 5 minutes is enough for thousands of guesses
  against a 6-digit code's ~1,000,000-value space; 5/min caps a single IP
  at ~25 guesses per pendingToken lifetime — trivial for the 1-2 attempts
  a real user needs, hostile to brute force.

### Verified the two systems (lockout + throttle) genuinely coexist, not just "probably fine" — one combined e2e test proves both in the same request sequence

`test/rate-limiting.e2e-spec.ts`'s first test sends 5 wrong-password
requests against ONE real fixture account (confirms `failedLoginAttempts
=== 5` and `lockedUntil` set in the DB — the lockout fired), then a 6th
request with the CORRECT password (still a generic 401 — lockout state is
never leaked to the caller, consistent with this module's existing
account-existence-hiding posture). The second test continues from there
(same IP, same 60s window, same app instance) with 4 more requests against
DIFFERENT nonexistent accounts, bringing the cumulative total to exactly
10 (still allowed), then an 11th that gets a real 429 — proving the two
mechanisms don't fight each other: the account-level block and the
IP-level block both fired, independently, in the same short sequence,
each for its own reason. `password-reset/request` and `2fa/verify` each
get their own simple "5 allowed, 6th throttled" test. All four re-run
twice consecutively to confirm no cross-run state leakage (fresh app
instance per Jest run resets in-memory throttle storage; unique `runId`
per run avoids DB fixture collisions) — both runs, all 4 tests, green.

### Dedicated e2e file, not folded into `security.e2e-spec.ts`

`ThrottlerModule`'s default storage is in-memory PER APP INSTANCE, keyed
by `(controller, handler, IP)`. `security.e2e-spec.ts` creates one app
instance shared across many unrelated tests that also call `/auth/login`
in their own setup — adding throttle-exhausting tests there risked later,
unrelated tests in that same file unexpectedly hitting 429 instead of
their actual expected status, purely from accumulated request count
within the same 60s window. A dedicated file with its own app instance
sidesteps this entirely — genuinely necessary, not just tidiness (this
would have been a real, confusing source of flakiness if not separated).

### In-memory throttle storage, not Redis-backed — accepted for the current single-instance deployment target

`@nestjs/throttler`'s default storage keeps counters in the Node
process's own memory, which is correct for exactly one thing: a single
app instance. This matches the current deployment target (one VPS, one
API process, per the project plan) — Redis is already in this stack for
BullMQ, so a Redis-backed throttler storage adapter is a straightforward
future swap if the API is ever horizontally scaled, but wasn't added now
since it isn't needed yet and would be one more moving part with no
current benefit. Revisit if/when a second API instance is ever run.

### Not added: a frontend `TooManyRequestsError` class for 429 specifically

`api-client.ts`'s `classifyError()` has no 429 branch — a throttled
response currently falls through to the generic `ApiError` base class
(status < 500, so not `ServerError` either), which the login/reset/2FA
screens already render via their existing catch-all error handling. Not
explicitly asked for in this pass; noted here as a reasonable small
follow-up (a distinct "Too many attempts, try again in a moment" message
would be a nicer UX than the current generic fallback) rather than built
speculatively.

### Follow-up fix: limits made env-configurable, after they broke this project's own real-backend frontend integration suite

Running the full `apps/web` test suite (containing ~16 files that log in
for real against the actual dev API server — this project's standard
"no mocking" testing philosophy) against the hardcoded 10/60s login
limit surfaced a real conflict: legitimate, sequential integration-test
traffic from ONE machine tripped the SAME control meant for attackers.
Production's correct values are fine for a real user's browser; they're
wrong for a test harness that legitimately needs to log in more than 10
times a minute against a long-running dev server. Two real bugs found
and fixed while resolving this, both by actually running the suites, not
by inspection:

1. **`AuthModule` now uses `ThrottlerModule.forRootAsync` with two named
   throttlers** (`authLogin`, `authStrict`), limits read from new env
   vars `AUTH_LOGIN_RATE_LIMIT` / `AUTH_STRICT_RATE_LIMIT` (schema
   defaults 10/5, matching the values above). Routes reference a name
   via `@Throttle({ authLogin: {} })` (empty override — limit/ttl come
   from the module config, not duplicated per-route). Dev's `.env` sets
   these much higher (200/100) so the real integration suite has
   headroom; `.env.test`/`.env.example` keep the strict, production-
   realistic defaults.
2. **Discovered `@nestjs/throttler`'s guard applies EVERY registered
   named throttler to EVERY guarded route**, not just the one named in
   that route's `@Throttle()` — `@Throttle()` only overrides a given
   name's limit/ttl if that throttler already applies; it doesn't select
   which throttlers run. Without realizing this, the login route was
   also being bound by `authStrict`'s tighter 5/60s limit (tripping at
   request 6, not 10) — caught by a failing e2e test right after the
   refactor, not by reading the docs closely enough the first time.
   Fixed by adding an explicit `@SkipThrottle({ authStrict: true })` (and
   the mirror on the two strict routes) to each handler — each route now
   explicitly opts out of the throttler it doesn't want, rather than
   relying on an incorrect assumption that unnamed routes are implicitly
   excluded.
3. **Also found a related `.env` bleed-through**: `ConfigModule.forRoot()`
   has no explicit `envFilePath`, so it defaults to loading
   `apps/api/.env` (dev) from cwd — layered ON TOP of `.env.test` (which
   `test/setup-env.ts` loads separately, earlier, via its own `dotenv`
   call). Every PREVIOUS env var happened to be defined in both files, so
   `.env.test`'s value always won (dotenv doesn't override already-set
   vars). The two new rate-limit vars were the first to exist only in
   `.env` — e2e tests silently received dev's 200/100 instead of the
   intended 10/5, and the "trips a real 429" assertions stopped firing.
   Fixed by adding both vars explicitly to `.env.test`/`.env.test.example`
   too, matching this project's existing "test env is always explicit,
   never relies on schema defaults" convention (see `PASSWORD_RESET_TTL`
   etc. in the same file). Flagging this bootstrap quirk here since it
   could recur for any future env var added only to dev's `.env` without
   a matching `.env.test` entry — worth fixing properly (an
   `envFilePath` keyed to `NODE_ENV`) in the infrastructure pass, not
   patched further piecemeal here.

Full backend e2e suite (9 files/77 tests) and full frontend suite
re-verified green after both fixes.

---

## 2026-07-29 — Post-9: Real password-reset email delivery (`nodemailer` + SMTP, MailDev for verification)

Second of the two closure items from the production-readiness inventory
review. `AuthService.requestPasswordReset()` previously only issued a
reset token and logged the link server-side — nothing was ever actually
emailed. Added a minimal `NotificationsModule` and wired it into the
existing token flow so the link now reaches a real inbox.

### `nodemailer` over SMTP, not a provider-specific SDK (e.g. SendGrid/Postmark/SES SDKs)

Chosen for a solo-dev budget: nodemailer talks plain SMTP, so the
provider is just a set of env vars (`SMTP_HOST`/`PORT`/`SECURE`/`USER`/
`PASSWORD`/`EMAIL_FROM`), not a vendor SDK baked into the code. Swapping
providers later (Mailgun, SES, a cheap transactional-email plan, or the
company's own mail server) is a config change in production, not a code
change — consistent with the existing `StorageService`/`EMAIL_SERVICE`
provider-interface pattern already used for documents/payslips. A
provider SDK might offer richer features (bounce webhooks, analytics)
later, but none of that is needed for "the reset link reaches the
inbox," and every major provider still exposes SMTP as a fallback, so
this doesn't lock out a future upgrade.

### `EmailService`/`EMAIL_SERVICE` interface + `SmtpEmailService` implementation, mirroring `StorageService`

`src/common/email/email.interface.ts` defines `EmailService.send(message)`
and an `EMAIL_SERVICE` DI token; `SmtpEmailService` is the only current
implementation. `NotificationsService` (the actual caller) depends only
on the interface, not on nodemailer directly — the same separation the
codebase already uses for local-disk vs future S3 storage. Kept
deliberately thin: one interface method (`send`), not a grab-bag of
provider-specific options.

### `NotificationsService`: one method per notification type, not a generic "send(template, data)" dispatcher

`sendPasswordResetEmail(to, locale, resetLink)` is the only method today.
Explicitly NOT built as a generic templated-notification engine (no
template registry, no generic payload shape) — the founder's own framing
was "doesn't need to cover every future type... structure the module so
other types can be added later without rearchitecting." A generic
dispatcher would be speculative design for notification types that don't
exist yet (leave-approval emails, etc.); adding those later means adding
one more method to this service, following the same pattern, not
restructuring anything that exists now.

### Verification: local MailDev catcher (docker-compose service), not Mailtrap

Chose MailDev (`docker-compose.yml` service `maildev`, image
`maildev/maildev:latest`, SMTP on 1025 no-auth, web UI + REST API on
1080) over a hosted inbox service like Mailtrap specifically to avoid
requiring any external account, API key, or credential for a solo
developer to verify this — `docker compose up -d maildev` and it's ready,
consistent with the rest of the dev stack (Postgres/Redis also run as
docker-compose services, no external accounts). The founder's instruction
allowed either "a real test-inbox service... or clearly document how you
verified delivery if you use a different approach" — this is that
documentation. MailDev's REST API (`GET /api/email`, `GET /api/email/
:id/html`, `DELETE /api/email/:id`) is exercised directly by
`test/password-reset-delivery.e2e-spec.ts`, the same way a human
checking the web UI would, not simulated or mocked.

### `test/password-reset-delivery.e2e-spec.ts`: genuinely end-to-end, not "email object was constructed"

The test polls MailDev's real inbox after a real `POST /auth/
password-reset/request`, asserts real subject/from values, extracts the
real reset link via regex from the real HTML body, pulls the real token
out of that link's query string, and drives the real `POST /auth/
password-reset/confirm` + `POST /auth/login` calls with it — proving the
new password logs in and the old one no longer does. A second test
confirms a request for a nonexistent email produces zero emails (not
just an identical HTTP response — the existing account-existence-hiding
behavior extends to the SMTP layer too, not only the API response body).
Dedicated app instance/file, same reasoning as
`rate-limiting.e2e-spec.ts` — avoids polluting other e2e files' shared
app instances. Re-ran twice consecutively to confirm reliability; both
runs green.

### Link points at the web app's `/reset-password?token=` page, not the bare API endpoint

`FRONTEND_URL` (new env var, defaults to `http://localhost:3000`) builds
the link a human actually clicks in their email client. The bare API
route is POST-only and does nothing useful if a browser navigates to it
directly — `apps/web/src/app/reset-password/page.tsx` (already existing
from earlier frontend work) reads `?token=` and performs the POST
itself. Deliberately a distinct config value from `CORS_ORIGINS` (that
answers "who may call this API"; `FRONTEND_URL` answers "where does a
human land").

### Password-reset emails render in the visitor's REQUEST-TIME locale, not `user.locale` — `user.locale` is unusable, not merely unread

First shipped as "English-only for now, revisit once `user.locale` is
populated" — the founder correctly flagged that against the build
brief's requirement that backend-generated content render in the
employee's own language, and asked for either a real fix or a real
justification for deferring. Re-verified both blockers against actual
code (not memory) before deciding: (1) `hrms_auth`'s Postgres role has a
column-level `GRANT SELECT` that does not include `locale`
(`add_hrms_auth_role` migration); (2) even setting that aside, a full
grep of `apps/api/src` turned up zero writers of `User.locale` anywhere
— no profile endpoint, no login flow, nothing. It would always read back
the schema default (`"en"`), for every user, forever. Reading it
wouldn't have fixed anything; it would have created the appearance of
localization while silently doing nothing — worse than the honest
English-only state it would have "fixed."

Also corrected a claim in the original version of this entry: this isn't
"the same pattern as every other locale-aware piece of this build."
Checked — no backend endpoint had ever accepted or used a locale value
before this. Every existing locale-aware screen is rendered entirely
client-side from a cookie (`hrms_locale`) the backend never sees. This
email is the first backend-generated, locale-sensitive content in the
whole system.

**Fix implemented**: `PasswordResetRequestDto` gained an optional
`locale` field (`@IsIn(LOCALES)`, defaults to `"en"` if absent/invalid).
`forgot-password/page.tsx` — the page the visitor is actively viewing
when they submit this request — sends its own current `useTranslation()`
locale (the same cookie-backed value already driving that page's own
rendering) in the request body. `AuthService.requestPasswordReset()` now
threads that value through to `NotificationsService` instead of a
hardcoded default. This is request-scoped, not persisted — correct for
an unauthenticated endpoint with no prior session, and it doesn't touch
the `hrms_auth` grant or depend on the separate, still-open
frontend-locale-to-`User.locale` sync gap. Genuinely more accurate than
`user.locale` would have been even if it worked, since it reflects the
language the visitor is demonstrably using right now rather than a
stored value that may be stale or (currently) never set at all.

Verified real, not just unit-tested: `test/password-reset-delivery.e2e-spec.ts`
now includes a test that requests a reset with `locale: "ar"` and
confirms the REAL email arriving in MailDev has the real Arabic subject
line from `src/i18n/ar/emails.json` and `dir="rtl"`/`lang="ar"` in the
HTML — not an English default. Full backend e2e suite (9 files, 77
tests) and frontend unit suite re-run green after this change.

Proper persisted per-user locale (synced from the frontend cookie into
`User.locale` on login/profile update, with `hrms_auth`'s grant extended
to match) remains a separate, real gap — relevant to authenticated
in-app screens generating server-side content in the future (e.g.
payslip PDFs, still English-only per the production-readiness
inventory), not to this endpoint anymore.

### Bug caught by real infrastructure, not code review: `z.coerce.boolean()` on `SMTP_SECURE`

Initial schema used `z.coerce.boolean().default(false)`. With
`SMTP_SECURE=false` (string) in `.env`, this silently evaluated to
`true` — `z.coerce.boolean()` calls JS's `Boolean(str)`, and
`Boolean("false")` is `true` (any non-empty string is truthy). Result:
nodemailer attempted implicit TLS against MailDev's plaintext-only port
1025, failing with `SSL routines:ssl3_get_record:wrong version number`
on every real send attempt — masked in earlier stages because nothing
had exercised this code path with a live SMTP connection before. Fixed
with `z.enum(["true","false"]).default("false").transform(v => v ===
"true")`, which only ever evaluates the literal string, not JS
truthiness. Found by actually running the flow against real
infrastructure (per this project's standing rule of no mocked
integration tests), not by inspection — logged here as a concrete
example of why that rule pays for itself.

### `emails.json` locale parity now tested (`src/i18n/locale-parity.spec.ts`)

The en/ar/ku `emails.json` files were step-1 scaffolding, never actually
rendered by any code until this pass made `passwordReset` load-bearing
for the first time. No test had ever verified the three stayed in sync.
Added a unit test using `@hrms/shared`'s existing `checkLocaleParity()`
(the same helper `apps/web/src/locales/locale-parity.spec.ts` already
uses for the frontend's locale files) — same mechanism, applied to the
backend's own i18n directory. `@hrms/shared` added as an `apps/api`
devDependency for this.

---

## 2026-07-29 — Post-batch: team-list scoping question raised and resolved (clarification, not a fix)

The founder's review of this batch's summary flagged "Team list rendering
`GET /employees` unfiltered" (9.5) as ambiguous enough to need an explicit
security confirmation before approving. Reasonable to ask — "unfiltered"
was underspecified in that summary. Confirmed precisely, re-verifying the
actual code rather than trusting memory: `GET /employees` IS
department-scoped server-side, identically to every other manager-facing
endpoint — `EmployeesController.list()` passes `@CurrentPermissionScope()`
straight to `EmployeesService.findMany()`, whose `scopeWhere()` narrows to
`{ departmentId: managedDepartmentId }` for `own_department` scope (the
manager's resolved scope per the default RBAC matrix). "Unfiltered" meant
"the frontend adds no additional client-side filtering on top of that,"
matching `team-api.ts`'s own comment — not "the endpoint returns the whole
company." This exact guarantee was ALSO already proven twice over, not
newly discovered as a gap: a step-4 backend e2e test
(`security.e2e-spec.ts`, "manager's employee list includes only employees
in their managed department") predates this batch entirely, and this
batch's own `team.integration.spec.tsx` proves the same thing against the
real rendered frontend. Both re-run on request to confirm, both still
green. No code change — recorded here because a security-adjacent
question that reached "needs explicit confirmation before approval"
deserves a paper trail even when the answer is "already correct," not
just when something needed fixing.

---

## 2026-07-29 — Step 9.6: Manager leave approvals + org chart

### `GET /leave-requests/preview` and a new `GET /leave-balances` (team-facing) — both needed so an approver isn't reviewing blind

Two real gaps surfaced building this screen, both fixed before the
frontend could even call them:
1. `preview` was gated `leave:create` (fine when only the employee submit
   form used it, in 9.3) — a manager has `leave:view` +
   `leave:approve` but structurally never `leave:create` (approving isn't
   submitting), so the approvals screen would have gotten a 403 trying to
   show the same working-days context the employee saw. Re-gated to
   `leave:view`, the common denominator every role that can see a
   request at all already holds.
2. There was no way for a manager/admin to see an EMPLOYEE's leave
   balance at all — `GET /leave-balances/me` is self-only, and no
   team-facing equivalent existed. Added `GET /leave-balances?employeeId=
   ...`, gated `leave:view`, using the same `isVisible` department-scope
   check every other team-facing read in this app already uses (proven
   with a real e2e assertion: a manager gets the in-department employee's
   real balance array, and an empty array — not an error — for one
   outside their department, matching `teamRequests`'s own established
   "empty array for out-of-scope" convention rather than a 403).

### A real, previously-unenforced requirement: a caller's own pending request must not appear in the approval queue AT ALL, not just be unapprovable

Before this step, `LeaveRequestsService.teamRequests()` had no
self-exclusion — `loadForDecision` already blocked the approve/reject
ACTION on your own request (step 7), but nothing stopped it from showing
up in the LIST itself. This was invisible until the frontend's approvals
screen made it concretely observable. Fixed by adding `employee: { userId:
{ not: callerId } }` to both of `teamRequests()`'s query branches (the
explicit-`employeeId` branch and the scope-resolved branch) — a caller
never sees their own request in ANY team/approval listing now, company-
wide, not just when reviewing pending ones specifically. Proven two ways:
a new backend e2e assertion (an admin's own submitted request is absent
from their own `GET /leave-requests?status=pending`), and a real-backend
frontend integration test (same scenario, through the actual
`LeaveApprovals` component). Confirmed via the underlying fixture
constraint that this scenario is structurally rarer for a MANAGER than an
admin: managers never hold `leave:create` in the default matrix, so a
manager can never submit their own leave request in the first place —
this scenario is real only for company_admin (whose `fullAccess` grant
includes both), which is exactly what step 7's original e2e test already
exercised. The frontend integration test for this therefore authenticates
as the admin fixture, not the manager one, to actually produce the
scenario being tested.

### Org chart confirmed company-wide by design, not a scoping gap — investigated as instructed, not assumed either way

Re-verified against the actual code, not just the step-5 comment: `org:
view` really is granted at scope `"all"` for BOTH `manager` and
`company_admin` in `default-role-permissions.ts` (with that file's own
comment explaining why: "seeing the org chart is a different thing from
acting on employees within it"), and `DepartmentService.orgChart()`
genuinely queries every department in the company with no scope
narrowing at all. This is the intended step-5 design, not an
oversight — so the frontend renders the full tree exactly as returned,
with no client-side narrowing. Proven concretely, not just read from
comments: a real-backend integration test logs in as the MANAGER fixture
and confirms the response includes the second department from step 9.5's
fixtures — one that manager does NOT manage and has no `employees:edit`
reach into at all — alongside their own. A plain employee (no `org:view`
grant whatsoever) gets a real 403 calling this endpoint directly,
confirmed the same way; `AppNav` already omits the link for that role,
but that's a convenience, not the boundary.

### The API dev server died mid-session, unrelated to any of this step's code

Discovered when an integration test suddenly got `ECONNREFUSED`
(connection actively refused, not a timeout) instead of any HTTP
response — checked `netstat`, confirmed nothing was listening on :3001
at all, while Postgres/Redis (Docker) stayed healthy throughout. Not
traced to a specific cause (no crash captured in the visible task log by
the time this was noticed) — restarted cleanly with `pnpm run dev`,
confirmed healthy via `/api/health`, then confirmed the specific
integration test that had failed now passes, twice. Documenting rather
than treating as a non-event: this is a real-infrastructure dev server,
and it can and did die independent of any change made in this session —
worth remembering as a first troubleshooting step ("is the server even
running?") before assuming a code regression when an integration test
suddenly fails with a connection-level error rather than an assertion
failure.

---

## 2026-07-29 — Step 9.3: Leave (Employee)

### New backend endpoint: `GET /leave-requests/preview`

Wraps the exact `countWorkingDays` + `company.weekendDays` +
holiday-calendar logic `LeaveRequestsService.approve()` already used —
extracted into `previewWorkingDays()`, called by both `approve()` and the
new endpoint, so there's one calculation, not two maintained in parallel.
Pure read (no request/balance touched), gated on the same
`@RequirePermission("leave", "create")` as `submit()` since this IS the
pre-submit step, not a separate read concern. 3 new e2e tests (correct
count for a known weekend+holiday range, 400 on end-before-start, 401
unauthenticated).

### Submission errors show the REAL server message for conflict/validation cases — a deliberate departure from 9.1's fixed-translation approach

9.1's auth screens map a small, FINITE set of expected failures to fully
translated copy (see that step's DECISIONS entry) — deliberately never
surfacing raw backend English. Leave submission can't follow that pattern
for the two cases that matter most (insufficient balance, overlapping
request): the backend's message is dynamic — `"Insufficient leave
balance: requesting 5 working day(s), 3 remaining."` embeds real computed
numbers that can't be pre-translated into a fixed Arabic/Sorani string
ahead of time. `LeaveSubmitForm` shows `error.message` verbatim for
`ConflictError`/`ValidationError`, falling back to the translated generic
message for everything else. This means an Arabic/Sorani session can see
one raw English sentence inside an otherwise fully-localized screen —
an accepted, deliberate trade-off, not an oversight, and worth
revisiting only if/when the backend itself starts returning
locale-aware messages (out of scope now — see step 9.1's "backend errors
are English-only" entry, still the prevailing rule everywhere else).

### `ErrorState` gained a fourth kind: `"conflict"`

Extends the `forbidden`/`notFound`/`generic` classification from step 9.0
with `ConflictError` -> a fourth `common.errors.conflict.{title,message}`
pair, no retry offered (same as forbidden/notFound — retrying an
unmodified conflict can't change the outcome). Used for whole-widget LOAD
failures that happen to be conflicts; the leave submit FORM's own inline
error display (above) is separate and shows the raw dynamic message
instead, for the reason described there.

### Shared `AppNav` factored out of the dashboard page

9.2 built the header (title, language switcher, sign-out) directly inside
`app/page.tsx`, fine when it was the only authenticated page. With
`/leave` (and 9.4-9.6's `/payslips`, `/documents`, `/profile`, `/team`,
`/org-chart`) now real pages, duplicating that header everywhere would
drift. `AppNav` centralizes it plus a nav-link row; manager/company_admin-
only links (`/team`, `/org-chart`) are omitted from the array entirely for
a plain employee, not hidden via CSS — matching this app's established
"structural, not a runtime check" preference (AttendanceService, step 6)
applied to navigation instead of an API call. The backend independently
enforces the real access control regardless of what this nav shows —
this is a convenience, not the security boundary.

### Manager-only screens live at their own routes, not folded into the employee's own pages

Deliberate structural choice for 9.5/9.6: rather than making `/leave` and
a future `/attendance` conditionally render manager-only sections inline,
manager team management (`/team`, attendance correction) and leave
approvals get their own routes. Considered folding leave approvals into
`/leave` itself (a manager viewing "my requests" and "requests I can
approve" in one place) but kept them structurally separate instead —
easier to reason about who can reach what, and avoids one page's
component tree needing to branch its entire data-fetching strategy on
role.

### Frontend auth fixtures gained a real `LeaveType` ("Annual Leave", 20 days/year)

`seed-frontend-auth-fixtures.ts` had no `LeaveType` for its company at
all — the 9.3 submit-form integration test needs a real, active one to
select. Added idempotently (upsert-by-name), same convention as the
Branch/Department/Employee additions in 9.2.

### Real-backend integration test bugs: three rounds of query-ambiguity, all from the SAME root cause

The frontend auth fixture employee is fixed, not per-run (unlike backend
e2e fixtures, which mint a fresh company every run) — so this employee's
leave-request history is a real, permanently-accumulating list across
every past test run, by design (same accepted trade-off as 9.2's
attendance integration tests). The leave integration test broke three
times in a row against that accumulation, each time from a global
(page-wide) query that used to be unambiguous when the list was short:
`findByText("Cancelled")` (multiple past cancelled rows),
`findByRole("button", {name: "Cancel request"})` (multiple pending rows
left behind by earlier BROKEN versions of this very test, cleaned up via
a one-off script), and `findByText("Annual Leave")` (matches the SELECT's
own option AND every history row's type-name span once more than one row
exists). Fixed by scoping every query either to the SELECT specifically
(`findByRole("option", ...)`, which the history list's plain `<span>`s
don't share) or to the ONE row matching this run's own randomized future
date range (`within(row)`, found via that row's unique date text), never
a bare page-wide text/role query for anything this list could plausibly
also contain. Worth remembering for every later integration test against
this same fixture employee (9.4's documents/profile, if their own
lists grow the same way).

### Real-backend integration tests occasionally flake ONLY under full-suite concurrent load — investigated, understood, not a product bug

Running this one file alone: 100% reliable across many repeated runs.
Running the full ~127-test frontend suite (29 files, several of which now
hit the real dev API concurrently): occasionally (roughly 1 run in 5-6
during this step's development) a single `within(row)` assertion in the
leave integration test found its row before the corresponding state
update had fully landed, or a preceding `findByRole` timed out at
10-20s. Root cause is capacity/scheduling contention, not a logic bug:
~29 vitest files running in parallel workers, several issuing real HTTP
round-trips to ONE single-process dev API server (itself opening a
Prisma-managed Postgres connection per request) at the same moment,
occasionally pushes a specific real network round-trip past its
timeout under CPU contention neither this test nor the backend can see
or account for. This is the same category of thing the BullMQ
queue-collision bug (step 9.0) came from — real infrastructure behaving
differently under real concurrency — except this time the finding is
"this is a test-environment capacity ceiling, not a code defect,"
confirmed by: the assertion itself is correct (proven by the 100%
standalone pass rate), the failure mode is pure timing (never a wrong
value, always "didn't happen in time"), and it resolved itself on retry
every time without any code change. Not fixed further for now — bumping
every timeout indefinitely just to fully paper over a shared-single-
dev-server capacity limit isn't worth chasing to zero. If this gets
meaningfully worse as 9.4-9.6 add more real-backend integration files,
worth revisiting: either give integration specs their own reduced-
concurrency vitest project config, or accept it as a "rerun if it flakes"
CI reality, matching how many real-world CI setups already treat genuine
infra-contention flakes.

## 2026-07-29 — Step 9.5: Manager team view + attendance correction

### Attendance correction is an inline expansion INSIDE each team row, not a separate route

Considered a dynamic `/team/[employeeId]/correct-attendance` route; built
it as an inline toggle inside `TeamList`'s per-row action slot instead
(`AttendanceCorrectionForm` swaps in for the "Correct attendance" button).
This is what makes the "impossible via the UI" guarantee structural
rather than a separate check: `TeamList` only ever renders a row — and
therefore only ever offers a correction action — for an employee `GET
/employees` actually returned. There is no route a manager could navigate
to (by URL-guessing or otherwise) that accepts an arbitrary employeeId
independent of what this list rendered; `AttendanceCorrectionForm` always
receives its `employeeId` as a prop from a row that already passed
through the server's own department-scoping.

### Frontend auth fixtures gained a manager, a second department, and a real "out of scope" employee

Needed for this sub-step's integration tests to prove department-scoping
against something real, not assumed: a manager fixture (`frontend-e2e-
manager@hrms.test`, managing the SAME department the existing employee
fixture belongs to) plus a second department holding one employee with no
`userId` (not a login — exists purely as a real row the manager's scope
must exclude). Confirmed both structurally (the out-of-scope employee's
name never appears in the rendered team list) and server-side (a direct
`POST /attendance/override` against that employee's REAL id — looked up
via an admin session, never the manager's — is rejected 404 under the
manager's session), matching the exact two-part guarantee ("impossible
via the UI... AND rejected server-side if attempted directly") the
founder asked for, mirroring step 6's own e2e pattern for the same
guarantee on the backend side.

### "Show the resulting record's source as admin_override... in any history view" — scoped to the correction form's own confirmation, since no team attendance HISTORY view exists yet

No screen in this batch lists a team member's past attendance records (a
timesheet/history view wasn't part of 9.2-9.6's screen list) — only
today's own status (`ClockWidget`, employee-facing) and this correction
FORM (manager-facing, one-shot). Interpreted the instruction as: wherever
a source IS shown, it must be unambiguous, not blended in with a normal
clock-in — satisfied by the correction form's own success message
explicitly stating `(admin_override)` after a successful save, sourced
from the real API response's `source` field (never assumed/hardcoded, so
if the backend ever legitimately returned something else it would show
that instead). Revisit if a team attendance history screen gets built
later — that view would need the same explicit-labeling treatment.

---

## 2026-07-29 — Step 9.4: Documents (Employee) + a real jsdom/fetch/FormData bug in the test harness itself

### Backend: employee self-service document upload — a genuine scope-check gap fixed before it could ever be exploited

`DocumentsController.upload()`/`DocumentsService.upload()` never checked
`isVisible(employeeId, caller, scope)` before this step — harmless only
by accident, because `documents:create` had no self/own_department grant
in the default matrix (admin-only, scope `"all"`, so no restriction was
ever needed). The moment 9.4 needed real employee self-service upload
("upload new ones... reusing the validated upload flow from step 5"),
this became a real, exploitable gap: without the check, a self-scoped
employee could have uploaded a document under ANY `employeeId` in the
company, not just their own. Fixed BEFORE adding the new
`{role: employee, module: documents, action: create, scope: self}`
default grant, not after — `upload()` now calls the same
`EmployeesService.isVisible()` check `createSignedUrl()` already used.
Proven with a real cross-employee upload attempt in
`employee-management.e2e-spec.ts` (404, zero rows created for the
targeted-but-not-owned employee). Same retroactive-seeding caveat as
every prior `RBAC_MODULES`/default-matrix addition — `pnpm db:seed` and
`db:seed-frontend-auth-fixtures` both re-run to backfill existing
companies.

### `resolveApiUrl` reused for documents' signed-URL view flow; same "fresh URL every click" guarantee as payslips

No new pattern here — `DocumentsPanel` mirrors `PayslipsList` exactly
(fetch a fresh signed URL on click, `window.open` it via
`resolveApiUrl`, never cache/reuse). The self-service upload form
resolves the caller's own `employeeId` via the SAME `GET /employees/me`
`ProfileView` already needs (9.4 part 2) — the upload form itself never
asks "whose document is this," matching the "never surface a
self-action's target id as something to type in" principle used
throughout this app (Attendance/Leave never accept a client-supplied
`employeeId` either, though there it's structural/server-enforced; here
the server still independently re-validates via `isVisible` regardless
of what the client sends, so this is a UX choice, not the real
boundary).

### A real bug, found and fixed: jsdom's File/Blob/fetch are not interoperable with Node's own fetch (undici) for multipart uploads

The single biggest time-sink of this sub-step, and worth documenting in
full because it will bite the next real-backend integration test that
needs to upload a file. Symptom: `DocumentsPanel`'s real-backend upload
test either hung indefinitely (30s+ timeout, request never resolved) or
failed with a genuinely confusing 400 — `"property file should not
exist"` — meaning the backend's own multer/busboy parser never
recognized the multipart part as a FILE at all (no `filename` seen on
it), silently falling through to `req.body.file` as a plain string,
which the DTO's whitelist then correctly rejected as an unknown field.

Root-caused by elimination, not guessed at:
- The exact same request (same bytes, same headers, same endpoint),
  issued from a **plain Node script** with zero test framework involved
  — works instantly, every time.
- The exact same request issued from **inside this project's own vitest
  config**, but with `// @vitest-environment node` (no jsdom) on that one
  file — also works instantly.
- The exact same request issued under `environment: "jsdom"` (this
  suite's default, needed for every component-rendering test) — hangs or
  gets misparsed, regardless of whether the `File`/`Blob` fed into the
  `FormData` came from jsdom's own global, or was freshly rebuilt with
  Node's own `node:buffer` File right before the call.

Conclusion: this is a real, documented category of incompatibility
between jsdom's environment and Node's native fetch/undici when a
`FormData` contains a file part — not a bug in this project's actual
`api-client.ts` (which is unmodified production code, and works
correctly in a real browser, where File/Blob/FormData/fetch all come
from one spec-compliant implementation). `userEvent.upload()` — the only
way a real-backend integration test can drive a `<input type="file">`
the way a real user does — necessarily produces a jsdom File, so this
can't be sidestepped by "just don't use jsdom's File."

**Fix**: added `undici` as an explicit `apps/web` devDependency (already
present transitively; installed directly so its `fetch`/`FormData` are
imported from a realm-stable, known-good source rather than whatever
`globalThis` resolves to once jsdom has initialized) and patched
`vitest.setup.ts` to intercept any outgoing `fetch` call whose `body` is
a `FormData`: every `Blob`/`File` entry is read via `.arrayBuffer()` and
rebuilt with `node:buffer`'s `File` (note: `undici`'s own package export
has NO `File` — Node's global `File`, from `node:buffer`, is what undici
actually expects), appended to a fresh `undici`-native `FormData`, and
sent through `undici`'s own `fetch` — never through whatever
`globalThis.fetch` happens to be under jsdom. This is test-infrastructure
code, gated to only affect FormData bodies (every mocked test, and every
JSON-body integration test, is completely unaffected — confirmed by the
full suite passing before and after). If a future integration test needs
to upload a file, it should just work with no special handling — this
patch is transparent at the `apiFetch`/`fetch` boundary.

---

## 2026-07-29 — Step 9.4: Payslips (Employee, part 1)

### `GET /payslips/me` extended to include the parent PayrollRun's period

A `Payslip` row has no period of its own (that's the RUN's concept), and
there was no self-service way for an employee to look one up —
`PayrollRunsController` is entirely `payroll:edit`-gated (admin-only, no
self-scoped grant exists — see step 8's DECISIONS entry on that). Rather
than add a whole new self-service "my payroll run" endpoint, extended
`PayslipsService.myPayslips()` to `include: { payrollRun: { select:
{ periodStart, periodEnd } } }` — the minimum needed, not the whole run
(no `status`/`createdBy`/admin-only fields leak through). Covered by a new
assertion in the existing `payroll.e2e-spec.ts` self-service test, not a
new test file.

### `resolveApiUrl()` added to `api-client.ts`

Signed-URL endpoints (`/payslips/:id/signed-url`, and 9.4's documents
equivalent) return a backend-RELATIVE path (`/payslips/download?token=
...`), matching the API's own routing — but the frontend needs to
navigate the BROWSER there directly (`window.open`), not go through
`apiFetch` (which would try to attach an Authorization header to a
`@Public()` link that doesn't need or want one, and isn't meant to be
JSON-parsed). `resolveApiUrl(path)` just prefixes the same
`NEXT_PUBLIC_API_URL` `apiFetch` already uses internally, now exported
for exactly this one purpose.

### `PayslipsList`: a fresh signed URL every click, verified by actually diffing two consecutive requests

Confirmed with a real assertion, not just code reading it correctly: two
consecutive clicks on the same payslip's Download button both call
`GET /payslips/:id/signed-url` again (asserted call count = 2, not 1),
and the two returned URLs differ (`PayslipsList.spec.tsx`). A payslip
whose `pdfUrl` is still `null` (run finalized but the PDF job hasn't
completed) renders `payslips.notReady` text instead of a Download button
— never a button that would just fail when clicked.

### Real-backend integration test needed a full admin-side payroll cycle it doesn't otherwise touch

Unlike every other 9.3/9.4 self-service screen, an employee has no
self-service way to CREATE the data `PayslipsList` displays — only a
company_admin can create+finalize a `PayrollRun`. `payslips.integration.
spec.tsx`'s `beforeAll` logs in as BOTH fixture users: the admin creates
a draft run, finalizes it with `acknowledgeUnverifiedRates: true` (same
acknowledgment `payroll.e2e-spec.ts` uses — the seeded system rule is
still genuinely unverified, see step 8), polls `GET /payroll/runs/:id`
until the in-process BullMQ worker flips it to `finalized`, THEN switches
to the employee session the component under test actually uses. Same
query-ambiguity lesson as 9.3's leave integration test applied
proactively this time (scoped to the row matching this run's own
period text via `within(row)`, not a page-wide role query) — this
fixture company's payslip history also accumulates a real row per test
run.

---

## 2026-07-28 — Post-9.2: second `.next` build-cache corruption, root-caused (not just fixed again)

Second occurrence this project (first was mid-9.1, on `/login`; this one
on `/` after 9.2's dashboard assembly), same category, different missing
file (`./663.js` this time vs. the 9.1 incident's chunk set) — both
`MODULE_NOT_FOUND` errors reading from `.next/server/...`, both after a
long-uptime dev server that had absorbed many hours of hot-reload churn
across a long session. Fixed the same way as before: found the still-
listening process on :3000 (PID 2608, started 3:51 PM — i.e. it really
was the same long-lived server, not a new one), `Stop-Process -Force`,
confirmed the port was free, `rimraf .next` (via the existing
`apps/web` `clean` script — `pnpm --filter @hrms/web clean` — rather than
a manual `rm -rf`), fresh `pnpm run dev`, then verified by curling `/login`
and `/` and every individual `_next/static/...` asset either page's HTML
actually references (11 unique chunk/CSS URLs — all 200, not just the
page shell), plus grepping the response bodies for error markers.

**Investigated why, rather than treating it as random.** The one
structural fact that stands out: this repo's working directory is
`OneDrive\Desktop\hrms` — a live OneDrive-synced folder, not a local-only
path. This is a well-documented failure mode for Node/webpack dev
servers on Windows specifically because build tools that rewrite many
small files rapidly (exactly what `.next/server`'s per-chunk output is)
race against the OneDrive sync client's own file handles — the sync agent
reads/uploads/re-links files using the same NTFS change-journal hooks
webpack's file watcher depends on, and a chunk file caught mid-write by
either OneDrive sync or (independently) Windows Defender's real-time
scanner can result in exactly this symptom: the file exists moments
later, but a `require()` that raced it sees `MODULE_NOT_FOUND`. Checked
what evidence is available without instrumenting a full trace: the
OneDrive sync process (`OneDrive.exe`) was NOT running at the moment of
this investigation, and project files aren't currently OneDrive
"cloud-only" placeholders (`attrib` shows plain `Archive`, no offline/
placeholder attribute) — so Files-On-Demand churn isn't demonstrably the
live cause right now, but neither of those rules out that sync was active
during either actual corruption event (OneDrive starts/stops with login
sessions and network state, outside this project's control).

**This is NOT a Turbopack-vs-Webpack issue** — this project already runs
plain Webpack (`next dev --port 3000`, no `--turbo` flag; confirmed via
`next.config.ts`, which sets nothing Turbopack-related). Switching to
`--turbo` wouldn't address a file-sync-interference root cause (Turbopack
writes its own cache to the same synced filesystem, so the same race
could still apply to different files) and would introduce a real,
untested behavior-parity risk this late in the project — not adopted.

**What's being adopted now:** proactively run `pnpm --filter @hrms/web
clean` before restarting the dev server at the start of each new
sub-step (not just reactively after a corruption error appears) — cheap,
already-existing tooling (the `clean` script was already there, just
unused for this purpose), and directly shrinks how much accumulated
long-lived cache state is exposed to a mid-write race during any given
session.

**What's flagged for the founder to decide, not performed here** (both
require system-level/GUI changes outside safe unattended-agent scope):
(1) mark `apps/web/.next` and the repo's `node_modules` as "Always keep
on this device" in OneDrive, which disables Files-On-Demand placeholder
behavior for those paths specifically without un-syncing the whole repo;
(2) add a Windows Defender real-time-scanning exclusion for the repo
folder — both are the standard, documented fixes for this exact class of
Windows dev-tooling issue. If corruption recurs a third time after
adopting the proactive-clean habit above, the more invasive option —
relocating `node_modules`/`.next` (via `distDir`) or the whole repo
outside the OneDrive-synced tree — should be revisited as a real decision,
not something to reach for immediately given how disruptive moving the
project location would be.

---

## 2026-07-28 — Step 9.2: Employee dashboard + Attendance

115 frontend tests (component + real-backend integration, `en`/`ar`/`ku`
coverage for every new screen/widget) plus the full 57-test backend e2e
suite, all passing together, re-run twice consecutively with both dev
servers live throughout the whole sub-step.

### New backend endpoint: `GET /holidays/upcoming`

No such read surface existed before this sub-step — the Holiday table was
write-only (admin CRUD) plus an internal join from `working-days.ts`. Added
`HolidaysModule` (`upcoming(limit = 5)`, capped/validated via
`UpcomingHolidaysQueryDto`) for the dashboard's "upcoming holidays" widget
(task #85). No `@RequirePermission` — same reasoning as
`LeaveTypesController`'s open `GET /`: a company's holiday calendar is
shared reference data every authenticated employee needs, not
permission-gated. Relies entirely on `Holiday`'s existing RLS policy
(`companyId = current tenant OR companyId IS NULL`) rather than
re-filtering by `companyId` in the query — the database already guarantees
tenant isolation plus system-wide visibility, so duplicating that filter in
the service would just be redundant, unverified-by-DB application logic.
5 e2e tests cover future-only filtering, sort order, `limit`, tenant
isolation (a second company never sees the first company's override rows,
but both see the system-wide row), and 401 when unauthenticated.

Caught a real fixture-leak bug while building this: the first version of
the e2e test created a system-wide (`companyId: null`) "System Holiday" row
but only cleaned up company-scoped rows in `afterAll`. Running the suite
twice left two colliding system-wide rows at the same date, breaking an
exact-array-equality assertion. Fixed by giving the fixture a
run-unique name (`` `System Holiday ${runId}` ``, matching this project's
established fixture-naming convention) and adding an explicit
`companyId: null` cleanup step, scoped by `name: { contains: runId } }` so
it can never touch the real seeded 2026 system calendar
(`database/seeds/holidays.ts`). Verified idempotent by running the test
twice consecutively, then the full 57-test e2e suite.

### `t()` gained `{{placeholder}}` interpolation, needed for the first time by dashboard copy

Every translation key through step 9.1 was a static string — `t(key)` had
no second argument. Dashboard copy (task #83) is the first UI in this app
that needs a variable inside translated text ("Welcome, {{name}}",
"Clocked in at {{time}}.", "{{count}} days remaining") where word order
genuinely differs by language (confirmed: `dashboard.attendance.statusClockedIn`
puts the time in a different position in the Arabic and Sorani sentences
than in English) — string concatenation in the component would have
silently produced English word order for RTL locales. Extended
`LocaleContext`'s `t` to `t(key, params?)`, doing a simple
`{{name}}` -> `String(params.name)` regex replace after key lookup, in
`locale-context.tsx`. Backward compatible (params is optional; all
step-9.1 call sites still compile and pass unchanged) — verified by the
full existing 75-test suite plus 4 new tests
(`locale-context.spec.tsx`) covering substitution, multiple placeholders,
and the missing-param case (left as a literal `{{name}}` rather than
throwing, matching this codebase's existing "never crash on a translation
gap" posture — same spirit as `t()` falling back to the English string,
then the raw key, rather than throwing on an unknown key).

### Step 9.2 closed out: dashboard assembled, `claude-in-chrome` still unavailable, same verification substitute as 9.1

`src/app/page.tsx` now composes `ClockWidget` + `LeaveBalanceWidget` +
`HolidaysWidget` behind `useRequireAuth()`, with the `/auth/me`-sourced
email greeting from above. 115 frontend tests (component + real-backend
integration, `en`/`ar`/`ku` coverage for every new screen/widget) and the
full 57-test backend e2e suite pass together, re-run twice consecutively
with the dev servers live throughout — proving both the step 9.0
Redis-isolation fix and this step's fixture-idempotency work
(`closeAnyOpenRecord`, the holidays run-unique naming) actually hold
under repeated same-day, same-process runs, not just a single clean run.
`next build` (production build, not just `next dev`) also succeeds with
no new route errors.

Re-checked `claude-in-chrome` at this step's visual-verification
checkpoint, per the founder's explicit request to try again — still
unavailable (confirmed via tool search; declined during setup, per the
9.1 entry). Substituted the same non-visual verification 9.1 used: `curl`
against the live dev server with `hrms_locale` set to each of `en`/`ar`/
`ku` confirms the server-rendered `<html lang dir>` resolves correctly
for the dashboard route specifically (`ltr`/`en`, `rtl`/`ar`, `rtl`/`ku`),
plus the widget-level `dir="rtl"` assertions already covered in each
`*.locales.spec.tsx` file. This carries the same limitation flagged in
9.1: jsdom/curl can't compute real CSS, so the dashboard's actual visual
RTL layout (grid column order, icon alignment, geofence-banner mirroring)
is unconfirmed by direct inspection — same gap, same fix if the founder
does a manual browser pass: update this entry to RESOLVED, as happened
for `/login` and `/forgot-password` in 9.1.

### Leave balance widget joins two existing endpoints client-side; deactivated leave types are silently dropped, not shown blank

`GET /leave-balances/me` returns raw `{leaveTypeId, balance}` rows with no
name — `GET /leave-types` (already open to every authenticated user, no
new endpoint needed) supplies the name via a client-side join. A balance
whose `leaveTypeId` isn't in the active-types list (a deactivated type
with old history) is filtered out rather than rendered with a blank/
fallback name — same "active types only" boundary
`LeaveTypesController.listActive()` already draws for the future
leave-submission form (9.3), so the dashboard never shows a leave type a
user couldn't actually submit a new request against.

### `LeaveBalance.balance` (Prisma `Decimal`) arrives over HTTP as a JSON string, not a number

Confirmed by how the backend's own e2e suite already treats this field
(`Number(balance.balance)` throughout `leave.e2e-spec.ts`) — Prisma's
`Decimal` serializes via `toJSON()` to a string. `leave-api.ts` types
`balance: string` honestly rather than `number`, and the widget converts
with `Number(...)` at the point of use, then re-formats through
`formatNumber(..., locale, { maximumFractionDigits: 2 })` — this is the
first place in the frontend consuming a `Decimal`-backed field, so it's
also the first place this conversion step needed to exist at all.

### Real-backend integration tests for these two widgets deliberately assert against states that are true BY DESIGN, not seeded specifically for the test

`LeaveBalanceWidget`'s integration test asserts the EMPTY state for the
fixture employee — correct because `LeaveBalance` rows are lazily created
only on first approval (step 7), and this fixture employee has never had
a request approved. `HolidaysWidget`'s integration test asserts "Iraq
Independence Day" (2026-10-03) appears — the real, already-seeded
system-wide 2026 calendar's nearest entry after today
(2026-07-28; the prior entry, Iraq Republic Day on 2026-07-14, is already
past). Neither test creates its own fixture data — both lean on
pre-existing, already-documented backend seed behavior, which is more
brittle to a FUTURE seed-data change than a self-contained fixture would
be, but was judged worth it here specifically to prove the real join/
empty-state logic without adding a third data-creation path beyond the
company-wide dev seed and the frontend auth fixtures. Revisit if the 2026
holiday calendar seed ever changes.

### `/auth/me` gained an `email` field, for the dashboard greeting

The access token payload deliberately carries only `sub`/`companyId`/`role`
(see step 3 — `JWT_REFRESH_SECRET`/token-minimalism decisions), and there
was no other endpoint returning a human-readable identifier for the
signed-in user. Rather than build a new profile endpoint or expand scope
into fetching the caller's `Employee.fullName` (which isn't reachable
without a dedicated "my employee record" endpoint that doesn't exist yet
— `GET /employees/:id` is scope-gated, not a "me" route), extended the
already-dual-purpose `GET /auth/me` (used both as
`AuthProvider`'s post-login session-establish call AND as the tenant-scope
diagnostic it was originally built for — see step 4) with one more
already-available field: `email`, read via a single `User.findUnique` on
the same tenant-scoped connection. Small, backward compatible (additive
field, `AuthUser` on the frontend simply gained `email: string | null`),
and no existing test's exact-shape assertions broke (checked — none assert
key-exhaustiveness on this response).

### Clock in/out widget: `GET /attendance/me?from=today&to=today` doubles as "today's status" — no new endpoint

Unlike the leave-day-preview endpoint added in 9.1 (which wrapped real
calculation logic), reading "today's attendance status" is just "the
existing timesheet endpoint, narrowed to today, first element" — not
enough distinct logic to justify a new backend surface. `attendance-api.ts`
computes `today` as a UTC calendar date string (`toISOString().slice(0,
10)`), matching the UTC-day convention already used throughout this
project (`HolidaysService`'s `todayUtc`, `working-days.ts`) rather than
the browser's local timezone, since `TimesheetRangeDto` parses `from`/`to`
as UTC-midnight-anchored dates on the backend side.

### Geolocation failures are fully non-blocking, mirroring the backend's own geofence philosophy

`getGeoResult()` never rejects — permission denial, an unsupported browser,
or a timeout all resolve to a result the caller still clocks in/out with
(coordinates simply omitted). This is a direct client-side mirror of
`AttendanceService.evaluateGeofence`, which already treats "no
coordinates" as "nothing to check," never an error (see step 6). The
widget shows a small, non-blocking notice distinguishing "permission
denied" from "unavailable" (distinct copy, since one is an action the user
took and the other isn't), and shows the amber geofence-mismatch banner
whenever the most recent record's `withinGeofence === false` — never
blocking the action either way, per the same step-6 decision that
geofence violations flag for admin review, they don't prevent the punch.

### Real-backend integration test for this widget only asserts the "Clock in" BUTTON as its starting state, not "no record today"

The frontend auth fixtures use one fixed, non-per-run employee (unlike
backend e2e fixtures, which mint a fresh company per run) — so this
integration test can be run more than once on the same calendar day, and
after the first run, "today" already has a closed attendance record.
`closeAnyOpenRecord()` (calls `clock-out`, swallows the 409 if nothing was
open) guarantees no OPEN record before each test, which is enough to
guarantee the widget starts on the "Clock in" button — but NOT that
today has zero history, so the test deliberately never asserts the
"You haven't clocked in today" copy as a precondition. Verified this
matters, not just theoretical: the first version of this test asserted
exactly that and failed the moment it was re-run after having already
passed once earlier the same day.

### Frontend auth fixtures extended with real `Employee` rows (department + branch + geofence)

`seed-frontend-auth-fixtures.ts` (step 9.1) only created `User` rows —
enough for login/2FA tests, but attendance clock-in/out and leave-balance
real-backend integration tests (tasks #84/#85) need an actual `Employee`
row, since `AttendanceService`/`LeaveService` resolve the caller's
`Employee` (via the authenticated user's `userId`) to know
department/branch/geofence — not the `User` row directly. Extended
(idempotently — upsert-by-`userId`, safe to re-run) to also create one
`Branch` ("Erbil HQ", with `geofenceLat`/`geofenceLng`/
`geofenceRadiusMeters` set to an arbitrary-but-stable Erbil coordinate so
task #84's geofence-flagging behavior has a real point to test against —
matching coords for "inside," anything else for "outside") and one
`Department`, then links both the admin and employee fixture users to
`Employee` rows in that department/branch. `nationalId` is routed through
`encryptField` (unlike the older company-wide `seed.ts`, which predates
that wrapper and still stores plaintext placeholders — not touched here,
out of scope). Verified by re-running the script twice (identical
company/branch/employee IDs both times, confirming idempotency) and by a
one-off query confirming both `Employee` rows resolve to the correct user,
department, branch, and geofence values.

---

## 2026-07-28 — Step 9.1: Auth UI (login, 2FA, forced password change, password reset)

75 frontend tests (component + real-backend integration, no mocked
`apiFetch` for the integration layer) plus the full 52-test backend e2e
suite and 125 backend unit tests, all passing together — the backend
suite was re-run with the frontend's real dev-server integration tests
having just run against it, confirming the step 9.0 Redis-isolation fix
holds under actual concurrent use, not just in theory.

### Stable, idempotent seeded fixtures for frontend integration tests — not Prisma access from `apps/web`

`apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts` provisions a
2FA-enrolled `company_admin` and a no-2FA `employee`, both with fixed,
known credentials (and a fixed, non-random TOTP secret for the admin).
Considered giving `apps/web`'s test suite direct `PrismaClient` access
(mirroring exactly how the backend's own e2e specs create fixtures) but
rejected it: reaching into the database from the frontend's test
dependency graph crosses a real boundary this project has otherwise kept
clean, and there's no public API path to provision a login-capable user
(no signup UI, by design — see step 3). A backend-side seed script with
literal, duplicated-by-hand constants in the frontend test (documented
cross-reference comment in both files) is simpler, matches how a real
staging environment would have stable known test accounts, and keeps
`apps/web`'s dependencies frontend-only. **Trade-off accepted:** a real
integration test for the 2FA-**enrollment** path (first-time setup) isn't
included — it would need a non-idempotent reset of the fixture's 2FA
state between runs, which isn't worth the complexity for what's already
thoroughly covered by mocked component tests (`login/page.spec.tsx`).

### Login is one page with internal step state, not three routes

`credentials` → `2fa_verify` | `2fa_enrollment_required` → session, all in
one component (`app/login/page.tsx`) rather than separate
`/login`, `/login/verify`, `/login/enroll` routes. The `pendingToken` a
2FA step needs is short-lived and tied to one specific login attempt;
passing it through URL routing (query params, or route state) is more
fragile than just keeping it in component state for the step it's
relevant to. One redirect path, not several: every success branch
(immediate `ok`, 2FA verify, 2FA enable) converges on the same
`useEffect` watching `status === "authenticated"`, so there's exactly one
place that decides "now navigate to `/`" — not one per branch.

### QR enrollment: `qrcode` package generating a client-side data: URI, no server round-trip for the image itself

The backend's `/auth/2fa/enroll` already returns everything needed
(`secret`, `otpauthUri`); rendering that as a scannable QR code is a pure
client-side concern (`QRCode.toDataURL(otpauthUri)` → an `<img src="data:...">`),
so no new backend endpoint was needed. The raw secret is also always shown
as selectable text alongside the QR code — a users-without-a-camera or
scan-failure fallback, standard TOTP-enrollment UX.

### Backend error messages are English-only; the auth screens map SPECIFIC expected failures to translated copy, not every possible message

The API doesn't localize error strings (confirmed: `AuthService`'s
`GENERIC_LOGIN_ERROR`, 2FA-invalid-code, class-validator messages are all
hardcoded English). Rather than attempting to translate arbitrary backend
strings, each auth screen client-side-validates the obvious cases (empty
fields, email format, password length) so users rarely see a raw backend
validation message at all, and maps the specific MEANINGFUL failure modes
each screen can actually produce to dedicated translated keys (invalid
credentials, invalid/expired 2FA code, invalid/expired reset token).
Anything else falls back to the generic, already-translated
`common.errors.generic.message` — never a raw English string leaking into
an Arabic or Sorani screen. Verified directly: `login.locales.spec.tsx`
renders the login screen in `ar`/`ku`, triggers a real validation failure
and a real (mocked) 401, and asserts the exact Arabic/Sorani strings
appear — not just that translation keys exist.

### `mustChangePassword` cleared locally after a successful change, not re-fetched

`POST /auth/password/change` already flips `User.mustChangePassword` to
`false` server-side (confirmed by reading `AuthService.changePassword`)
but returns only `{ message }` — no fresh session payload. Rather than an
extra `/auth/refresh` round-trip just to learn what the frontend already
knows locally (the change just succeeded), `AuthProvider` exposes
`clearMustChangePassword()`, called once right after a successful submit.
The change-password screen's own redirect-away effect (watching
`mustChangePassword`) then fires exactly the same way it would from a
fresh session — one code path for "does this session still need to change
its password," not two.

### `/change-password` is the FORCED flow only — not a general "change my password" settings feature

Scoped exactly to what the founder asked for: reachable only while
authenticated with `mustChangePassword` still true; already-current
sessions bounce to `/`. A voluntary password change from account/profile
settings is a different feature with different UX expectations (no forced
redirect, probably wants a "changed successfully, stay here" confirmation
rather than a bounce) — not built now, and not conflated with this screen
just because the API endpoint happens to be the same one.

### RTL/translated-content verification — RESOLVED by direct manual browser check

`claude-in-chrome` wasn't available this session (declined during setup;
confirmed unavailable again when checked at the start of step 9.2).
Verification initially used two non-visual methods: (1) `curl` against
the running dev server confirming server-rendered `dir`/`lang` resolve
correctly from the locale cookie for all three locales; (2) component
tests (`login.locales.spec.tsx`) rendering each screen with
`initialLocale="ar"`/`"ku"` in jsdom, asserting the actual rendered
Arabic/Sorani strings and the `dir="rtl"` attribute React produced, via
real `userEvent` interactions. Both are real but neither computes actual
CSS — jsdom doesn't run layout or transforms, so the `BackLink` chevron's
`rtl:rotate-180` utility was only confirmed present in the class list, not
observed actually rotating.

**The founder then manually checked `/login` and `/forgot-password` in a
real browser, in all three languages, and confirmed:** English renders
cleanly; Arabic and Sorani both properly mirror the ENTIRE layout (the
language switcher moves sides, text right-aligns — not just translated
text sitting inside an unchanged LTR box); the "Back to sign in" chevron
on `/forgot-password` correctly points the RTL direction in Arabic/Sorani.
This closes the visual-verification gap for these two screens — the
`rtl:` Tailwind mechanism and the cookie-driven `dir`/`lang` wiring from
step 9.0 are confirmed working end-to-end, by direct inspection, not
inferred from component tests alone. Later screens built in this step
still need the same live-browser confirmation before being considered
launch-ready; this entry covers what's been checked so far, not the whole
app going forward.

### A red/green icon inside form inputs, visible in every screenshot — investigated, concluded to be a browser extension artifact, not the app

Flagged by the founder during the manual browser check above. Investigated
by reviewing every place an icon could originate app-side:
`TextField.tsx` renders exactly a `<label>` + a bare `<input>` + an
optional error `<p>` — no icon markup, no `background-image`, no
`::before`/`::after` content rule anywhere in `TextField.tsx`,
`globals.css`, or `tokens.css` (the only pseudo-element rule in the whole
stylesheet is the unrelated `prefers-reduced-motion` reset). Every auth
form also sets `noValidate`, which additionally suppresses the browser's
own native HTML5 validation UI (the one built-in mechanism that could
otherwise inject a validity icon). Could not do a live incognito-window
check directly (`claude-in-chrome` unavailable, per above) to confirm
first-hand. Given the code-level evidence and the founder's own note that
several extensions are installed, this is almost certainly a password
manager/autofill extension decorating detected email/password fields
(common behavior for exactly this input-type pairing) — not
something this app renders. Left unfixed since there's nothing in the
app's own code to fix; revisit only if the founder's own incognito check
(still worth doing to be certain) finds otherwise.

---

## 2026-07-28 — Step 9.0: Frontend foundation (Employee/Manager Self-Service, sub-step 0)

The first frontend work in the build. `apps/web` was a bare scaffold
(design tokens + locale JSON files only, confirmed by inventory before
starting) — this sub-step builds everything every later screen depends on:
test harness, API client, auth session handling, i18n/RTL, loading/error
primitives. No visible feature screens yet; verified via 38 Vitest tests
(unit + component + real-backend integration, no mocked API responses for
the integration layer) plus manual curl checks of the real SSR output
against the real running dev API.

### Test runner: Vitest + React Testing Library for `apps/web`, Jest stays for `apps/api` — a deliberate, permanent divergence, not an oversight

`apps/web` had zero test infrastructure (package.json's `test` script was
a placeholder). Chose Vitest over matching `apps/api`'s Jest: Vitest's
Vite-based transform pipeline has meaningfully better support for Next.js
15's App Router primitives (React Server Components, `next/headers`,
React 19) than Jest's CJS-oriented transform does today, and startup/watch
performance is materially faster for a Vite-native project. **This is a
real, permanent split between the two apps in the same monorepo — flagged
explicitly here so a future session doesn't "fix" it into consistency
without knowing it was a considered choice.** Revisit only if Jest's
Next.js/RSC support closes the gap enough that unifying stops costing
anything.

### i18n architecture: context-based LocaleProvider + a plain locale cookie, not Next's `[locale]` routing segments

This app is entirely behind auth (no public/SEO-facing pages need
localized URLs), and the backend already models locale as a per-user
*preference* (`User.locale`, `Company.localeDefault`), not a routing
concern — a `[locale]` dynamic-segment approach would be solving a URL
problem this product doesn't have, at the cost of real complexity
(middleware-based locale detection/redirects, route duplication). Instead:
a plain (non-httpOnly — it's a UI preference, not a credential)
`hrms_locale` cookie, read **server-side** in `layout.tsx` via
`next/headers`'s `cookies()` to set `dir`/`lang` on `<html>` before any
HTML reaches the browser (verified via curl against the real dev server:
`ar`/`ku` cookies produce `dir="rtl"` with zero LTR-then-flip flash), and
a client-side `LocaleProvider` seeded with that same value that takes over
for runtime translation lookups and in-page switching (writes the cookie
+ flips `document.documentElement.dir/lang` immediately, no round-trip
needed to see a switch take effect). **Known limitation, accepted for
now:** this cookie-based preference is independent of the backend
`User.locale` field — switching language in the UI doesn't (yet) persist
to the user's account server-side, so it resets per-browser. Revisit if
that turns out to matter to real users; wiring it to `PATCH` the user's
locale is a small addition once a profile-edit endpoint exists (step 9.4).

### Numerals: explicit `-u-nu-latn` Intl extension on ar/ku, and `ckb` (not `ku`) as the actual Intl locale tag for Sorani

Confirmed via direct testing in this environment's Node/ICU build: the
`ku` BCP-47 tag has patchy Intl support (it's a deprecated/ambiguous
macrolanguage code), while `ckb` (Central Kurdish/Sorani, Perso-Arabic
script — matching `ku.json`'s actual script) produces correct Sorani month
names and IS supported. Internal locale code stays `ku` (matching
`ku.json`, `User.locale`'s existing "en | ar | ku" convention) —
`common/locale.ts` maps it to the Intl tag `ckb` only at the
`Intl.DateTimeFormat`/`NumberFormat` call site. Per the project's
already-confirmed numeral decision (Western numerals in ar/ku UI, not
Eastern Arabic-Indic ٠١٢٣): `ckb` defaults to Eastern Arabic-Indic digits
without an explicit override (confirmed by direct testing), so both `ar`
and `ku` get `-u-nu-latn` forced explicitly — for `ku` this is load-bearing
(the difference between ٢٨ and 28); for `ar` this environment's ICU
already defaults to Western digits, but forcing it explicitly makes the
guarantee environment-independent rather than an accident of this
machine's ICU data.

### API client: access token in module memory only, never Web Storage; reactive refresh-on-401, not a proactive expiry timer

`src/lib/api-client.ts` holds the access token in a plain module-level
variable, never `localStorage`/`sessionStorage` — deliberately not durable
across a reload (the httpOnly refresh cookie re-establishes the session on
mount instead, via `AuthProvider`'s silent-refresh effect). Keeps the
access token off disk entirely, so there's nothing for an XSS payload to
read persistently; the refresh token that actually needs to survive a
reload is already httpOnly and JS-unreachable by construction (step 3).
Refresh strategy is reactive (a 401 on a request that WAS carrying a token
triggers exactly one refresh-and-retry, concurrent 401s dedupe into a
single `/auth/refresh` call) rather than a proactive pre-expiry timer —
simpler, no clock-drift/timer-cleanup concerns, and the 15-minute access
token TTL means a reactive retry costs at most one extra round-trip per
session, not per request.

### Errors: three distinct ApiError subclasses drive three distinct UI presentations; `ErrorState` only offers Retry for the generic case

`api-client.ts` classifies every non-2xx response into a specific `Error`
subclass (`ValidationError`/`UnauthorizedError`/`ForbiddenError`/
`NotFoundError`/`ConflictError`/`ServerError`) by status code, not one
generic `ApiError`. `<ErrorState>` renders three presentations
(forbidden/notFound/generic) — deliberately no "Retry" button on
forbidden/notFound, since retrying either can't change the outcome
(permission and existence aren't transient); Retry only appears for the
generic/server-error case, where a retry might genuinely help.

### Real bug found by running the frontend integration tests alongside a real dev backend: BullMQ queue collision across processes

Running `apps/web`'s real-backend integration tests required a real
`apps/api` dev server (`nest start --watch`) running in the background.
Running the full **backend** e2e suite afterward while that dev server was
still up caused `test/payroll.e2e-spec.ts`'s signed-URL download
assertions to fail with a **genuine** 404 (not a flaky test) — confirmed
by direct filesystem inspection: the e2e-enqueued PDF-generation job had
been picked up and processed by the **dev server's** BullMQ Worker (same
Redis instance, same `payroll-pdf-generation` queue name, same DB index 0
on both `.env` and `.env.test` — BullMQ dispatches by queue name +
connection only, with no per-process isolation), which wrote the PDF to
the dev server's own `PAYSLIP_STORAGE_PATH`, not the test process's. The
e2e test's own signed-URL download correctly 404'd, because the file
genuinely wasn't where its own `StorageService` was configured to look.

**Fix:** `apps/api/.env.test`/`.env.test.example` now point `REDIS_URL` at
Redis DB index 1 (`redis://localhost:6379/1`) instead of the default 0
`.env` uses — full BullMQ (and any future Redis-backed feature) isolation
between the e2e suite and a concurrently-running dev server, verified by
re-running the full e2e suite (52/52 passing) with the dev server still
up. This extends the existing "no isolated test database yet" limitation
(Postgres is still shared between dev and test) with the specific,
now-fixed Redis/queue variant of the same underlying gap — worth watching
for the same class of issue if another Redis-backed feature (caching,
rate-limiting) is added later.

---

## 2026-07-28 — Step 8: Payroll module

The highest-stakes module in the build — it determines what real people
actually get paid. Held to at least step 7's edge-case bar, with extra
weight on rounding/currency correctness specifically: 21 unit tests just
for the calculation pipeline (money, tax, attendance-hours, and the full
orchestration), plus 8 e2e tests for lifecycle/RBAC/immutability/
idempotency/unverified-rate enforcement, all run against the real dev
Postgres + real Redis/BullMQ.

### Post-review: unverified payroll rates are a hard finalize-time guard, not just a documented caveat

Founder review flagged that "seeded rates are placeholders, see
DECISIONS.md" is not enough — nothing stopped a real pilot company's first
real payroll run from quietly going out on unreviewed numbers. Added
`verified: Boolean @default(false)` to both `PayrollRegionRule` and
`PayrollTaxBracket` (the bracket copy mirrors its parent rule's value at
write time — both are always replaced together in
`upsertCompanyRule`, so there's one real concept, duplicated onto both
tables per explicit instruction rather than left as a join-only fact).

`PayrollRunsService.finalize` now resolves the rule that will actually be
used (company override, else system default — the same
company-override-then-default fallback as normal calculation) and blocks
finalizing if it isn't `verified`, UNLESS the caller is a real
`company_admin` (`scope === "all"`, never a Manager regardless of what
flag they pass) AND explicitly sends `acknowledgeUnverifiedRates: true`
on the finalize call. The acknowledgment itself is captured in the same
`finalize` `AuditLog` entry (`metadata.unverifiedRatesAcknowledged`), so
"we knowingly shipped this on unreviewed rates" is a permanent, provable
record, not a silent default.

Deliberately scoped to **finalize only** — `createDraft` and `recompute`
remain completely unrestricted, so ordinary dev/testing/review work is
untouched. This is specifically the point-of-no-return gate: finalizing
is what generates real payslip PDFs and (per the Project Plan's stated
direction) will eventually feed real payroll reporting. Since every
company starts on the seeded system defaults and those are seeded
`verified: false` by construction, **the practical effect is that NO
company can finalize its first real payroll run without a company_admin
consciously acknowledging the rates haven't been reviewed** — which is
exactly the intended forcing function.

**This does not replace the actual legal/accounting review work** — it
only guarantees that work can't be silently skipped. Real regional
payroll/legal review of the seeded KRG and federal Iraq rates (overtime
multiplier, social security %, tax brackets) remains a hard prerequisite
before onboarding any real paying company — flagged here explicitly as a
launch blocker, not a nice-to-have, alongside the existing i18n-translation-
review and holiday-calendar-review flags from earlier steps.

### Rules-table schema: `PayrollRegionRule` (+ `PayrollTaxBracket`), company-override-over-system-default, exactly like Holiday

Two tables: `PayrollRegionRule` (one row per `(companyId, region)` —
overtime multiplier, standard monthly hours, standard working days/month,
employee social security %) and `PayrollTaxBracket` (progressive tax
bands, FK to a rule, `order` ascending, `upToAmount: null` on the top
unbounded bracket). `companyId: null` rows are system-wide defaults,
`companyId` set rows are per-company overrides — same nullable-tenant +
RLS-with-`OR companyId IS NULL` pattern as `Holiday` (step 2), reused
deliberately rather than inventing a different shape. Lookup
(`PayrollRulesService.getRuleForCompany`) always tries the company-specific
row first, falls back to the system default for that region — an admin
changing a rate is a `POST /payroll/rules` call, never a redeploy, which
is the literal Project Plan requirement ("a rules engine per region ...
not hardcoded formulas"). `PayrollTaxBracket.companyId` is denormalized
from its parent rule purely so RLS can filter it directly by column,
matching every other tenant-scoped table in this schema.

**Seeded system-default rates (KRG + federal Iraq) are PLACEHOLDER
figures, not reviewed law** — same caveat class as the seed i18n
translations (step 1) and seed holiday calendar (step 6/7): illustrative,
deliberately different between the two regions so the mechanism has
something real to prove, and explicitly flagged in
`database/seeds/payroll-rules.ts` as needing real regional payroll/legal
review before any real company's payroll runs through them.

### `Company.payrollRegion`: company-level, not per-branch/per-employee

A judgment call, same reasoning as `weekendDays` (step 7): a company
operating payroll is overwhelmingly a single-jurisdiction decision in this
product's target market. **Trade-off accepted:** a company genuinely
straddling both KRG and federal Iraq jurisdictions isn't representable
today. Revisit if a pilot company actually needs it — the schema doesn't
block adding a `region` override at the Employee or Branch level later,
it just isn't built now on spec.

### Rounding: ONE rounding point, HALF-UP, currency-aware precision — `common/payroll/money.ts`

`roundCurrency(amount, currency)` is called exactly twice per payslip:
once to produce the stored `gross`, once for `deductions`. Every
intermediate figure in `calculate-payslip.ts`'s pipeline (hourly/daily
rate, overtime pay, unpaid-leave deduction, social security, each tax
bracket's slice) stays at full `Decimal` precision the whole way through —
rounding at each intermediate step is exactly the "cent/dinar drift across
a payroll run" this design avoids. `net` is then `roundedGross -
roundedDeductions` (both already at target precision, so the subtraction
is exact) — **never** a separately-rounded `grossFull - deductionsFull`.
Those two approaches can produce different answers at the boundary (see
the dedicated test in `calculate-payslip.spec.ts`: `salaryBase=100.008`,
`socialSecurityEmployeePct=50%` engineered to make `grossFull=100.008`,
`deductionsFull=50.004` exactly — the implemented rule gives `net=50.01`;
rounding a separately-computed `net_full=50.004` would give `50.00`). This
also guarantees a printed payslip's gross-minus-deductions always equals
its printed net — no "the math doesn't add up" complaints from an
employee doing the subtraction by hand. IQD rounds to 0 decimal places
(whole dinars — fils subdivisions aren't used in day-to-day payroll in
this market); USD rounds to 2. Both round HALF-UP (`Prisma.Decimal.
ROUND_HALF_UP`), not half-to-even/banker's-rounding — the least-surprising
convention for a document someone reconciles by hand. All arithmetic uses
`Prisma.Decimal` (decimal.js) throughout — never native floating point.

### Unpaid leave: `LeaveType.paid` (new field), deduction via a fresh `countWorkingDays` call clamped to the payroll period — not the LeaveRequest's stored snapshot

Added `LeaveType.paid: Boolean @default(true)` (default true = a no-op for
every leave type that existed before this step, per the explicit
instruction). At payroll time: approved `LeaveRequest`s whose `LeaveType.
paid === false` and whose range overlaps the payroll period get their
overlap **clamped** to `[periodStart, periodEnd]`, then
`countWorkingDays` (the same function from step 7's Leave module — direct
reuse, not a reimplementation) computes the working days actually falling
inside THIS period. This is deliberately NOT the same value as the
LeaveRequest's own stored `workingDays` (step 7's approval-time snapshot,
frozen for balance-restoration correctness) — that snapshot covers the
request's whole original range, which may span multiple payroll periods
or extend beyond this one; what payroll needs is "how many of those days
fall in the period being paid," a fresh, period-relative question. No
existing LeaveType is unpaid at this step, so this path is currently a
verified no-op in production data — proven with a dedicated unit test
(`calculatePayslip` with an unpaid-type period reduces gross; a run with
zero unpaid periods changes nothing), not left untested on the assumption
it'll matter someday.

### Payroll run employee-inclusion: `active` + `on_leave`, exclude only `terminated`

A judgment call the founder asked to be made explicitly. Excluding
`on_leave` employees entirely would silently produce NO payslip at all
for someone genuinely still employed and mid-leave — worse than including
one that correctly nets near-zero (if their leave happens to be unpaid
and covers the whole period) or full pay (if it's a paid leave type).
`terminated` is excluded because a final settlement for someone who's left
is a different, not-yet-built workflow, not an ordinary recurring payroll
run.

### Manager payroll access: admin-only by the (unmodified) default RBAC seed, but scope-aware, not hardcoded

No new RBAC module needed: the existing `payroll` module's default matrix
(step 4/7) already grants `company_admin` full access and `employee` only
`view` at `self` scope — no manager grant exists at all, which already
matches the "default to admin-only if the docs don't specify" instruction
with zero seed changes. What DID need a deliberate choice: `payroll:view`
is scope `self` for employees, so gating payroll RUN/RULE endpoints on
`view` would let that same self-scoped grant reach company-wide
configuration it was never meant to touch. Every run/rule-management
endpoint is gated on `create`/`edit`/`approve` instead — actions with no
self-scoped grant in the default matrix — the same fix shape as the
`leave`/`leave_types` module split (step 7), but solved by picking a
different existing action rather than adding a whole new RBAC module,
since here the collision was avoidable that way. `PayslipsService` itself
still fully implements `own_department` scope handling (reusing
`EmployeesService.isVisible`/`managedDepartmentId`, same as every other
module) even though the default seed never exercises it — if a
company_admin later grants a manager `payroll:view` at `own_department`
via the RBAC CRUD module (step 4), it will just work, correctly
department-scoped, without any payroll code needing to change.

### PayrollRun lifecycle: `finalize` is a two-phase transition, `recompute` is the one mutation path, both draft-gated

`finalize` moves `draft -> processing` synchronously (audit-logged
immediately) and enqueues a BullMQ job; the job itself moves `processing
-> finalized` once every payslip in the run has a generated PDF. There is
deliberately no endpoint anywhere that edits a Payslip's
gross/deductions/net directly — `recompute` (wipe and regenerate every
payslip from current attendance/leave/rule data) is the only path that
changes those numbers, and it's rejected the instant a run leaves
`draft` (`status !== "draft"` -> 409), which is BEFORE the async PDF job
even needs to run — proven directly in the e2e suite. This is what makes
a finalized payslip's numbers immutable: not a field-level guard, but the
complete absence of any other way to reach them.

### PDF generation: BullMQ, in-process worker, idempotent by "skip if pdfUrl already set"

`PayrollPdfService.processRun` is the one function that generates
missing PDFs and flips a run to `finalized` — called by the BullMQ
`Worker` (registered as a Nest provider, `concurrency: 1`, running inside
this same Nest process per the architecture doc's "modular monolith ...
path to splitting into its own service later" framing) and, in the e2e
idempotency test, invoked a SECOND time directly, bypassing the API
entirely. Idempotency is structural: any payslip that already has a
`pdfUrl` is skipped outright — never re-rendered, never re-saved, never
re-stamps `generatedAt` — and the run-level "flip to finalized" is guarded
by `run.status !== "finalized"`, so `finalizedBy`/`finalizedAt` from the
original run are never silently overwritten by a later re-invocation
(verified directly in the e2e test, not assumed). Opens its own
tenant-scoped transaction via `TenantScopedRunner` — same pattern as
`DocumentsService.downloadByToken` (step 5) — because a BullMQ worker
runs outside any HTTP request, so there's no `TenantScopeInterceptor`
transaction for it to join.

**Known, accepted v1 limitation:** generated payslip PDFs are English-only
text, no localization. The architecture doc's stated goal ("PDF payslips
must render in the employee's selected language") is deferred, not
silently dropped — real scope for this step was calculation correctness,
immutability, and idempotency; RTL Arabic/Sorani PDF layout is a
substantial separate effort better done as its own pass.

### `LocalDiskStorageService` generalized to take its root path as a constructor argument, not a hardcoded env var name

Payslips need their own storage root (`PAYSLIP_STORAGE_PATH`, own secret
`PAYSLIP_URL_SECRET` — same "never usable as any other token family"
reasoning as every other signed-URL secret in this app), separate from
`DOCUMENT_STORAGE_PATH`. Rather than duplicating `LocalDiskStorageService`
into a near-identical `LocalDiskPayslipStorageService`, its constructor
now takes a plain `rootDir: string` and each module's `STORAGE_SERVICE`
provider supplies its own env var via a factory
(`useFactory: (config) => new LocalDiskStorageService(config.get(...))`).
`DocumentsModule` was updated to the same factory shape for consistency —
one class, two independent storage roots, zero duplicated file-handling
logic.

### Attendance-hours period boundary: a shift is attributed to the payroll period by its `clockIn` time only

`PayrollRunsService.buildPayslipData` queries `AttendanceRecord` by
`clockIn BETWEEN periodStart AND periodEnd` — a shift that starts just
before a period boundary and ends after it is attributed entirely to the
period its `clockIn` falls in, not split. A known, accepted simplification
for v1; splitting a single shift's hours across two payroll periods is a
real edge case but a rare one (most shifts don't straddle a
month-boundary midnight), and not worth the added complexity until a
pilot company's actual schedule surfaces it as a real problem.

---

## 2026-07-28 — Step 7: Leave Management module

The Project Plan's first money-adjacent module — a balance-calculation bug
here directly costs a pilot company real leave days, so this got a higher
edge-case testing bar than previous steps (11 e2e scenarios plus 14
dedicated unit tests for the working-days/proration math alone).

### Weekend config: `Company.weekendDays: Int[]`, default `[5, 6]` (Fri+Sat)

Values are `Date.getUTCDay()` numbers (0=Sun..6=Sat). Default is the
Kurdistan/Iraq workweek (Friday+Saturday), explicitly NOT a hardcoded
Western Mon-Fri assumption — the founder's instruction was direct about
this. Company-level, not per-branch/per-department: a workweek is a
company-wide policy in every case this product targets, unlike geofencing
(step 6) where per-branch made sense because branches are physically
different places.

### Working-days calculation: `common/leave/working-days.ts`, UTC-normalized, weekend + Holiday table both excluded

`countWorkingDays` iterates the inclusive date range day-by-day, excluding
any day matching `Company.weekendDays` OR present in the Holiday table
(both the company-specific rows and the `companyId: null` system-wide
calendar — same query pattern RLS already allows for that table). All
dates are normalized to UTC calendar days before comparison: leave request
dates arrive as date-only ISO strings ("2026-01-05"), which `new Date(...)`
already parses as UTC midnight, so anchoring the whole calculation in UTC
avoids the classic bug where a local-timezone read of that same instant
lands on the wrong calendar day. Unit tests were built from independently
hand-verified calendar facts (weekday-of-date, days-in-year), not by
trusting the function to check itself — same testing discipline as step
6's geofence boundary tests, called out explicitly to reuse.

### Proration formula: calendar-day fraction of the entitlement, rounded to 2 decimal places

`prorateAnnualDays(daysPerYear, hireDate, year)`: hired in an earlier year
→ full entitlement; not yet hired in the target year → 0; hired partway
through → `daysPerYear * (daysRemainingInYearFromHireDateInclusive /
daysInYear)`, where `daysInYear` is computed from actual UTC millisecond
deltas (so leap years are handled correctly without a hardcoded 365).
Chose calendar-day proration over working-day proration as the simpler,
more standard convention (most real-world PTO policies prorate this way);
rounds to 2 decimal places to match `LeaveBalance.balance`'s
`Decimal(6,2)` column.

### LeaveBalance is lazily created on first approval, not eagerly for every (employee, leaveType, year) at hire/year-start

`LeaveRequestsService.getOrCreateBalance` creates the row the first time a
request against that (employee, leaveType, year) is actually approved,
prorating at that moment. **No year-over-year carryover logic exists** —
each year's balance starts fresh at the full (or prorated) entitlement,
with no "unused days roll into next year" behavior. This is a real,
accepted v1 limitation: the Project Plan doesn't specify a carryover
policy, and guessing one (with its own edge cases — caps, expiry windows)
risked getting the money-adjacent part wrong in a different way. Revisit
once a pilot company states an actual carryover policy.

### Year-boundary requests (Dec into Jan): attributed WHOLLY to the start date's year — not split

A request spanning Dec 30 - Jan 3 draws entirely from the `startDate`'s
calendar-year `LeaveBalance` row, not split proportionally across both
years' balances. Chose this over a split because: (1) it's what the
founder's ask literally requires confirming/documenting, not necessarily
implementing the harder split; (2) a split would mean a single
`LeaveRequest` could touch two `LeaveBalance` rows, which the current
schema (`LeaveRequest.workingDays` is a single snapshot value used for
exact restoration on reject-after-approval) isn't shaped for — supporting
it would mean storing a per-year breakdown, not one number; (3) it's a
rare edge case administratively simpler to reason about as "the leave
period belongs to the year it starts in." **Trade-off accepted:** an
employee whose Dec 30 - Jan 3 request is approved draws 5 days from
December's year even though 3 of those days fall in January. Revisit if a
pilot company's HR policy explicitly requires split attribution.

### Negative balance: hard-blocked by default; company_admin-only `force:true` override, never for Manager

Approving a request that would take a balance below zero is a
`ConflictException` (409) by default, for both Manager and company_admin.
An admin may retry with `force: true` — honored ONLY when the resolved
`PermissionScope` is `"all"` (i.e., an actual company_admin, never a
Manager's `own_department` scope, even if they also pass `force: true`).
Chose "default-deny, explicit-and-audited admin escape hatch" over
"always allow negative" or "never allow negative" because: the founder's
own framing ("an admin force-approves beyond remaining balance for a
legitimate reason") describes an exception an admin makes knowingly, not
a routine outcome — defaulting to blocked keeps ordinary manager approvals
safe from accidentally overdrawing a balance, while still leaving a real,
audited path (the `approve` AuditLog entry's `metadata.forced` flag) for
the legitimate exceptional case. **Testing surfaced a real, worth-noting
behavior, not a bug:** because every request runs inside one Prisma
interactive transaction (`TenantScopeInterceptor`), a BLOCKED approval
attempt — one that throws before completing — rolls back everything it did
within that request, including the lazy `LeaveBalance` proration-and-create
that would otherwise have happened first. A rejected approval attempt
therefore leaves zero trace in `LeaveBalance`, not a stale created-but-
unchanged row; the e2e test originally asserted the row existed with an
unchanged value and had to be corrected to assert it doesn't exist at all
yet, which is the actually-correct, stronger guarantee.

### Balance restoration uses the STORED `workingDays` snapshot, never a live recomputation

`LeaveRequest.workingDays` is set once, at approval time, from that
moment's `countWorkingDays` result, and is what `reject` restores on an
already-approved request — never a fresh `countWorkingDays` call against
the current Holiday table. If a holiday is added or removed between
approval and a later reject-of-approval, the restored amount still matches
exactly what was originally deducted. A request that never left "pending"
(rejected-while-pending, or cancelled) has `workingDays: null` and never
touches a balance at all — this is enforced by the code path structure
(the pending-branch of `reject`/`cancel` simply never reaches the balance
update code), not by a conditional that could be gotten wrong.

### LeaveType admin CRUD lives under a separate `leave_types` RBAC module, not `leave`

Reusing `"leave"` for both LeaveType admin CRUD and the employee-facing
LeaveRequest workflow would have meant an employee's own `leave:create`
grant (scope `self`, intended for submitting their own leave request) also
satisfying `@RequirePermission("leave", "create")` on a LeaveType-creation
endpoint — same bug shape as the `"org"` module split in step 5, but for
create rather than view. `leave_types` was added to `RBAC_MODULES`
(`fullAccess("company_admin")` covers it automatically; Manager/Employee
get nothing by default, matching "admin-only"). `GET /leave-types` itself
is deliberately NOT gated by either module — every employee needs to see
which types exist to submit a request, so it only requires authentication.
Same retroactive-seeding caveat as `"org"`: existing companies need
`buildRolePermissionRows` re-run to pick up the new module's rows (moot
here since only `company_admin`'s auto-`fullAccess` uses it, and that's
computed from `RBAC_MODULES` at seed time, not stored per-module).

### "Cannot approve/reject your own request" is an explicit check, never inferred from scope

`LeaveRequestsService.loadForDecision` checks `request.employee.userId ===
callerId` BEFORE the department-scope visibility check, unconditionally —
proven necessary, not theoretical, by the step's own e2e suite: a
company_admin's resolved scope is `"all"`, which trivially satisfies the
visibility check against ANY employee including themselves, so without
this explicit check a company_admin (or a Manager who happens to sit in
the department they manage) could silently self-approve. Same reuse
pattern as `EmployeesService.isVisible` (step 5) and Attendance's
department-scoped override (step 6) — one shared scope-resolution path,
plus one extra check that scope resolution alone cannot express.

---

## 2026-07-28 — Step 6: Attendance module

### Geofence configured per-Branch, not per-Company

The project plan leaves this granularity open. Chose **Branch** as the
config owner: `Branch` already models "a physical site" (name + city), a
company with multiple offices genuinely needs a different center point per
site, and `Employee.branchId` already exists to link an employee to one.
`geofenceLat`/`geofenceLng`/`geofenceRadiusMeters` are all optional and
travel together — a branch with none of the three configured simply isn't
geofence-checked for its employees (`AttendanceService.evaluateGeofence`
returns `null`, never a false negative). An employee with no `branchId` at
all is likewise never geofence-checked. **Trade-off accepted:** a
single-office company that never explicitly creates/edits its one Branch
row to add geofence coordinates gets no geofencing at all, silently — there
is no company-level fallback. Revisit if pilot usage shows most companies
are single-branch and the extra "go configure your Branch" step is real
friction; a company-level default that Branch can override would be the
natural next iteration.

### Distance calculation: haversine, spherical Earth, inclusive boundary

`common/geo/geofence.ts` — `haversineDistanceMeters` (mean Earth radius
6,371,000m, not the WGS84 ellipsoid) and `isWithinGeofence` (`distance <=
radiusMeters`, boundary counts as inside). Sub-meter ellipsoid accuracy
buys nothing here — geofence radii are tens to low-hundreds of meters
("is this employee near their branch"), and haversine's worst-case error
against the ellipsoid is a small fraction of a percent, far below what a
phone GPS itself is accurate to. Boundary tests (`geofence.spec.ts`)
construct points at an exact, independently-derived distance from the
center (spherical trigonometry, not the haversine formula itself) to prove
the `<=` comparison's edge behavior — exactly-on-boundary, 1m inside, 1m
outside — rather than trusting the formula to test itself.

### Plausible-coordinate bounds: real lat/lng range + reject (0,0) — NOT anti-spoofing

`isPlausibleCoordinate` only rejects what cannot possibly be a real
coordinate: out-of-range lat (±90) / lng (±180), non-finite numbers, and
exact `(0, 0)` "null island" (the standard sentinel a device reports when
it fails to acquire a GPS fix, not a real location employees work from).
**Deliberately no mock-location detection, no velocity/plausible-travel
checks between consecutive punches, no device attestation.** Per the
founder's explicit instruction, GPS spoofing detection is a known,
accepted v1 limitation — real anti-spoofing needs OS-level signals (mock
location app detection, sensor fusion) this web-only clock-in doesn't have
access to, and is a rabbit hole not worth solving before a mobile app with
real device APIs exists. Being outside the geofence (or submitting
implausible-but-structurally-valid coordinates) **flags** a record for
admin review — it never blocks the clock-in/out, since workers legitimately
work off-site. Revisit once the mobile app (project plan's stated
mobile-later phase) has real device-level signals to check against.

### `withinGeofence` on clock-out: AND of both ends, null only if neither end was ever checked

A record's final `withinGeofence` combines the clock-in and clock-out
evaluations (`combineGeofenceResults`): `false` if either end was flagged
outside, `null` only if neither end had a geofence to check against
(no branch, no branch geofence configured, or coordinates omitted both
times), `true` otherwise. An employee who clocks in on-site and clocks out
half a kilometer away still gets a record worth an admin's attention, not
one that reads "clean" because only the first punch happened to pass.

### `AttendanceService` never accepts an `employeeId` for self-actions — structural, not a runtime check

`clockIn`/`clockOut` resolve the caller's own `Employee` row from
`Employee.userId` (the authenticated session's `sub`) — there is no
`employeeId` parameter anywhere in either method's signature or the
DTOs (`ClockInDto`/`ClockOutDto` carry only `lat`/`lng`). Combined with
`ValidationPipe({ forbidNonWhitelisted: true })` already enforced
globally, a client attempting to smuggle an `employeeId` into the request
body gets a 400 before the handler even runs — proven by an e2e test that
does exactly that. This is the same "can't leak scope through a parameter
that doesn't exist" property Employee CRUD's `own_department` writes rely
on (step 5), applied to "which employee" rather than "which department."

### Admin override reuses `EmployeesService.isVisible` — no separate scope logic to drift

`AttendanceService.adminOverride` and the team-timesheet `employeeId`
filter both call `employees.isVisible(employeeId, callerId, scope)` — the
exact same department-scope check `DocumentsService` already reuses (step
5). A manager's reach to correct or view attendance can never exceed their
reach over the employee anywhere else in the app, by construction, not by
keeping two scope implementations in sync by hand. `managedDepartmentId`
on `EmployeesService` was widened from `private` to a plain method for
this reuse, same pattern as `isVisible` itself.

### Admin override: create-or-correct is one endpoint, disambiguated by an optional `attendanceRecordId`

`POST /attendance/override` creates a new `AttendanceRecord` when
`attendanceRecordId` is omitted, or updates the existing one (re-verified
to belong to the same `employeeId`) when it's present — both paths require
a non-empty `note` and set `source: admin_override` +
`overriddenBy: <caller's userId>`, and both are independently audit-logged
(proven by an e2e test that creates, then corrects the same record, and
asserts exactly two `AuditLog` rows against one still-single
`AttendanceRecord` row). Chose one endpoint over separate create/correct
routes because the founder's ask ("manually create or correct") describes
one workflow with two entry points, not two workflows — this avoids
duplicating the visibility check, the note requirement, and the audit call
across two handlers.

---

## 2026-07-28 — Step 5: Employee Management module

### Storage abstraction: `StorageService` interface + `LocalDiskStorageService`

Matches the project plan's own stated path ("start with local disk in dev,
S3/DigitalOcean Spaces in prod") literally: `common/storage/storage.interface.ts`
defines `save/read/delete/exists`, bound via a DI token (`STORAGE_SERVICE`)
rather than a concrete class, so `DocumentsService` never imports
`LocalDiskStorageService` directly. Swapping in an S3-backed implementation
later is one new class + one binding change in `DocumentsModule`, not a
`DocumentsService` rewrite. Files live at `<repo>/storage/documents`
(configurable via `DOCUMENT_STORAGE_PATH`), gitignored, outside
`apps/api/src`/`dist` — nothing in this app serves that directory
statically; the only way to a file's bytes is `DocumentsService`, which
enforces RBAC + department-scope before ever touching the filesystem.

### File validation: allowlist + magic bytes via `file-type@16.5.4` (pinned, not latest)

`file-type` v17+ is ESM-only; this project's `module: commonjs` setup
(ts-node, Jest/ts-jest) would need dynamic `import()` gymnastics to use it.
Pinned to the last CommonJS-compatible major (16.5.4) instead — simplest
option, no behavior difference for the three types actually needed.
Allowlist (`application/pdf`, `image/jpeg`, `image/png`), not a blocklist:
nothing is rejected by name, only by omission, which is what makes "reject
executables regardless of claimed type" true by construction rather than
by remembering to enumerate bad types. **DOCX deliberately excluded for
v1** — its magic bytes are a generic ZIP container; reliably telling "a
real .docx" from "a zip renamed .docx" needs deeper structural inspection
than a v1 upload path warrants, and contract/id/passport/certificate
uploads are PDFs or photo scans in practice. Revisit if a real DOCX need
surfaces. **10 MB size limit** — generous for a scanned ID/passport/contract
PDF or phone photo without being wasteful; enforced both in the
validator and as a Multer-level `limits.fileSize` (defense in depth, and
the Multer limit rejects oversized uploads before the full buffer is even
held in memory).

### `Document.fileUrl` is an internal storage key, not a working URL — and there's no `mimeType` column, by design

The schema comment ("signed, expiring URL — never a public path") doesn't
square with storing an actual signed URL long-term (those expire in
minutes; a DB column can't hold something that's supposed to regenerate on
every request). Interpreted `fileUrl` as the internal storage key
(`{companyId}/{documentId}`) instead — the actual fetchable URL is
produced fresh, every time, by `createSignedUrl()`, per the explicit
"regenerate on each authorized request, never cache a long-lived link"
instruction. Similarly, there's no `mimeType` field to add: the file's
real type is re-detected from its stored bytes at download time
(`fromBuffer` again, same as at upload) rather than trusted from a value
that could in principle drift from what's actually on disk — the bytes
are the single source of truth either way, so storing a redundant,
possibly-stale copy of what they say adds a failure mode for no benefit.

### Signed URLs are app-issued JWTs, not real S3 presigned URLs — same properties, different mechanism

There's no S3 in this step (local disk only), so "signed URL" means a
short-lived JWT (`DocumentTokenService`, own secret `DOCUMENT_URL_SECRET`,
default TTL 10 minutes — within the founder's suggested 5–15 min range)
embedded in `/documents/download?token=...`, verified by that endpoint.
The download endpoint is `@Public()` — it has to be, it's the link itself,
not an API call with an Authorization header — but that means it never
goes through `TenantScopeInterceptor` (which keys off `request.user`, and
there is none here). The token payload carries `companyId` alongside
`documentId` specifically so the download handler can open its own scoped
transaction via `TenantScopedRunner` (the same pre-interceptor pattern
`AuthService` and `RbacGuard` already use) without needing a `request.user`
at all. It then also manually calls `tenantContext.run({tx, companyId},
...)` inside that transaction — nesting `TenantScopedRunner.run` inside
`tenantContext.run` — purely so `AuditService` (which reads
`TenantContextStorage`) keeps working on this one code path that bypasses
the interceptor entirely. **First real precedent for a `@Public()` route
that still needs tenant-scoped DB access + audit logging** — if more
token-gated public endpoints show up later (email-link actions, etc.),
this nesting is the pattern to reuse.

**Known, accepted trade-off:** the `download` audit entry has `userId:
null` — authorization already happened at `createSignedUrl()` time (real
userId, real RBAC + department-scope check, logged), but the actual fetch
of the URL is only provable as "someone holding a valid token," identical
to how S3 presigned URLs work everywhere. Both events are logged, which is
what gives this a real paper trail despite that.

### Employee CRUD: department-scoping extended from reads (step 4) to writes

`own_department` now governs CREATE and UPDATE the same way it already
governed SELECT: `updateMany({ where: { id, ...scopeWhere } })` either
matches the target row or it doesn't — there's no way to edit a row
outside scope by knowing its id, structurally, not by a controller
`if`. CREATE has its own wrinkle: a manager with `own_department` scope
creating a new employee either gets `departmentId` forced to their own
managed department (if omitted) or rejected outright (if they explicitly
name a different one) — the default permission matrix doesn't actually
grant managers `employees:create` at all, so this only matters if a
company_admin explicitly grants it via the RBAC CRUD module (step 4),
which is exactly the scenario the e2e tests exercise.

### Department/Branch: real hard delete, not soft-delete like Employee

Department and Branch have no `status` column (unlike Employee), and the
schema's own FK design already treats deletion as "orphan what pointed
here, don't block it" — `Employee.departmentId` and
`Department.parentDepartmentId` are both `ON DELETE SET NULL`. Adding a
tombstone concept neither model has would be inventing structure the
schema doesn't ask for. Employee soft-deletes because payroll/attendance/
leave history must survive; departments and branches carry no such
history of their own.

### `"org"` added to `RBAC_MODULES` — default-matrix additions don't retroactively apply to existing companies

Department/Branch CRUD + the org chart needed a permission module that
didn't exist before this step. Adding it to `RBAC_MODULES` means
`fullAccess("company_admin")` (and the new explicit `manager: org:view
scope:all` row) apply to every **newly provisioned** company via
`buildRolePermissionRows`, but companies already seeded before this change
don't get the new rows automatically — `RolePermission.createMany({
skipDuplicates: true })` only adds what's missing when explicitly re-run
against them, it doesn't happen on its own. Not a bug, just a fact about
how the seed-by-template system works, worth remembering the next time a
new module gets added: existing demo/pilot companies need `pnpm db:seed`
(or equivalent) re-run to pick up new default grants.

### Two bugs caught by live-testing, not by writing the code

1. **`apps/api/.env.test`'s `FIELD_ENCRYPTION_KEY` was a placeholder
   string** ("test_field_encryption_key_32bytes" — 32+ characters, so it
   passed the Zod `.min(32)` check, but not valid base64 decoding to 32
   raw bytes). Invisible until this step, because no earlier test actually
   called `encryptField`/`decryptField` against the real env value — the
   crypto unit tests generate their own throwaway key. The moment
   `EmployeesService` started encrypting for real in an e2e test, it threw.
   Fixed by generating a real key. **Pattern:** a config value that only
   needs to satisfy a shape check (min length) can look valid while being
   functionally wrong; the gap only shows up once the value is actually
   used for its real purpose, not merely validated.
2. **Raw Prisma-created employee fixtures in e2e tests need `encryptField()`
   applied manually.** Any test fixture that calls
   `superadmin.employee.create()` directly (bypassing `EmployeesService`,
   the same way the CLI/seed scripts intentionally do) writes whatever
   `nationalId`/`bankAccount` it's given as literal plaintext — and the
   moment that row is later read back through `EmployeesService` (a GET, or
   the re-fetch inside `update()`), `decryptField` throws on the
   unencrypted value. Hit this twice (once in step 4's existing fixtures,
   again writing step 5's new ones) before it became a checklist item:
   **any e2e fixture Employee row that will ever be read through the
   service must have its encrypted fields pre-encrypted with the same
   `encryptField` the service itself uses.**

### Post-review: closing two step-5 verification gaps, and a third bug this uncovered

Founder review flagged two things the step-5 summary hadn't confirmed were
actually tested, both now added to `employee-management.e2e-spec.ts`:

1. **Malicious-file rejection, proven over real HTTP, not just at the unit
   level.** `file-validation.spec.ts` already unit-tested
   `validateDocumentFile` directly; added an e2e test that `POST`s real
   Windows PE/MZ executable bytes to `/documents` with a `.pdf` filename and
   asserts the upload is rejected end-to-end, plus that nothing was
   persisted (`document.count` stays 0).
2. **AuditLog rows verified by reading the table directly**, not just
   trusting that `audit.record()` was called. Extended the existing
   fixtures/tests (rather than duplicating them in a new describe block) to
   query `superadmin.auditLog.findFirst(...)` after each action and assert
   `action`/`entity`/`entityId`/`userId`/`companyId` — covering Employee
   create/update/soft-delete and Document upload/generate_signed_url.

**Bug found by writing test #1, not by inspection:** `validateDocumentFile`
throwing `FileValidationError` was reaching `GlobalExceptionFilter`
unhandled and falling through its generic "unknown exception" branch → 500,
instead of the 400 a rejected upload should return. `DocumentsController.upload`
now catches `FileValidationError` specifically and rethrows as
`BadRequestException(error.message)` — safe to do because every
`FileValidationError` message is already client-safe by construction (file
size/type facts, never a path or internal detail). This is exactly the
class of gap the founder's "test that actually proves something" standard
is meant to catch: the malicious bytes WERE being rejected correctly the
whole time, but the wrong status code would have looked like a server bug
to any real client integrating against this endpoint.

---

## 2026-07-28 — Step 4: RBAC module (+ closing two step-3 gaps)

### `RolePermission` is additive-only — no per-user "deny" — **accepted as-is for v1, not an open gap**

The schema has one boolean-ish signal: a row's _existence_ grants
{role/user, module, action}. There is no column meaning "explicitly
revoke this from this one user despite their role normally having it."
So `PermissionCheckService` treats a per-user row (`userId` set) as
strictly additive to the role-wide default (`userId` null), never a
replacement — when both match, the WIDER of the two scopes wins (a
per-user override exists to grant more, not less). A company_admin who
wants to take a permission away from one specific manager while leaving
the rest of that role's grants intact cannot do it through this table as
given.

**Decided 2026-07-28 (post-step-4 review): this stays as-is for v1.**
Deny-list support is real complexity (a `granted: boolean` column or a
sentinel-scope convention, either way a schema change plus new branching
logic in `PermissionCheckService`) with no evidence yet that any pilot
company needs it — building it now would be speculative. **Only revisit
if a pilot company's actual usage surfaces a concrete need** (e.g. "we
need to pull payroll access from one specific manager without touching
the rest of the managers") — not before.

### Minimal `EmployeesModule` — read-only, exists to prove `own_department` scoping, not the real module

`GET /employees` and `GET /employees/:id` are the entire surface right
now — enough to demonstrate `PermissionScope.own_department` filtering
at the query layer with a real, live-testable endpoint, since the actual
Employee Management module (step 5) doesn't exist yet and the founder's
step 4 ask explicitly required a _live_ test proving cross-department
access is blocked, not just a unit test against a mocked service. Step 5
builds CRUD, documents, and org chart on top of this same
`EmployeesService`/scoping pattern — this isn't throwaway, it's the
foundation, just deliberately not the whole module yet.

### Guard chain order: `AuthGuard -> MustChangePasswordGuard -> RbacGuard -> TenantScopeInterceptor`

Explicit, not just implicit in registration order. Each stage depends on
the one before it having already run:

1. **AuthGuard** — verifies the access token, sets `request.user =
{sub, companyId, role}`. Everything downstream reads this. Routes opt
   out entirely with `@Public()`.
2. **MustChangePasswordGuard** — re-reads the user's _current_
   `mustChangePassword` from the DB (not a token claim — see the
   staleness reasoning in its own doc comment) and blocks everything
   except `/auth/password/change` if it's true.
3. **RbacGuard** — for routes declaring `@RequirePermission(module,
action)`, resolves `role`/`companyId`/`userId` against
   `PermissionCheckService` and denies with 403 if unpermitted. Stashes
   the resolved `PermissionScope` on `request.permissionScope` for
   downstream repository-layer filtering (department-scoped queries).
4. **TenantScopeInterceptor** — opens the request's main tenant-scoped
   Prisma transaction (`SET LOCAL app.current_company_id`) and runs the
   controller handler inside it.

**Why guards 2 and 3 can't just use the interceptor's transaction:**
Nest's request lifecycle runs ALL guards before ANY interceptor's
pre-handler logic — interceptors wrap the route handler itself, which
guards run before even reaching. `TenantContextStorage` (what the
interceptor populates) doesn't exist yet at guard time. Both
`MustChangePasswordGuard` (via `PrismaAuthService`, the same narrow
hrms_auth-bound connection login uses) and `RbacGuard` (via
`PermissionCheckService` → `TenantScopedRunner`, extracted this step from
what was `AuthService`'s private `runScoped` — see below) open their own
short-lived, separate scoped connection/transaction rather than waiting
for one that isn't open yet. **Consequence worth knowing:** a single
request that hits both a `@RequirePermission()`-gated route AND does
tenant-scoped work in its controller runs _two_ separate Postgres
transactions — one for the permission check, one for the actual business
logic. They're independent, short, read-committed; this is normal and not
a correctness concern, but it's a real, non-obvious fact about the
request's DB footprint worth remembering when reasoning about query
counts or transaction-scoped locking later.

### `TenantScopedRunner` extracted from `AuthService`

`AuthService` already had exactly this "open a short scoped
transaction/connection outside the interceptor" pattern (`runScoped`,
step 3) for the same structural reason: auth flows run before any
access-token-derived `request.user` exists for the interceptor to key
off. Once `RbacGuard`/`PermissionCheckService` needed the identical
pattern, it was pulled out into `database/prisma/tenant-scoped-runner.service.ts`
and `AuthService` now depends on it too, rather than each having its own
copy that could drift.

### Bug found during live testing: `/auth/logout` was `@Public()`, silently exempt from `MustChangePasswordGuard`

Built `MustChangePasswordGuard` to skip both `@Public()` and
`@SkipMustChangePasswordCheck()` routes (the latter for
`/auth/password/change` only). Didn't initially notice that `/auth/logout`
was _also_ marked `@Public()` (from step 3, so a user could always log out
regardless of session state) — which meant it had no `request.user` for
the guard to check at all, so it passed through unblocked even with
`mustChangePassword: true`. Caught by live-testing the guard end-to-end
(logged in as a fresh temp-password account, hit `/auth/logout` with a
valid access token, got `204` instead of the expected `403`) rather than
by the unit tests, which only exercised the guard's own logic in
isolation and had no way to know logout was public. Fixed by removing
`@Public()` from `/auth/logout` — it now requires a valid access token,
same as everything else, closing the gap. Trade-off: a client with an
already-expired access token can't call this endpoint server-side
anymore; discarding the token client-side is sufficient in that case,
since an expired token would fail `AuthGuard` regardless of session
state. **Pattern worth remembering:** whenever a new guard is added to
the chain, re-audit which existing routes are `@Public()` — each one is
invisible to any guard that (like this one) treats "no request.user" as
automatically pass.

### Global exception filter: backstop, not a replacement for explicit handling

`GlobalExceptionFilter` (`common/filters/`) catches whatever reaches it
unconverted: raw `jsonwebtoken` errors, `Prisma.PrismaClientKnownRequestError`
(P2002 → 409, P2025 → 404, everything else → 500), and any other
`Error` → generic 500. It does **not** replace the explicit
`try/catch → UnauthorizedException` wrappers already in `AuthService`
(`verifyPending`, `verifyPasswordReset`) — those still exist because they
produce better, more specific client messages ("Invalid or expired
session" vs. the filter's generic "Invalid or expired token"). The filter
exists for everything nobody thought to wrap explicitly, which is exactly
the category step 3's bug fell into. Every path through it logs the real
error server-side (`Logger`, full stack) and returns only a generic,
safe message client-side — verified with a unit test asserting a message
containing a fake password never appears in the JSON response body.

---

## 2026-07-27 — Step 3: Auth module

### Bug found during live testing: invalid pending tokens returned 500, not 401

`TokenService.verifyPendingToken`/`verifyPasswordResetToken` throw raw
`jsonwebtoken` errors (`JsonWebTokenError`, `TokenExpiredError`) — fine for
a purely computational service with no notion of HTTP, but every
`AuthService` call site was calling them directly, so an invalid/expired/
malformed token on `/auth/2fa/enroll`, `/auth/2fa/enable`,
`/auth/2fa/verify`, or `/auth/password-reset/confirm` produced an
unhandled exception → generic 500, not a clean 401. Caught live while
running the real end-to-end demo (a garbage `pendingToken` during manual
testing), not by unit tests, since the unit tests only exercised
`TokenService` directly (where throwing a plain error is correct
behavior) — the gap was at the integration boundary. Fixed with two
private `AuthService` wrappers (`verifyPending`, `verifyPasswordReset`)
that catch and rethrow as `UnauthorizedException`. **Worth remembering:**
this class of bug — a lower-layer service's plain `throw` reaching the
HTTP layer unconverted — won't show up in service-level unit tests; it
needs either an integration/e2e test per endpoint or a global exception
filter (`common/filters/`, still empty) that maps known non-HTTP error
types to sensible status codes as a backstop. The filter is the more
scalable fix long-term; not built this step, flagged for the RBAC module
or whenever the filter gets its first real content.

### Refresh tokens are opaque random values, not JWTs — `JWT_REFRESH_SECRET` removed

The `RefreshToken` model stores `tokenHash`, not a signature-verifiable
token — that column shape only makes sense if the token itself is an
opaque random value (hash it, store the hash, compare hashes on refresh),
not a JWT (which needs no server-side storage to verify, since its
signature is self-contained — storing _just its hash_ would be an unusual,
redundant design for a JWT). Implemented refresh tokens as
`crypto.randomBytes(32)` (base64url), with only `sha256(raw)` ever touching
the database. `JWT_REFRESH_SECRET`, present in step 1's `.env.example` as a
placeholder for later, is removed — there is nothing for it to sign.
Access tokens remain JWTs (`JWT_ACCESS_SECRET`), as specified.

### Least-privilege login role (`hrms_auth`) vs. Super Admin connection

Step 2 flagged an unresolved tension: login happens by email, before the
system knows which company the user belongs to, so the very first query
can't have `app.current_company_id` set — the RLS-enforced `hrms_app`
connection would see zero rows (fail-closed) on that lookup. The founder's
direction: solve this with a **dedicated, narrowly-scoped role**
(`hrms_auth`), not by routing login through `hrms_superadmin`
(`BYPASSRLS`). Implemented as `hrms_auth`:

- `GRANT SELECT` on exactly the `User` columns login/2FA/lockout need
  (`id, email, passwordHash, role, companyId, twoFaSecret, twoFaEnabled,
failedLoginAttempts, lockedUntil, mustChangePassword`) — nothing else.
- `GRANT UPDATE (failedLoginAttempts, lockedUntil)` only — actual password
  changes (reset, forced-change) go through the tenant-scoped or superadmin
  connection instead, whichever applies, never through `hrms_auth`.
- No grant at all on any other table.
- Two new RLS policies scoped `TO hrms_auth` (`FOR SELECT ... USING
(true)`, `FOR UPDATE ... USING (true) WITH CHECK (true)`) so it isn't
  blocked by `tenant_isolation`'s fail-closed default — Postgres ORs
  multiple applicable permissive policies together, so this doesn't weaken
  `tenant_isolation` for any other role.

**Why not `hrms_superadmin`:** least-privilege / blast-radius reasoning —
`BYPASSRLS` means a bug anywhere in the login code path (or in whatever
future code reuses that connection) could read or write _any_ row in _any_
table for _any_ company. `hrms_auth` physically cannot — there's no GRANT
on `Employee`, `Payslip`, etc., so even a query built entirely wrong
against this role fails at the permissions layer, several layers before
RLS logic would even matter. Login is the highest-traffic, most
externally-reachable code path in the whole system (unauthenticated,
internet-facing); it should have the smallest possible blast radius, not
the largest.

**Multi-company email collision:** `@@unique([companyId, email])` means
the same email can exist across multiple companies. `PrismaAuthService`
handles this by fetching _all_ matching rows for that email via
`hrms_auth`, then running `argon2.verify` against each candidate's
`passwordHash` — since password hashes are unique per account, only the
row whose actual password matches the submitted one will verify, which
naturally disambiguates without needing a company-selection step in the
UI. If none verify, the response is the generic "invalid credentials"
either way (see below).

### Password reset tokens are stateless (signed JWT), not a DB table — and ARE effectively single-use

### [Corrected 2026-07-28 — the original version of this entry undersold what was actually built; see below]

The given schema has no `PasswordResetToken` model, and "short-lived
signed tokens sent by email" (the founder's own phrasing) is exactly what
a signed, expiring JWT is — no new table needed. No separate persistence
layer for single-use tracking either: the token's payload embeds
`currentHashFingerprint` — `sha256(user.passwordHash)` at issuance time,
truncated (`TokenService.hashFingerprint`) — and `confirmPasswordReset`
re-checks that fingerprint against the user's _current_ `passwordHash`
before honoring the token. Using the token successfully changes
`passwordHash`, which means the fingerprint embedded in that same token
(or any other outstanding copy of it) no longer matches anything —
replaying it fails with the same generic "Invalid or expired reset token"
regardless of the token's own expiry. Confirmed live: requested a reset,
confirmed it (200, password changed), then replayed the identical
still-unexpired token — rejected (401). See
`apps/api/test/auth.e2e-spec.ts` for the same proof as an automated test.

Remaining edge case, inherent to any single-use-without-a-lock design, not
specific to this implementation: if a token is captured in transit and
both the legitimate user and an attacker race to use it, whichever request
reaches the server first wins; the second fails because the first already
changed `passwordHash`. That's a race on which use wins, not a
replay/reuse vulnerability — the original entry's framing ("a second reset
is possible... before it expires") was simply wrong and has been corrected
here rather than left standing.

### Password reset emails aren't actually sent yet

There's no Notifications module yet (it's module #8 in the project plan,
scheduled after core HR modules). `POST /auth/password-reset/request`
generates the token and logs the reset link via Nest's `Logger` instead of
emailing it — the response body never includes the link (that would leak
account existence, the exact thing this endpoint is designed to avoid
disclosing). This is a deliberate stopgap, not a finished feature — wire
this into the real Notifications module when it exists.

### Argon2id cost parameters: OWASP's minimum-recommended profile, not the library defaults

`node-argon2`'s own defaults are `{ type: argon2i, memoryCost: 65536,
timeCost: 3, parallelism: 4 }` — note the default _type_ isn't even
`argon2id`. Used `{ type: argon2id, memoryCost: 19456 (19 MiB), timeCost:
2, parallelism: 1 }` instead — OWASP's Password Storage Cheat Sheet
current minimum-recommended argon2id profile. Chose the _minimum_ profile
over a heavier one specifically because of the target deployment (a single
small VPS running API + Postgres + Redis + Next.js together, per the
project plan's hosting section) — a heavier profile (e.g. OWASP's
46 MiB/t=1/p=1 or 64 MiB/t=3/p=4 alternatives) would compete for memory
with Postgres/Redis under concurrent login load. **Revisit if:** the VPS
is upgraded or split, or if login throughput/memory contention becomes an
observed problem — either direction (lighter or heavier) is a one-line
change in `PasswordService`, not a migration.

### JWT access token TTL / refresh cookie flags

`JWT_ACCESS_TTL=15m` / `JWT_REFRESH_TTL=7d` were already fixed by the
founder's spec, unchanged. Refresh cookie: `httpOnly: true` and
`sameSite: "lax"` always; `secure` is `NODE_ENV === "production"` only —
plain HTTP `localhost` dev would never receive the cookie back with
`secure: true` forced on. This is standard practice, not a security
compromise (the non-negotiable is that dev and prod behave correctly for
their respective transport, not that dev pretends to be HTTPS).
`sameSite: "lax"` (not `"strict"`) so a follow-on top-level navigation from
an external link still carries the cookie — revisit toward `"strict"` once
the web app's auth flows are built and this can be tested against real
cross-site navigation patterns.

### `TotpIssuer` / TOTP library: `otplib`

`otplib` is the library named in the Project Plan doc itself
("TOTP-based 2FA (e.g. `otplib`)"), so used it rather than evaluating
alternatives. `TOTP_ISSUER` (shown in authenticator apps next to the
account name) defaults to `HRMS`, overridable per environment — not
secret, just branding, so it's a plain env var rather than a hardcoded
constant.

### Field encryption: explicit call-site helper, not an automatic Prisma extension — for now

The architecture spec calls for "a single reusable Prisma extension/wrapper
... so no service can forget to apply it." Implemented `encryptField` /
`decryptField` (AES-256-GCM) as plain exported functions that
`TwoFactorService` calls explicitly at the two points that touch
`twoFaSecret` (write on enrollment, read on verification), rather than a
Prisma Client Extension (`$extends`) applied transparently to every query.
Reason: `$extends()` returns a differently-typed client instance, which
doesn't compose cleanly with the `class PrismaService extends PrismaClient`

- `OnModuleInit`/`OnModuleDestroy` pattern already established in step 2
  and used throughout the interceptor/tests — switching now would mean
  threading a new client shape through everything built in step 2. With only
  one encrypted field actually in play this step (`twoFaSecret`), the
  explicit-call approach is small and auditable (two call sites, both in one
  file). **Revisit when the Employee module adds `nationalId` /
  `bankAccount`** (more fields, more call sites, more chances to forget) —
  worth restructuring `PrismaService` to hold an extended client internally
  at that point instead of subclassing directly.

### `mustChangePassword` added to `User`

Not in the original schema. Needed to represent "temp password, forced
change on first login" (explicitly requested for the company/admin
creation CLI) — there was no existing field that could carry this state.
Purely additive. Currently **advisory, not server-enforced**: the login
response surfaces `mustChangePassword: true` so a client can redirect to a
change-password screen, but no guard currently blocks _other_ endpoints
until it's cleared (there aren't enough other endpoints yet for that to
matter). Revisit alongside the RBAC module (step 4) once there's a
meaningful set of routes to gate.

---

## 2026-07-27 — Step 2: Database schema, migrations, RLS

### Three Postgres roles, not one — required for RLS to actually do anything

Postgres table **owners bypass RLS by default**, regardless of any policy
defined on the table. `prisma migrate` necessarily runs as an owner (needs
DDL + shadow-DB rights), so if the running app also connected as that same
owner, every RLS policy in this step would be silently inert — `ENABLE ROW
LEVEL SECURITY` would report success and nothing would actually be
isolated. Introduced three distinct roles instead of the single `hrms` user
step 1's `.env.example` originally assumed:

- `hrms` — schema owner. Used only by the Prisma CLI, via a new
  `DATABASE_MIGRATE_URL` env var wired through Prisma's `directUrl`
  (separate from the runtime `url`). Never used by the running app.
- `hrms_app` — regular tenant runtime role (`DATABASE_URL`). Not the owner,
  not `BYPASSRLS`, so `tenant_isolation` policies actually apply to it.
- `hrms_superadmin` — `BYPASSRLS` role (`DATABASE_SUPERADMIN_URL`), for the
  dedicated Super Admin connection.

Both roles are created + granted in the `enable_rls_and_roles` migration
(structure only, no passwords — that file is committed to git). Passwords
are set separately by `src/database/seeds/bootstrap-roles.ts`, reading
`HRMS_APP_DB_PASSWORD` / `HRMS_SUPERADMIN_DB_PASSWORD` from the environment,
run once per environment after migrating. **Revisit if:** a connection
pooler (PgBouncer) is introduced later — `directUrl` vs `url` semantics
interact with pooling and may need adjustment.

### Dev Postgres remapped to host port 5433

This dev machine has a native Windows PostgreSQL 18 service already bound
to port 5432. `docker compose up` didn't error on the conflict (Docker
Desktop/WSL2 didn't surface it as a hard failure), it silently meant the
container's host-side port publish never actually won the bind — host
connections to `localhost:5432` were silently going to the native service
instead of the container, causing confusing auth failures against
seemingly-correct credentials. `docker-compose.yml` now publishes Postgres
on host port **5433** (container-internal `postgres:5432`, used by
containerized `api`/`web` services, is unaffected). If you hit `P1000`
auth errors against `localhost:5432` on a fresh machine, check
`Get-NetTCPConnection -LocalPort 5432` for a pre-existing listener before
assuming the credentials are wrong.

### `Company` model was missing 9 of its 13 back-relations

The schema as given in the prompt only listed `users`, `employees`,
`departments`, `branches` on `Company`, but `Document`, `Shift`,
`AttendanceRecord`, `LeaveType`, `LeaveRequest`, `LeaveBalance`,
`PayrollRun`, `Payslip`, and `AuditLog` all declare a `company Company
@relation(...)` field pointing at it. Prisma requires both sides of a
relation to be declared; `prisma validate` failed with 9 "missing opposite
relation field" errors. Added the missing back-relation arrays to `Company`
— this is additive only (no fields/behavior removed), so it doesn't change
anything the founder specified, it just completes what was already implied.

### RLS comparisons use plain text, not `::uuid`

The RLS policy pattern given in the prompt (`company_id =
current_setting(...)::uuid`) assumes a native Postgres `uuid` column type.
Prisma's `String @id @default(uuid())` (no `@db.Uuid`) generates plain
`TEXT` columns — `prisma migrate` failed applying the policies with
`operator does not exist: text = uuid`. All policies compare `text = text`
instead; UUID format validation happens application-side, in
`TenantScopeInterceptor`, before the value is ever interpolated into SQL.

### `current_setting(..., true)` (missing_ok), not the bare form from the prompt

Added the `missing_ok` boolean the prompt's example didn't include. Without
it, any query running without a prior `SET LOCAL app.current_company_id` —
a bug, a stray script, a future code path that forgets — would throw a hard
Postgres error. With `missing_ok = true`, the setting resolves to `NULL`
instead, and `company_id = NULL` is never true, so the policy fails
**closed** (zero rows, matching the founder's "safety net against app-layer
bugs" framing) rather than erroring. Trade-off: a forgotten `SET LOCAL`
during development now looks like "no data" instead of a loud error —
acceptable given the non-negotiable is data isolation, not developer
convenience.

### `Company` table itself is RLS-scoped on `id`, and blocks tenant-role INSERTs by design

Not explicitly specified in the prompt (the RLS example only covered
`employees`), but the non-negotiable "every tenant table" implies `Company`
too — a Company Admin shouldn't be able to read other companies' names or
settings via a bug. Policy compares `id`, not `company_id` (Company _is_
the tenant). Side effect, confirmed intentional: `hrms_app` can never
INSERT a new `Company` row, because no session variable value could ever
equal a not-yet-created company's id. This is correct, not a bug — it means
company provisioning is structurally impossible except through the
`hrms_superadmin` (BYPASSRLS) connection, which matches the "no public
signup, admin-CLI-only" decision already on record.

### `RefreshToken` RLS uses a subquery, not a direct `company_id` column

The `RefreshToken` model as given has no `company_id` column — it's scoped
by `userId` only. Rather than adding a column (a schema change beyond what
was specified), its policy does `EXISTS (SELECT 1 FROM "User" WHERE
"User".id = "RefreshToken"."userId" AND "User"."companyId" = ...)`. Same
isolation guarantee, no schema deviation.

### `Holiday` RLS: read includes global rows, write does not

`Holiday.companyId = NULL` means "system-wide calendar" per the schema's
own comment. A literal `company_id = current_setting(...)` policy would
make every tenant's session unable to see the NULL/global rows at all
(`NULL = anything` is never true) — clearly wrong given the documented
intent. Policy `USING` clause is `company_id = current_setting(...) OR
company_id IS NULL` (tenants can read their own + global holidays). Added
an explicit stricter `WITH CHECK (company_id = current_setting(...))` (no
`OR IS NULL`) so a tenant-scoped connection can never _write_ a global
holiday — only `hrms_superadmin` can maintain the shared calendar, same
reasoning as `Company` above.

### Default `RolePermission` seed rows: `superadmin` is deliberately absent

`RolePermission.companyId` is required (non-nullable), and `superadmin` is
explicitly the one role that isn't company-scoped (`User.companyId` is null
only for superadmin). Seeding "default superadmin permission rows," as the
step 2 instructions listed, isn't structurally coherent against this
schema — there's no company to attach the rows to, and superadmin's access
model is fundamentally different (cross-tenant, BYPASSRLS connection, not a
per-company permission matrix). Only `company_admin` / `manager` /
`employee` get seeded rows. **Flagging for the RBAC module (step 4):** the
permission-check service should short-circuit `role === 'superadmin'` to
always-allow rather than querying `RolePermission` at all.

### Seed scripts connect via the `hrms_superadmin` (BYPASSRLS) role

`src/database/seeds/seed.ts`, `bootstrap-roles.ts`, and `verify-rls.ts` all
need to write data before any tenant session context exists (there's no
`company_id` to `SET LOCAL` to before a `Company` row exists). This mirrors
how the future company-provisioning admin CLI (step 3) will necessarily
work too. `default-role-permissions.ts` exports a reusable
`buildRolePermissionRows(companyId)` specifically so the real
company-creation flow can call the same template instead of duplicating it.

### `apps/api/.env.test` follows the same gitignored-with-`.example` pattern as `.env`

Initially committed real local dev passwords directly into `.env.test`
(tracked). Fixed before anything was committed: `.env.test` is now
gitignored, `.env.test.example` (placeholders only) is tracked. e2e tests
currently point at the same dev Postgres container as `apps/api/.env` —
there's no isolated test database yet, which is fine while the only e2e
test is a read-only health check. **Get a dedicated test database before
writing e2e tests that mutate data.**

### `TenantScopeInterceptor` exists and is unit-tested, but is not yet registered in `AppModule`

It reads `request.user.companyId`, which nothing populates yet — the Auth
module (step 3) hasn't been built. Registering it globally now would make
it a permanent no-op. `PrismaModule` (which it depends on) _is_ wired into
`AppModule` already, since `PrismaService`/`PrismaSuperAdminService` connect
at boot regardless. The interceptor itself gets wired in alongside
`AuthGuard`/`RbacGuard` in step 3/4.

### Flagged, not resolved: login-by-email lookup vs. RLS on `User`

The `User` table now has the same `tenant_isolation` policy as every other
tenant table (`companyId = current_setting(...)`). But login happens by
email _before_ the system knows which company the user belongs to
(`@@unique([companyId, email])` means email isn't globally unique — the
same email can exist in multiple companies) — so the very first query of
the login flow can't have `app.current_company_id` set yet, because
determining it _is_ the point of that query. This will block step 3's
login flow under the RLS-enforced `hrms_app` connection as currently
designed. Not resolved here — deliberately left for step 3, since it's a
security-relevant design choice (candidates: a narrow, explicitly-audited
use of `hrms_superadmin` for just the pre-auth lookup step; a
subdomain/company-code-first login flow instead of email-first; something
else) that should be discussed rather than silently picked.

---

## 2026-07-27 — Step 1: Repo scaffolding

### Source documents were outside the repo root

`HRMS-Project-Plan.md` and `HRMS-Technical-Architecture-Security-Design-Spec.md`
were found in a sibling `Desktop/files/` folder, not in `hrms/`. Copied both
into the repo root so they travel with the project and match the paths
referenced throughout both documents. If they get edited going forward, edit
the copies in the repo root — treat those as canonical.

### pnpm installed via `npm install -g pnpm@9`, not corepack

`corepack enable pnpm` failed with `EPERM` writing to `C:\Program
Files\nodejs\` (needs admin rights on this machine). Fell back to a global
npm install of pnpm 9.15.9, pinned in root `package.json`'s
`packageManager` field. Revisit if this machine's Node install ever changes
or if CI needs a different pnpm provisioning method.

### Dev `docker-compose.yml` runs api/web from plain `node:22-alpine`, no Dockerfiles yet

For step 1 (scaffolding only, no business logic), `api` and `web` services
mount the repo as a volume and run `pnpm install && pnpm --filter ... dev`
directly from the base Node image, rather than maintaining `Dockerfile.dev`
for each app. This keeps the compose file honest with "no business logic
yet" while still giving a working dev loop (`docker compose up`). Production
Dockerfiles (multi-stage builds, non-root user, slim final image) should be
added when the platform is closer to deployment — not needed for local dev.

### Root ESLint config is per-app, not a single shared config

`apps/api` uses NestJS's typical flat-config (`typescript-eslint` +
`eslint-plugin-prettier`) and `apps/web` uses `eslint-config-next`, because
the two ecosystems' recommended configs don't compose cleanly into one
shared flat config without fighting Next's `FlatCompat` shim. Both defer to
the root `.prettierrc.json` for formatting so style stays consistent even
though lint rule sets differ per app. Revisit only if a real cross-app lint
rule conflict shows up in practice.

### `packages/shared/locales-schema` ships a real key-parity checker, not a placeholder

Step 1 is scoped to "no business logic," but a locale key-parity check is
tooling/lint infrastructure, not HR domain logic, and the project plan
explicitly calls for i18n key parity "from the very first component built."
Implemented `checkLocaleParity()` with a unit test now so `en.json`/
`ar.json`/`ku.json` drift is caught immediately once real screens start
adding keys, rather than retrofitted later.

### Seed i18n keys are placeholder/machine-quality Arabic and Sorani

`apps/web/src/locales/{en,ar,ku}.json` and `apps/api/src/i18n/{en,ar,ku}/emails.json`
have a small starter key set with my best-effort (not native-speaker-reviewed)
Arabic and Sorani translations, purely to prove the key-parity mechanism and
give real strings to build the first screens against. Per the spec's i18n
section: **plan a native Sorani speaker review pass before launch** — do not
ship these translations to real users unreviewed.

### Numerals: Western numerals (0123) by default for Arabic/Sorani UI

Per the spec's explicit flag-for-revisit: using Western numerals in `ar`/`ku`
locales (not Eastern Arabic ٠١٢٣), matching common regional business-software
convention. No code enforces this yet (no number formatting exists at step

1. — this entry exists so the decision is visible before `Intl.NumberFormat`
   locale configs are wired up in a later step. **Revisit after pilot customer
   feedback**, per the spec.

---
