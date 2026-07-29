import { IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateDepartmentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string;
}
