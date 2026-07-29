const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

/** Turns a backend-relative path (e.g. the `url` a signed-URL endpoint returns, like `/payslips/download?token=...`) into a full, absolute URL on the API's own origin — needed anywhere the frontend navigates to it directly (a new tab / `window.open`) rather than calling it through `apiFetch`. */
export function resolveApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * Base class for every classified HTTP error this client throws. Callers
 * should almost never catch `ApiError` directly — catch the specific
 * subclass (UnauthorizedError/ForbiddenError/NotFoundError/...) so a
 * permission denial, a real server error, and "this doesn't exist" render
 * as three different UI states, never one generic "Something went wrong."
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ValidationError extends ApiError {} // 400 — DTO/class-validator rejection; body.message is often a string[] of field errors
export class UnauthorizedError extends ApiError {} // 401 — no/expired session
export class ForbiddenError extends ApiError {} // 403 — authenticated, but not permitted (RBAC)
export class NotFoundError extends ApiError {} // 404 — including the deliberate "not visible to you" 404s used throughout the API
export class ConflictError extends ApiError {} // 409 — business-rule conflict (overlap, already clocked in, insufficient balance, ...)
export class ServerError extends ApiError {} // 5xx

function classifyError(status: number, message: string, body: unknown): ApiError {
  switch (status) {
    case 400:
      return new ValidationError(message, status, body);
    case 401:
      return new UnauthorizedError(message, status, body);
    case 403:
      return new ForbiddenError(message, status, body);
    case 404:
      return new NotFoundError(message, status, body);
    case 409:
      return new ConflictError(message, status, body);
    default:
      return status >= 500
        ? new ServerError(message, status, body)
        : new ApiError(message, status, body);
  }
}

// The access token lives here, in module memory, never in
// localStorage/sessionStorage — deliberately not durable across a page
// reload (AuthProvider re-establishes it via the httpOnly-cookie-backed
// refresh on mount instead). Keeping it out of any Web Storage API means
// there's nothing for an XSS payload to read off disk; the refresh token
// that actually matters for persistence is already httpOnly and
// unreachable from JS by construction. See DECISIONS.md.
let currentAccessToken: string | null = null;
let onAuthFailure: (() => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

/** AuthProvider registers its "clear session + redirect to login" handler here — kept as an injected callback, not an import, so this module never depends on React/auth-context. */
export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  // Dedupe concurrent refresh attempts: if three requests 401 at once,
  // exactly one /auth/refresh call goes out, and all three await it.
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { accessToken: string };
    currentAccessToken = data.accessToken;
    return data.accessToken;
  } catch {
    return null;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** Plain object/array bodies are JSON-stringified automatically; pass a FormData instance as-is for file uploads. */
  body?: unknown;
  /** Escape hatch to suppress the refresh-and-retry path — used by nothing today, kept for a caller that genuinely needs a raw 401. */
  skipAuthRetry?: boolean;
}

async function performFetch(path: string, options: ApiRequestOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  if (currentAccessToken) {
    headers.set("Authorization", `Bearer ${currentAccessToken}`);
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body,
    credentials: "include", // carries the httpOnly refresh cookie on /auth/refresh and /auth/logout (cookie is path-scoped to /api/auth server-side)
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  const data: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw classifyError(response.status, extractMessage(data, response.statusText), data);
  }

  return data as T;
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  return fallback;
}

/**
 * The one function every feature module calls. On a 401 from a request
 * that WAS carrying a token (a session that looked valid but wasn't —
 * expired mid-session is the common case), attempts exactly one silent
 * refresh and retries the original request once. If refresh fails,
 * `onAuthFailure` fires (AuthProvider clears state and redirects to
 * login) and the original 401 still surfaces to the caller as
 * `UnauthorizedError`. A 401 on a request with no token attached (not
 * logged in at all) never triggers a refresh attempt — there's nothing to
 * refresh.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const hadToken = currentAccessToken !== null;
  const response = await performFetch(path, options);

  if (response.status === 401 && hadToken && path !== "/auth/refresh" && !options.skipAuthRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryResponse = await performFetch(path, options);
      return parseResponse<T>(retryResponse);
    }
    onAuthFailure?.();
  }

  return parseResponse<T>(response);
}
