import { IsString, Length, Matches } from "class-validator";

const CODE_PATTERN = /^\d{6}$/;

export class TwoFactorVerifyDto {
  @IsString()
  pendingToken!: string;

  @IsString()
  @Length(6, 6)
  @Matches(CODE_PATTERN, { message: "code must be a 6-digit TOTP code" })
  code!: string;
}

export class TwoFactorEnrollDto {
  @IsString()
  pendingToken!: string;
}

export class TwoFactorEnableDto {
  @IsString()
  pendingToken!: string;

  @IsString()
  @Length(6, 6)
  @Matches(CODE_PATTERN, { message: "code must be a 6-digit TOTP code" })
  code!: string;
}
