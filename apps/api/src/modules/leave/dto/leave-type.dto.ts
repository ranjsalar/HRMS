import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength } from "class-validator";

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  daysPerYear!: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  daysPerYear?: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}
