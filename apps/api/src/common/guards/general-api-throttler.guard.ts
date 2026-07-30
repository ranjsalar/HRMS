import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * The global APP_GUARD instance for the app-wide general rate limit —
 * deliberately NOT the plain `ThrottlerGuard` class. @nestjs/throttler's
 * guard applies EVERY throttler registered in the app's single, shared
 * (internally @Global()) ThrottlerModule to every route a given guard
 * instance covers — for a plain ThrottlerGuard used as a global
 * APP_GUARD, that means every route in the app would ALSO be bound by
 * AuthController's much stricter "authLogin"/"authStrict" limits (5-10
 * per 60s), not just the three routes those are meant for. Found live
 * while wiring this up, not guessed: without this filter, applying it
 * app-wide would have throttled the entire API to 5-10 req/min.
 *
 * Filtering `this.throttlers` down to only "generalApi" after the base
 * class populates it (from the SAME shared registration AuthController
 * also reads) means this guard instance only ever enforces the general
 * limit — AuthController's own `@UseGuards(ThrottlerGuard)` (the plain
 * class, unfiltered) continues to enforce "authLogin"/"authStrict" on
 * its three routes exactly as before, with "generalApi" stacking there
 * too but never binding (it's the loosest of the three). See
 * DECISIONS.md ("Infrastructure pass, item 4").
 */
@Injectable()
export class GeneralApiThrottlerGuard extends ThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((throttler) => throttler.name === "generalApi");
  }
}
