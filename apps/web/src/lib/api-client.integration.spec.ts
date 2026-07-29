// Real-backend integration test — no mocked fetch. Requires the API dev
// server actually running (`pnpm --filter @hrms/api dev`) and reachable at
// NEXT_PUBLIC_API_URL. Same "verify against the real running backend, not
// mocked API responses" bar as every backend step's e2e suite.
import { afterEach, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken, UnauthorizedError } from "./api-client";

afterEach(() => {
  setAccessToken(null);
});

describe("api-client — real backend integration", () => {
  it("reaches the real dev API and gets a real, correctly-classified 401 for an unauthenticated request", async () => {
    const error = await apiFetch("/auth/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect((error as UnauthorizedError).status).toBe(401);
    expect((error as UnauthorizedError).message).toBe("Missing access token");
  });

  it("rejects a bogus login with a real 401 from AuthService, not a network/CORS failure", async () => {
    const error = await apiFetch("/auth/login", {
      method: "POST",
      body: { email: "does-not-exist@e2e.test", password: "wrong-password" },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
  });

  it("a malformed login body is rejected with a real 400 from class-validator, distinct from 401", async () => {
    const error = await apiFetch("/auth/login", {
      method: "POST",
      body: { email: "not-an-email" },
    }).catch((e: unknown) => e);
    expect(error).toHaveProperty("status", 400);
  });
});
