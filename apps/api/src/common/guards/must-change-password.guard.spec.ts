import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { MustChangePasswordGuard } from "./must-change-password.guard";
import type { PrismaAuthService } from "../../database/prisma/prisma-auth.service";

function buildContext(user: { sub: string } | undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function buildReflector(flags: { isPublic?: boolean; skip?: boolean }): Reflector {
  let call = 0;
  const results = [flags.isPublic ?? false, flags.skip ?? false];
  return {
    getAllAndOverride: () => results[call++],
  } as unknown as Reflector;
}

describe("MustChangePasswordGuard", () => {
  it("allows @Public() routes without checking the database", async () => {
    const findUserById = jest.fn();
    const prismaAuth = { findUserById } as unknown as PrismaAuthService;
    const guard = new MustChangePasswordGuard(prismaAuth, buildReflector({ isPublic: true }));

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(true);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("allows @SkipMustChangePasswordCheck() routes without checking the database", async () => {
    const findUserById = jest.fn();
    const prismaAuth = { findUserById } as unknown as PrismaAuthService;
    const guard = new MustChangePasswordGuard(
      prismaAuth,
      buildReflector({ isPublic: false, skip: true }),
    );

    await expect(guard.canActivate(buildContext({ sub: "user-1" }))).resolves.toBe(true);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("blocks a request when the current mustChangePassword is true", async () => {
    const findUserById = jest.fn().mockResolvedValue({ mustChangePassword: true });
    const prismaAuth = { findUserById } as unknown as PrismaAuthService;
    const guard = new MustChangePasswordGuard(prismaAuth, buildReflector({}));

    await expect(guard.canActivate(buildContext({ sub: "user-1" }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("allows a request when the current mustChangePassword is false", async () => {
    const findUserById = jest.fn().mockResolvedValue({ mustChangePassword: false });
    const prismaAuth = { findUserById } as unknown as PrismaAuthService;
    const guard = new MustChangePasswordGuard(prismaAuth, buildReflector({}));

    await expect(guard.canActivate(buildContext({ sub: "user-1" }))).resolves.toBe(true);
  });

  it("checks the CURRENT database value, not a stale claim — proves the token-staleness fix", async () => {
    // Simulates: user's JWT was issued while mustChangePassword was true,
    // but they've since changed it via /auth/password/change. The guard
    // must re-read from the DB, not trust anything baked into the token.
    const findUserById = jest.fn().mockResolvedValue({ mustChangePassword: false });
    const prismaAuth = { findUserById } as unknown as PrismaAuthService;
    const guard = new MustChangePasswordGuard(prismaAuth, buildReflector({}));

    await expect(guard.canActivate(buildContext({ sub: "user-1" }))).resolves.toBe(true);
    expect(findUserById).toHaveBeenCalledWith("user-1");
  });
});
