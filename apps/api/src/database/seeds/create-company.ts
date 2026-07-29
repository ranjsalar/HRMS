import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PasswordService } from "../../modules/auth/password.service";
import { buildRolePermissionRows } from "./default-role-permissions";

/**
 * Company + first company_admin provisioning CLI — the only way a new
 * tenant gets created (no public signup UI, per the founder's decision).
 * Connects via DATABASE_SUPERADMIN_URL: creating a Company row is
 * structurally only possible through the BYPASSRLS connection, since the
 * RLS-enforced hrms_app role can never SET LOCAL to a company_id that
 * doesn't exist yet (see the enable_rls_and_roles migration comment).
 *
 * Usage:
 *   pnpm --filter @hrms/api cli:create-company -- \
 *     --name "Acme LLC" --city Erbil --adminEmail admin@acme.com
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const name = requireArg(args, "name");
  const city = requireArg(args, "city");
  const adminEmail = requireArg(args, "adminEmail");

  const prisma = new PrismaClient({
    datasources: { db: { url: requireEnv("DATABASE_SUPERADMIN_URL") } },
  });
  const passwordService = new PasswordService();

  try {
    const existing = await prisma.company.findFirst({ where: { name } });
    if (existing) {
      throw new Error(`A company named "${name}" already exists (id: ${existing.id}).`);
    }

    const company = await prisma.company.create({ data: { name, city } });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await passwordService.hash(temporaryPassword);

    const admin = await prisma.user.create({
      data: {
        companyId: company.id,
        email: adminEmail,
        passwordHash,
        role: "company_admin",
        mustChangePassword: true,
        twoFaEnabled: false, // mandatory for this role, enrolled on first login
      },
    });

    await prisma.rolePermission.createMany({
      data: buildRolePermissionRows(company.id),
      skipDuplicates: true,
    });

    console.log("");
    console.log("Company created:");
    console.log(`  ${company.name} (${company.city}) — id ${company.id}`);
    console.log("");
    console.log("Company Admin account:");
    console.log(`  email:    ${admin.email}`);
    console.log(`  password: ${temporaryPassword}`);
    console.log("");
    console.log(
      "This password is shown once and is not recoverable — relay it to the company " +
        "over a secure channel now. It must be changed on first login (mustChangePassword " +
        "is set), and 2FA enrollment is mandatory for this role before the account can be " +
        "used beyond that.",
    );
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

interface ParsedArgs {
  [key: string]: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    // A bare "--" can show up here depending on how pnpm/npm forward args
    // past their own "--" separator — skip it rather than trying to parse
    // it as a flag.
    if (token === "--") continue;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  return args;
}

function requireArg(args: ParsedArgs, name: string): string {
  const value = args[name];
  if (!value) {
    throw new Error(`Missing required argument: --${name}`);
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function generateTemporaryPassword(): string {
  // 18 random bytes -> 24 base64url chars; strip padding, keep it a single
  // copy-pasteable token with no ambiguous separators.
  return randomBytes(18).toString("base64url");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
