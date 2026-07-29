import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const PAYROLL_REGIONS = ["krg", "federal_iraq"] as const;

export class TaxBracketDto {
  // Omitted only on the last (unbounded, top) bracket — enforced in
  // PayrollRulesService, not expressible as a single class-validator rule.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  upToAmount?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent!: number;
}

export class UpsertPayrollRuleDto {
  @IsIn(PAYROLL_REGIONS)
  region!: (typeof PAYROLL_REGIONS)[number];

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  overtimeMultiplier!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  standardMonthlyHours!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  standardWorkingDaysPerMonth!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  socialSecurityEmployeePct!: number;

  // Ascending by upToAmount, lowest first; only the last entry may omit
  // upToAmount (the unbounded top bracket). Validated in the service —
  // see PayrollRulesService.validateBrackets.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxBracketDto)
  taxBrackets!: TaxBracketDto[];

  // Defaults false — must be explicitly set true by whoever is actually
  // confirming these figures against real regional law, never implied by
  // the mere act of saving a rule. See PayrollRunsService.finalize.
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}
