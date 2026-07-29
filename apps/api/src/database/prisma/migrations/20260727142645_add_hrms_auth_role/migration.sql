-- ═══════════════════════════════════════════════════════════════════════
-- hrms_auth: a narrowly-scoped role for the pre-authentication login
-- lookup, distinct from both hrms_app (RLS-scoped, needs a company_id we
-- don't have yet at this point in the request) and hrms_superadmin
-- (BYPASSRLS — far too broad a blast radius for a login-path bug; a bug
-- there should be able to leak at most the columns below, never any other
-- table). See DECISIONS.md ("Least-privilege login role vs. Super Admin
-- connection") for the full reasoning.
--
-- Password is set separately by bootstrap-roles.ts (HRMS_AUTH_DB_PASSWORD),
-- same as hrms_app / hrms_superadmin — not embedded in this committed file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_auth') THEN
    CREATE ROLE hrms_auth WITH LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hrms_auth;

-- Column-scoped grants: hrms_auth can read exactly the fields the login /
-- 2FA / lockout flow needs, and can write exactly the two lockout-tracking
-- fields. No grant at all on any other table (Employee, Payslip, ...) —
-- that's not an RLS policy choice, it's the absence of a GRANT, so even a
-- bug in policy logic can't expose that data through this role: Postgres
-- checks table/column privileges before RLS is even evaluated.
GRANT SELECT (
  id,
  email,
  "passwordHash",
  role,
  "companyId",
  "twoFaSecret",
  "twoFaEnabled",
  "failedLoginAttempts",
  "lockedUntil",
  "mustChangePassword"
) ON "User" TO hrms_auth;

GRANT UPDATE ("failedLoginAttempts", "lockedUntil") ON "User" TO hrms_auth;

-- The existing `tenant_isolation` policy on "User" (from
-- enable_rls_and_roles) applies to every role, including hrms_auth, since
-- it was declared without a `TO` clause. Its USING expression evaluates to
-- NULL/false for hrms_auth (no app.current_company_id is set — that's
-- exactly what login is trying to determine). Postgres OR's together all
-- applicable PERMISSIVE policies for a given role+command, so adding a
-- second, hrms_auth-only policy with USING (true) is enough to grant
-- access without touching or weakening tenant_isolation for any other
-- role. This is deliberately row-permissive (any row, any company) —
-- the column-level GRANTs above are what keep this narrow, not row
-- filtering.
CREATE POLICY auth_lookup_select ON "User"
  FOR SELECT
  TO hrms_auth
  USING (true);

CREATE POLICY auth_lockout_update ON "User"
  FOR UPDATE
  TO hrms_auth
  USING (true)
  WITH CHECK (true);
