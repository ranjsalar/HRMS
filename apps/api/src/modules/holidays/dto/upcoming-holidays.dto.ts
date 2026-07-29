import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class UpcomingHolidaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
