import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

export class SubmitLeaveRequestDto {
  @IsUUID()
  leaveTypeId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class ApproveLeaveRequestDto {
  // Admin-only escape hatch to approve past a balance that would otherwise
  // go negative — ignored (never honored) unless the caller's resolved
  // scope is "all". See DECISIONS.md.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class RejectLeaveRequestDto {
  // Optional — rejecting with no stated reason is still a valid action.
  // Surfaced to the employee in the leave-decision email when present.
  // See DECISIONS.md.
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class TeamLeaveRequestQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsIn(LEAVE_STATUSES)
  status?: (typeof LEAVE_STATUSES)[number];
}

export class PreviewLeaveRequestDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class LeaveBalanceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;
}

export class TeamLeaveBalanceQueryDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;
}
