import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateCustomerContactDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Setting this true demotes whatever contact was previously primary for
  // the same customer, in the same transaction — see
  // CustomersService.setPrimaryExclusively().
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateCustomerContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
