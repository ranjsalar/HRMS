import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServerError,
  setAccessToken,
  setAuthFailureHandler,
  UnauthorizedError,
  ValidationError,
} from "./api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setAuthFailureHandler(null);
});

describe("apiFetch — error classification (each status is a distinct, catchable class)", () => {
  it.each([
    [400, ValidationError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [409, ConflictError],
    [500, ServerError],
  ] as const)("classifies a %i response as %s", async (status, ErrorClass) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { message: "boom" })));
    await expect(apiFetch("/whatever")).rejects.toBeInstanceOf(ErrorClass);
  });

  it("a 401 with no token attached (never logged in) throws UnauthorizedError without attempting a refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "no session" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch("/whatever")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt — nothing to refresh
  });

  it("joins a class-validator array message into one readable string", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(400, { message: ["email must be an email", "password too short"] }),
        ),
    );
    const error = await apiFetch("/whatever").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(
      "email must be an email, password too short",
    );
  });
});

describe("apiFetch — 401 refresh-and-retry", () => {
  beforeEach(() => {
    setAccessToken("initial-token");
  });

  it("on a 401 with a token attached, refreshes once and retries the original request, returning the retried result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" })) // original request
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "new-token" })) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retried original request
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/protected");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/auth/refresh");
  });

  it("if refresh itself fails, calls the auth-failure handler exactly once and surfaces the ORIGINAL 401", async () => {
    const onAuthFailure = vi.fn();
    setAuthFailureHandler(onAuthFailure);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" })) // original
      .mockResolvedValueOnce(new Response(null, { status: 401 })); // /auth/refresh fails
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/protected")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + failed refresh attempt, no retry
  });

  it("concurrent 401s from two in-flight requests dedupe into a single /auth/refresh call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" })) // request A original
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" })) // request B original
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "new-token" })) // the ONE refresh call
      .mockResolvedValueOnce(jsonResponse(200, { which: "a" })) // A retried
      .mockResolvedValueOnce(jsonResponse(200, { which: "b" })); // B retried
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([apiFetch("/a"), apiFetch("/b")]);
    expect(a).toEqual({ which: "a" });
    expect(b).toEqual({ which: "b" });

    const refreshCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("apiFetch — request construction", () => {
  it("attaches the Authorization header when a token is set", async () => {
    setAccessToken("my-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/whatever");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer my-token");
  });

  it("JSON-stringifies a plain object body and sets Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/whatever", { method: "POST", body: { a: 1 } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
  });

  it("passes a FormData body through untouched (no Content-Type override — the browser sets the multipart boundary)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "x.txt");

    await apiFetch("/upload", { method: "POST", body: formData });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(formData);
    expect((init.headers as Headers).has("Content-Type")).toBe(false);
  });
});
