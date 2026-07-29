import { SetMetadata } from "@nestjs/common";

export const SKIP_MUST_CHANGE_PASSWORD_KEY = "skipMustChangePasswordCheck";

/**
 * Marks a route as reachable even while the authenticated user's
 * mustChangePassword flag is set — MustChangePasswordGuard checks for
 * this. Intended for exactly one route: POST /auth/password/change (the
 * escape hatch itself). Everything else an authenticated,
 * pending-password-change user hits is blocked with 403, including
 * /auth/logout and /auth/me — see DECISIONS.md.
 */
export const SkipMustChangePasswordCheck = () => SetMetadata(SKIP_MUST_CHANGE_PASSWORD_KEY, true);
