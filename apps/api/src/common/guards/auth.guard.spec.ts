import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import type { TokenService } from "../../modules/auth/token.service";

function buildContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request = { headers, user: undefined as unknown };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("AuthGuard", () => {
  it("allows @Public() routes without a token", () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const verifyAccessToken = jest.fn();
    const tokenService = { verifyAccessToken } as unknown as TokenService;
    const guard = new AuthGuard(tokenService, reflector);

    const { context } = buildContext({});
    expect(guard.canActivate(context)).toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header", () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const tokenService = { verifyAccessToken: jest.fn() } as unknown as TokenService;
    const guard = new AuthGuard(tokenService, reflector);

    const { context } = buildContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects an invalid/expired token", () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const verifyAccessToken = jest.fn(() => {
      throw new Error("expired");
    });
    const tokenService = { verifyAccessToken } as unknown as TokenService;
    const guard = new AuthGuard(tokenService, reflector);

    const { context } = buildContext({ authorization: "Bearer bad-token" });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("attaches the verified payload to request.user on success", () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const payload = { sub: "user-1", companyId: "company-1", role: "employee" };
    const verifyAccessToken = jest.fn(() => payload);
    const tokenService = { verifyAccessToken } as unknown as TokenService;
    const guard = new AuthGuard(tokenService, reflector);

    const { context, request } = buildContext({ authorization: "Bearer good-token" });
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(payload);
    expect(verifyAccessToken).toHaveBeenCalledWith("good-token");
  });
});
