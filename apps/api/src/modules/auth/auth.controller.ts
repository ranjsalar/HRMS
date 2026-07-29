import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SkipMustChangePasswordCheck } from "../../common/decorators/skip-must-change-password-check.decorator";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { AccessTokenPayload } from "./token.service";
import { AuthService, type FullSession } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { TwoFactorEnableDto, TwoFactorEnrollDto, TwoFactorVerifyDto } from "./dto/two-factor.dto";
import {
  ChangePasswordDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from "./dto/password-reset.dto";

const REFRESH_COOKIE = "refresh_token";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextStorage,
  ) {}

  // IP-based, on top of (not instead of) the existing PER-ACCOUNT lockout
  // (LockoutService, step 3) — the two guard different things and are
  // deliberately not merged into one mechanism. Lockout stops repeated
  // guesses against ONE account regardless of source IP or how slowly
  // they're spread out (exponential backoff up to 24h); this throttle
  // stops HIGH-VOLUME requests from one IP regardless of which account(s)
  // are targeted (credential stuffing across many emails, or a raw
  // brute-force script hammering one account faster than 10/min). Limit
  // (10/60s) is deliberately looser than the lockout's own 5-attempt
  // threshold — a legitimate user fumbling a password twice, or several
  // people on the same office/NAT IP logging in around the same moment,
  // should never be the thing that trips this. ThrottlerGuard runs before
  // the controller body executes, so a throttled request never reaches
  // AuthService.login() at all — under actual attack load this also
  // means never paying for the deliberately-slow Argon2id hash check
  // (see PasswordService) on requests that were going to be rejected
  // anyway. See DECISIONS.md.
  // Empty override `{}` — limit/ttl come from the "authLogin" named
  // throttler registered in AuthModule (env-configurable), not
  // duplicated here. @SkipThrottle({ authStrict: true }) is NOT
  // optional decoration: @nestjs/throttler's guard applies EVERY
  // registered named throttler to EVERY guarded route by default
  // (@Throttle only overrides a given name's limit/ttl, it doesn't
  // select which throttlers run) — without this, login would ALSO be
  // bound by authStrict's tighter limit and trip early. Caught live via
  // a failing e2e test, not by inspection. See DECISIONS.md.
  @Throttle({ authLogin: {} })
  @SkipThrottle({ authStrict: true })
  @UseGuards(ThrottlerGuard)
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    if (result.status === "ok") {
      this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
      return {
        status: result.status,
        accessToken: result.accessToken,
        mustChangePassword: result.mustChangePassword,
      };
    }
    return { status: result.status, pendingToken: result.pendingToken };
  }

  // Stricter than login (5/60s, not 10) and — unlike login — the ONLY
  // brute-force defense this endpoint has at all: nothing tracks repeated
  // wrong 2FA codes the way LockoutService tracks wrong passwords. A
  // pendingToken is valid for TWO_FACTOR_PENDING_TTL (5m by default);
  // unthrottled, that window is enough for thousands of guesses against a
  // 6-digit TOTP code's ~1,000,000-value space. 5/min over that 5-minute
  // window caps a single IP at ~25 guesses total per pendingToken — trivial
  // for the 1-2 attempts a real user needs, hostile to brute force. See
  // DECISIONS.md.
  // See the login handler's comment for why @SkipThrottle({authLogin:true})
  // is required, not optional.
  @Throttle({ authStrict: {} })
  @SkipThrottle({ authLogin: true })
  @UseGuards(ThrottlerGuard)
  @Public()
  @Post("2fa/verify")
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.verifyTwoFactorAndLogin(dto.pendingToken, dto.code);
    return this.respondWithSession(res, session);
  }

  @Public()
  @Post("2fa/enroll")
  @HttpCode(HttpStatus.OK)
  enrollTwoFactor(@Body() dto: TwoFactorEnrollDto) {
    return this.authService.enrollTwoFactor(dto.pendingToken);
  }

  @Public()
  @Post("2fa/enable")
  @HttpCode(HttpStatus.OK)
  async enableTwoFactor(
    @Body() dto: TwoFactorEnableDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.enableTwoFactor(dto.pendingToken, dto.code);
    return this.respondWithSession(res, session);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const session = await this.authService.refresh(raw);
    return this.respondWithSession(res, session);
  }

  // Deliberately NOT @Public(): logout requires a valid access token so
  // MustChangePasswordGuard can apply to it too (a pending-password-change
  // session is blocked from every endpoint except password/change — see
  // DECISIONS.md). Trade-off: a client whose access token has already
  // expired can't hit this endpoint; discarding the token client-side is
  // sufficient in that case anyway, since the access token would fail
  // AuthGuard verification regardless of session state.
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) {
      await this.authService.logout(raw);
    }
    res.clearCookie(REFRESH_COOKIE);
  }

  // Same 5/60s as 2FA verify. This endpoint has no account-level lockout
  // protecting it at all (there's nothing to lock — no password is
  // checked), so IP throttling is the ONLY defense against two real
  // abuses: spamming a real user's inbox with reset emails, and
  // hammering the account-existence-hiding response fast enough to
  // extract a timing signal despite the identical response body.
  // See the login handler's comment for why @SkipThrottle({authLogin:true})
  // is required, not optional.
  @Throttle({ authStrict: {} })
  @SkipThrottle({ authLogin: true })
  @UseGuards(ThrottlerGuard)
  @Public()
  @Post("password-reset/request")
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    await this.authService.requestPasswordReset(dto.email, dto.locale);
    // Identical response regardless of whether the email exists.
    return { message: "If this email exists, a password reset link was sent." };
  }

  @Public()
  @Post("password-reset/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    await this.authService.confirmPasswordReset(dto.token, dto.newPassword);
    return { message: "Password updated." };
  }

  @SkipMustChangePasswordCheck()
  @Post("password/change")
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() user: AccessTokenPayload, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(
      user.sub,
      user.companyId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: "Password updated." };
  }

  /**
   * Protected diagnostic endpoint: proves TenantScopeInterceptor is
   * actually scoping this authenticated request's queries by returning how
   * many employees are visible in the caller's own company. Used by the
   * cross-tenant isolation verification (two real logged-in sessions, two
   * different companies, two different counts) — see
   * database/seeds/verify-hrms-auth-scope.ts and the auth e2e tests.
   */
  @Get("me")
  async me(@CurrentUser() user: AccessTokenPayload) {
    const store = this.tenantContext.getStore();
    const employeeCount = store ? await store.tx.employee.count() : null;
    // email is a cheap, already-tenant-scoped lookup on the same
    // connection — added for the frontend's dashboard greeting (step
    // 9.2), which has no other source of a human-readable identifier
    // (the access token payload deliberately carries only sub/companyId/
    // role, and there's no general "my profile" endpoint yet).
    const userRow = store
      ? await store.tx.user.findUnique({ where: { id: user.sub }, select: { email: true } })
      : null;
    return {
      userId: user.sub,
      companyId: user.companyId,
      role: user.role,
      email: userRow?.email ?? null,
      employeeCountInMyCompany: employeeCount,
    };
  }

  private respondWithSession(res: Response, session: FullSession) {
    this.setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
    return {
      status: "ok" as const,
      accessToken: session.accessToken,
      mustChangePassword: session.mustChangePassword,
    };
  }

  private setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, raw, {
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/api/auth",
    });
  }
}
