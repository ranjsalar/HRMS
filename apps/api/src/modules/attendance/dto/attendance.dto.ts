import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

// lat/lng are optional at the DTO level (a client without location
// permission can still clock in/out — see AttendanceService, which flags
// rather than blocks). Full plausibility checking (bounds, "null island")
// happens in the service via isPlausibleCoordinate, the same function the
// geofence module's tests exercise directly.
export class ClockInDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;
}

export class ClockOutDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;
}

export class AdminOverrideAttendanceDto {
  @IsUUID()
  employeeId!: string;

  // Present -> corrects an existing record; absent -> creates a new one.
  @IsOptional()
  @IsUUID()
  attendanceRecordId?: string;

  @IsDateString()
  clockIn!: string;

  @IsOptional()
  @IsDateString()
  clockOut?: string;

  @IsString()
  @MinLength(1)
  note!: string;
}

export class TimesheetRangeDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class TeamTimesheetQueryDto extends TimesheetRangeDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
