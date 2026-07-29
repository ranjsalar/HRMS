import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

const CURRENCIES = ["IQD", "USD"] as const;

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
