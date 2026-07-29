import { ArgumentsHost, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { JsonWebTokenError } from "jsonwebtoken";
import { GlobalExceptionFilter } from "./global-exception.filter";

interface ResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

function buildHost(): {
  host: ArgumentsHost;
  json: jest.Mock<void, [ResponseBody]>;
  status: jest.Mock;
} {
  const json = jest.fn<void, [ResponseBody]>();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = { method: "GET", originalUrl: "/api/whatever" };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe("GlobalExceptionFilter", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("passes through a NestJS HttpException with its own status and message", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = buildHost();

    filter.catch(new UnauthorizedException("Invalid email or password"), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: "Invalid email or password" }),
    );
  });

  it("preserves class-validator's array message from BadRequestException", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = buildHost();

    filter.catch(new BadRequestException(["email must be an email"]), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: ["email must be an email"] }),
    );
  });

  it("maps a raw JsonWebTokenError to a generic 401, not a 500", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = buildHost();

    filter.catch(new JsonWebTokenError("jwt must be provided"), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: "Invalid or expired token" }),
    );
  });

  it("maps a Prisma unique-constraint error (P2002) to 409 without leaking the raw message", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = buildHost();

    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0][0];
    expect(body.message).not.toContain("Unique constraint failed");
  });

  it("maps an unknown error to a generic 500 without leaking exception.message", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = buildHost();

    filter.catch(new Error("connection string contains password=hunter2"), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("includes a timestamp and path on every response", () => {
    const filter = new GlobalExceptionFilter();
    const { host, json } = buildHost();

    filter.catch(new UnauthorizedException(), host);

    const body = json.mock.calls[0][0];
    expect(typeof body.timestamp).toBe("string");
    expect(body.path).toBe("/api/whatever");
  });
});
