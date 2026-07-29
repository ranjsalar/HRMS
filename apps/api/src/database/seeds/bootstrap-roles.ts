import "dotenv/config";
import { Client } from "pg";

/**
 * Sets login passwords for the hrms_app / hrms_superadmin / hrms_auth
 * roles created by the enable_rls_and_roles and add_hrms_auth_role
 * migrations. Kept out of the migration SQL itself (which is committed to
 * git) — run this once per environment after migrating, using that
 * environment's own secrets.
 *
 * Connects as the schema owner (DATABASE_MIGRATE_URL), the only role with
 * privilege to ALTER other roles.
 */
async function main(): Promise<void> {
  const migrateUrl = requireEnv("DATABASE_MIGRATE_URL");
  const appPassword = requireEnv("HRMS_APP_DB_PASSWORD");
  const superadminPassword = requireEnv("HRMS_SUPERADMIN_DB_PASSWORD");
  const authPassword = requireEnv("HRMS_AUTH_DB_PASSWORD");

  const client = new Client({ connectionString: migrateUrl });
  await client.connect();

  try {
    await client.query(`ALTER ROLE hrms_app WITH PASSWORD '${escapeSqlString(appPassword)}'`);
    await client.query(
      `ALTER ROLE hrms_superadmin WITH PASSWORD '${escapeSqlString(superadminPassword)}'`,
    );
    await client.query(`ALTER ROLE hrms_auth WITH PASSWORD '${escapeSqlString(authPassword)}'`);
    console.log("hrms_app, hrms_superadmin, and hrms_auth passwords set.");
  } finally {
    await client.end();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ALTER ROLE ... PASSWORD does not support bind parameters (like SET, it's
// DDL, not DML) — standard SQL single-quote escaping is used instead. The
// values here come from trusted environment variables, not user input.
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
