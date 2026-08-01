import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

const CUSTOMER_TYPES = ["organization", "individual"] as const;

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: (typeof CUSTOMER_TYPES)[number];

  // The Employee who owns this account. Omitted defaults to the caller's
  // own Employee record (you own what you create) — see
  // CustomersService.create(). An explicit value is validated against the
  // caller's scope, so a self-scoped rep cannot assign a customer to
  // someone else.
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: (typeof CUSTOMER_TYPES)[number];

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
