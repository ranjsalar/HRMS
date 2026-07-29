import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Extracts the client IP for AuditLog.ipAddress. */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
});
