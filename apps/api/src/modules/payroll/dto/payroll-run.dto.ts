import { IsBoolean, IsDateString, IsOptional } from "class-validator";

export class CreatePayrollRunDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;
}

export class FinalizePayrollRunDto {
  // Only honored when the caller's resolved scope is "all" (company_admin)
  // — see PayrollRunsService.finalize. Required to finalize against a
  // PayrollRegionRule that isn't yet marked `verified`; the acknowledgment
  // itself is audit-logged.
  @IsOptional()
  @IsBoolean()
  acknowledgeUnverifiedRates?: boolean;
}
