import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { LOCALES, type Locale } from "../../../i18n/locale.type";

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;

  // The locale the visitor is currently viewing the forgot-password PAGE
  // in (from the frontend's `hrms_locale` cookie, via useTranslation()) —
  // not a persisted per-user preference. This is an unauthenticated
  // endpoint with no session/user context yet, so request-time is the
  // only point this can be known. Optional + validated against the
  // closed enum rather than trusted free text; defaults to "en" in the
  // service if absent or invalid. See DECISIONS.md.
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class PasswordResetConfirmDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
