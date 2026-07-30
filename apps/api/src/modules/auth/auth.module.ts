import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
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
  // The "authLogin"/"authStrict" named throttlers AuthController's
  // @Throttle() decorators reference are registered in AppModule, not
  // here — @nestjs/throttler's ThrottlerModule is internally @Global(),
  // and a SECOND separate .forRootAsync() call here (as an earlier
  // version of this file had) silently collides with AppModule's own
  // registration on the same global provider tokens: whichever one
  // "wins" the collision is the only one any ThrottlerGuard anywhere in
  // the app actually sees, and the auth-specific throttlers stopped
  // firing at all — a real regression found by the full e2e suite right
  // after adding a second global rate limit for other routes, not
  // guessed. See DECISIONS.md ("Infrastructure pass, item 4").
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, LockoutService, TokenService, TwoFactorService],
  exports: [TokenService, PasswordService],
})
export class AuthModule {}
