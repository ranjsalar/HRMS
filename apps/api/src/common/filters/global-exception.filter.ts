import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { JsonWebTokenError, NotBeforeError, TokenExpiredError } from "jsonwebtoken";
import * as Sentry from "@sentry/node";

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

/**
 * Catch-all backstop. Individual services already convert the errors they
 * know how to handle into proper HttpExceptions (e.g. AuthService wrapping
 * JWT verification failures — see DECISIONS.md, step 3's "unhandled
 * JsonWebTokenError -> 500" bug). This filter exists for everything that
 * ISN'T explicitly handled that way: a raw Prisma error bubbling out of
 * some future repository call, a JWT error from a code path that forgets
 * to wrap it, or any other unexpected exception. None of those should ever
 * reach the client as a raw stack trace or internal message — the real
 * error is logged server-side; the client gets a generic, safe message.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionsHandler");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.resolve(exception);
    const serverErrorThreshold: number = HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= serverErrorThreshold) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status}: ${describe(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Same threshold as server-side logging above — genuine 5xx only,
      // never the expected 4xx client errors (validation failures, 401s,
      // etc.) that this filter also passes through. A no-op call when
      // SENTRY_DSN is unset (Sentry.init() was never called — see
      // monitoring/sentry.ts), so this line is safe in every current
      // environment, not just wherever monitoring is actually active.
      Sentry.captureException(exception);
    }

    response.status(status).json({
      ...body,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private resolve(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === "string"
          ? raw
          : ((raw as { message?: string | string[] }).message ?? exception.message);
      const error =
        typeof raw === "object" && raw && "error" in raw
          ? String((raw as { error?: unknown }).error)
          : HttpStatus[status];
      return { status, body: { statusCode: status, error, message } };
    }

    if (
      exception instanceof JsonWebTokenError ||
      exception instanceof TokenExpiredError ||
      exception instanceof NotBeforeError
    ) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        body: {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: "Unauthorized",
          message: "Invalid or expired token",
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    // Unknown error shape — never expose exception.message here, it may
    // contain internal details (file paths, query fragments, etc).
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: "Internal Server Error",
        message: "Internal server error",
      },
    };
  }

  private resolvePrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: ErrorBody;
  } {
    switch (exception.code) {
      case "P2002": // unique constraint violation
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: HttpStatus.CONFLICT,
            error: "Conflict",
            message: "A record with this value already exists.",
          },
        };
      case "P2025": // record required for the operation not found
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            statusCode: HttpStatus.NOT_FOUND,
            error: "Not Found",
            message: "Record not found.",
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            error: "Internal Server Error",
            message: "Internal server error",
          },
        };
    }
  }
}

function describe(exception: unknown): string {
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
  return String(exception);
}
