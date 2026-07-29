import "dotenv/config";
import { Client } from "pg";

/**
 * Proves hrms_auth's least-privilege grants actually hold at the database
 * level — connects directly as hrms_auth (not through Prisma's generated
 * client, so nothing about column selection is implicitly narrowed by
 * application code) and confirms:
 *   1. the exact granted SELECT columns on "User" work
 *   2. selecting an ungranted column ("createdAt") on "User" is denied
 *   3. any access at all to "Employee" (a table with zero grants) is denied
 *   4. UPDATE on the two granted lockout columns works
 *   5. UPDATE on any other "User" column ("email") is denied
 * Exits non-zero on any unexpected result.
 */

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`${GREEN}PASS${RESET} ${label}`);
  } else {
    failures += 1;
    console.log(`${RED}FAIL${RESET} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function expectDenied(client: Client, sql: string): Promise<boolean> {
  try {
    await client.query(sql);
    return false; // should have thrown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /permission denied/i.test(message);
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: requireEnv("DATABASE_AUTH_URL") });
  await client.connect();

  try {
    const granted = await client.query(
      `SELECT id, email, "passwordHash", role, "companyId", "twoFaSecret", "twoFaEnabled",
              "failedLoginAttempts", "lockedUntil", "mustChangePassword"
       FROM "User" LIMIT 1`,
    );
    check("hrms_auth can SELECT the exact granted columns on User", granted !== undefined);

    check(
      'hrms_auth is denied SELECT on an ungranted User column ("createdAt")',
      await expectDenied(client, 'SELECT "createdAt" FROM "User" LIMIT 1'),
    );

    check(
      "hrms_auth is denied any access to Employee (zero grants on that table)",
      await expectDenied(client, 'SELECT id FROM "Employee" LIMIT 1'),
    );

    check(
      "hrms_auth is denied any access to Payslip (zero grants on that table)",
      await expectDenied(client, 'SELECT id FROM "Payslip" LIMIT 1'),
    );

    const lockoutUpdateOk = await client
      .query(
        `UPDATE "User" SET "failedLoginAttempts" = 0, "lockedUntil" = NULL WHERE id = 'nonexistent-id-00000000'`,
      )
      .then(() => true)
      .catch(() => false);
    check("hrms_auth CAN UPDATE the granted lockout columns", lockoutUpdateOk);

    check(
      "hrms_auth is denied UPDATE on an ungranted User column (email)",
      await expectDenied(
        client,
        `UPDATE "User" SET email = 'x@example.com' WHERE id = 'nonexistent-id-00000000'`,
      ),
    );

    check(
      "hrms_auth is denied UPDATE on passwordHash (password changes must go through the tenant/superadmin connection)",
      await expectDenied(
        client,
        `UPDATE "User" SET "passwordHash" = 'x' WHERE id = 'nonexistent-id-00000000'`,
      ),
    );
  } finally {
    await client.end();
  }

  console.log("");
  if (failures > 0) {
    console.error(`${RED}${failures} check(s) failed.${RESET}`);
    process.exitCode = 1;
  } else {
    console.log(`${GREEN}All hrms_auth scope checks passed.${RESET}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
