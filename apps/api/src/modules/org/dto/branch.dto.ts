import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateBranchDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  city!: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  city?: string;
}
