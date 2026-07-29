import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule, seconds } from "@nestjs/throttler";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { LockoutService } from "./lockout.service";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

@Module({
  // JwtModule is registered without a global secret — TokenService passes
  // the right secret per call (JWT_ACCESS_SECRET, TWO_FACTOR_PENDING_SECRET,
  // or PASSWORD_RESET_SECRET), since these are deliberately different
  // secrets for different token purposes. See DECISIONS.md.
  //
  // ThrottlerModule is registered HERE, not globally in AppModule — this
  // step deliberately throttles only the three specific auth endpoints
  // named in DECISIONS.md (login, password-reset/request, 2fa/verify),
  // applied per-route via @UseGuards(ThrottlerGuard)/@Throttle() in
  // AuthController, not as an app-wide APP_GUARD. A general/global API
  // rate limit is explicitly out of scope here — the architecture spec
  // puts that at the reverse-proxy layer (Nginx/Caddy), which is part of
  // the upcoming infrastructure pass, not this one.
  //
  // Two named throttlers, limits read from env (AUTH_LOGIN_RATE_LIMIT /
  // AUTH_STRICT_RATE_LIMIT — default 10 and 5, matching the production-
  // appropriate values documented in DECISIONS.md). Routes reference a
  // name with an EMPTY override (`@Throttle({ authLogin: {} })`), which
  // per @nestjs/throttler's guard falls back to this module-level config
  // rather than duplicating numbers in the controller. Configurable, not
  // hardcoded, because the real dev API server is a single long-running
  // process that this project's own real-backend frontend integration
  // suite (apps/web) logs into many times per run — production's correct
  // 10/60s would trip on our OWN test suite, not just attackers. `.env`
  // (dev) sets these higher; `.env.test`/`.env.example` leave them at the
  // strict defaults, since `rate-limiting.e2e-spec.ts` tests those exact
  // numbers against dedicated, short-lived app instances. See DECISIONS.md.
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: "authLogin",
          ttl: seconds(60),
          limit: config.getOrThrow<number>("AUTH_LOGIN_RATE_LIMIT"),
        },
        {
          name: "authStrict",
          ttl: seconds(60),
          limit: config.getOrThrow<number>("AUTH_STRICT_RATE_LIMIT"),
        },
      ],
    }),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, LockoutService, TokenService, TwoFactorService],
  exports: [TokenService, PasswordService],
})
export class AuthModule {}
