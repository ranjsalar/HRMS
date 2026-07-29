-- ═══════════════════════════════════════════════════════════════════════
-- Roles
-- ═══════════════════════════════════════════════════════════════════════
-- Postgres table OWNERS bypass Row-Level Security by default, regardless of
-- any policy defined below — this migration itself runs as the owner role,
-- so RLS only has teeth if the *application* connects as a different,
-- non-owner, non-superuser role. Hence two additional roles:
--
--   hrms_app         — regular tenant runtime traffic. RLS-enforced.
--   hrms_superadmin  — BYPASSRLS. Used only for the dedicated Super Admin
--                      connection, after the authenticated user's role is
--                      confirmed superadmin server-side.
--
-- Passwords are intentionally NOT set here (this file is committed to git).
-- They're set separately by src/database/seeds/bootstrap-roles.ts, which
-- reads them from HRMS_APP_DB_PASSWORD / HRMS_SUPERADMIN_DB_PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_superadmin') THEN
    CREATE ROLE hrms_superadmin WITH LOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hrms_app, hrms_superadmin;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hrms_app, hrms_superadmin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hrms_app, hrms_superadmin;

-- Ensures tables created by future migrations (run as this same owner role)
-- are automatically granted to both roles too, so nobody has to remember to
-- add a GRANT every time a new model/table is added.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_app, hrms_superadmin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hrms_app, hrms_superadmin;

-- ═══════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════
-- Every policy reads the session variable via current_setting(..., true)
-- (missing_ok = true) rather than current_setting(...) alone. If a
-- connection ever queries these tables without the TenantScopeInterceptor
-- having run SET LOCAL app.current_company_id first (e.g. a bug, a stray
-- script), missing_ok means the setting resolves to NULL instead of
-- throwing — and company_id = NULL is never true, so the policy fails
-- closed (zero rows) rather than erroring or, worse, matching everything.
--
-- No ::uuid cast on either side: Prisma's `String @id @default(uuid())`
-- (no @db.Uuid) generates plain TEXT columns, not the native Postgres uuid
-- type, so comparisons are text = text throughout. Format validation
-- happens application-side, in the interceptor that sets this variable.

-- Company is the tenant itself, not a tenant-owned row, so its policy
-- compares against `id`, not `company_id`. Note this also means the
-- RLS-enforced hrms_app role can never INSERT a new Company row (there's no
-- session var value that could equal a not-yet-created company's id) —
-- that's intentional: company provisioning is a Super Admin (BYPASSRLS)
-- operation only, matching the "no public signup" decision.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Company"
  USING (id = current_setting('app.current_company_id', true));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("companyId" = current_setting('app.current_company_id', true));

-- RefreshToken has no company_id column in the given schema (it's scoped by
-- userId, not tenant, directly). Isolation is enforced via a subquery
-- against User instead of a direct column comparison — see DECISIONS.md.
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RefreshToken"
  USING (
    EXISTS (
      SELECT 1 FROM "User"
      WHERE "User".id = "RefreshToken"."userId"
        AND "User"."companyId" = current_setting('app.current_company_id', true)
    )
  );

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RolePermission"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Branch"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Employee"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Shift"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendanceRecord"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "LeaveType" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveType"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveRequest"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "LeaveBalance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveBalance"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollRun"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Payslip" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payslip"
  USING ("companyId" = current_setting('app.current_company_id', true));

-- Holiday rows with company_id = NULL are the system-wide default calendar
-- (per the schema's own documented semantics) and must be readable by every
-- tenant, so USING is OR'd with an IS NULL check. WITH CHECK is deliberately
-- stricter than USING (no IS NULL branch): a tenant-scoped connection may
-- read global holidays but may only write rows scoped to its own
-- company_id. Seeding/editing the global calendar itself is a Super Admin
-- (BYPASSRLS) operation, same as Company provisioning above.
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Holiday"
  USING (
    "companyId" = current_setting('app.current_company_id', true)
    OR "companyId" IS NULL
  )
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("companyId" = current_setting('app.current_company_id', true));
