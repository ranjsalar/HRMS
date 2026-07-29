import { UnauthorizedException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { TenantScopeInterceptor } from "./tenant-scope.interceptor";
import type { PrismaService } from "../../database/prisma/prisma.service";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";

function buildContext(user?: { companyId?: string | null }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function buildCallHandler(result: unknown = { ok: true }): CallHandler {
  return { handle: () => of(result) };
}

describe("TenantScopeInterceptor", () => {
  it("passes requests through untouched when there is no companyId (superadmin path)", async () => {
    const transactionMock = jest.fn();
    const prisma = { $transaction: transactionMock } as unknown as PrismaService;
    const tenantContext = new TenantContextStorage();
    const interceptor = new TenantScopeInterceptor(prisma, tenantContext);

    const handler = buildCallHandler({ ok: true });
    const result = await lastValue(interceptor.intercept(buildContext(undefined), handler));

    expect(result).toEqual({ ok: true });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed companyId before opening a transaction", () => {
    const transactionMock = jest.fn();
    const prisma = { $transaction: transactionMock } as unknown as PrismaService;
    const tenantContext = new TenantContextStorage();
    const interceptor = new TenantScopeInterceptor(prisma, tenantContext);

    expect(() =>
      interceptor.intercept(buildContext({ companyId: "not-a-uuid" }), buildCallHandler()),
    ).toThrow(UnauthorizedException);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("sets app.current_company_id via SET LOCAL and exposes the tx through TenantContextStorage", async () => {
    const companyId = "11111111-1111-1111-1111-111111111111";
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const tenantContext = new TenantContextStorage();

    let observedStore: { tx: unknown; companyId: string } | undefined;

    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        const tx = { $executeRawUnsafe: executeRawUnsafe };
        return callback(tx);
      }),
    } as unknown as PrismaService;

    const interceptor = new TenantScopeInterceptor(prisma, tenantContext);

    const handler: CallHandler = {
      handle: () => {
        observedStore = tenantContext.getStore();
        return of({ ok: true });
      },
    };

    const result = await lastValue(interceptor.intercept(buildContext({ companyId }), handler));

    expect(result).toEqual({ ok: true });
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      `SET LOCAL app.current_company_id = '${companyId}'`,
    );
    expect(observedStore?.companyId).toBe(companyId);
  });
});

function lastValue<T>(observable: import("rxjs").Observable<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    observable.subscribe({
      next: (v) => (value = v),
      error: reject,
      complete: () => resolve(value),
    });
  });
}
