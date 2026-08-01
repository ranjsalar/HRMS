import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, Max } from "class-validator";

export class LogTaskTimeEntryDto {
  @IsDateString()
  date!: string;

  // A single day's logged hours — 24 is a generous, deliberately loose
  // upper bound (catches a fat-fingered "240" typo, nothing more; this
  // module has no timesheet-approval workflow to enforce a "real"
  // workday limit against, per Projects-Module-Plan.md §4).
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(24)
  hours!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
