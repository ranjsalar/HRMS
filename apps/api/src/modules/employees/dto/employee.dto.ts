import { Type } from "class-transformer";
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";
import { LOCALES, type Locale } from "../../../i18n/locale.type";

const CURRENCIES = ["IQD", "USD"] as const;
const LOGIN_ROLES = ["employee", "manager"] as const;

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsString()
  @MinLength(1)
  nationalId!: string; // plaintext in transit over TLS; encrypted before it ever reaches Prisma — see EmployeesService

  @IsString()
  @MinLength(1)
  jobTitle!: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsDateString()
  hireDate!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  salaryBase!: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @IsOptional()
  @IsString()
  bankAccount?: string; // also encrypted before storage — see EmployeesService

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  // Everything below is OPTIONAL and, together, provisions a real login —
  // this is the actual fix for the gap flagged in the verification pass:
  // previously nothing outside a CLI/superadmin-only path ever created a
  // User row, so a company_admin could add Employee records but never
  // give anyone (including a manager) an actual account. Omitting `email`
  // preserves the old record-only behavior (Employee.userId stays null —
  // a legitimate state per the schema, e.g. a worker who won't use the
  // system); providing it triggers EmployeesService.create() to also
  // create a User, link it, and send a welcome email. See DECISIONS.md.
  @IsOptional()
  @IsEmail()
  email?: string;

  // Only meaningful when `email` is set — EmployeesService validates the
  // combination (see its own comment) rather than class-validator, since
  // cross-field rules like "role requires email" read more clearly as
  // explicit service logic than a class-validator ValidateIf chain.
  // Deliberately excludes "company_admin"/"superadmin" — those can only
  // ever be created via the Super Admin dashboard/CLI (see
  // superadmin.service.ts and create-company.ts), never through this
  // tenant-scoped endpoint.
  @IsOptional()
  @IsIn(LOGIN_ROLES)
  role?: (typeof LOGIN_ROLES)[number];

  // Which language the welcome email (and the new User's initial
  // `locale` value) uses — the creating admin is the one who'd
  // reasonably know a new hire's preferred language, and there is no
  // other point before first login where this could be known. Falls
  // back to the company's own localeDefault if omitted. See
  // DECISIONS.md.
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nationalId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  jobTitle?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  salaryBase?: number;

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;
}

/**
 * The ONLY DTO reachable from PATCH /employees/me — structurally cannot
 * carry salaryBase/nationalId/bankAccount/departmentId/branchId/fullName/
 * jobTitle/hireDate/currency, because those properties don't exist on this
 * class at all. Combined with the global ValidationPipe's `whitelist:
 * true` (which strips any property not declared on the target DTO), a
 * caller cannot smuggle a restricted field through this route even by
 * crafting a raw request — there's nothing for it to bind to. This is
 * belt-and-suspenders with the scope-based allow-list enforced in
 * EmployeesService.update() (which is the guarantee that actually matters
 * for the general PATCH /employees/:id route too) — see DECISIONS.md.
 */
export class UpdateOwnEmployeeDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;
}
