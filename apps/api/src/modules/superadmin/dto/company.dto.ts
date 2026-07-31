import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { LOCALES, type Locale } from "../../../i18n/locale.type";

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  city!: string;

  // Optional — falls back to the Company model's own schema defaults
  // (Asia/Baghdad / "en") when omitted, same defaults the pre-existing
  // create-company CLI has always relied on implicitly.
  @IsOptional()
  @IsString()
  @MinLength(1)
  timezone?: string;

  @IsOptional()
  @IsIn(LOCALES)
  localeDefault?: Locale;

  // Used only to personalize the welcome email greeting — there is no
  // User.fullName column (names live on Employee, a separate model this
  // admin account has no Employee row for). Not persisted anywhere. See
  // DECISIONS.md.
  @IsString()
  @MinLength(1)
  adminName!: string;

  @IsEmail()
  adminEmail!: string;
}

// Deliberately excludes "archived" — the suspend/reactivate dashboard
// surface only ever toggles active<->suspended (see DECISIONS.md,
// "archived is out of scope for the suspend/reactivate endpoint").
export class UpdateCompanyStatusDto {
  @IsIn(["active", "suspended"])
  status!: "active" | "suspended";
}

export class CompanyIdParamsDto {
  @IsString()
  id!: string;
}
