"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNumber } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchActiveLeaveTypes, fetchMyLeaveBalances, type LeaveBalanceDto } from "./leave-api";

interface Row {
  leaveTypeId: string;
  name: string;
  daysRemaining: number;
}

export function LeaveBalanceWidget() {
  const { t, locale, dir } = useTranslation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [balances, leaveTypes] = await Promise.all([
        fetchMyLeaveBalances(),
        fetchActiveLeaveTypes(),
      ]);
      const nameById = new Map(leaveTypes.map((lt) => [lt.id, lt.name]));
      setRows(joinRows(balances, nameById));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("dashboard.leaveBalance.title")}
      </h2>
      {rows && rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.leaveTypeId}
              className="flex items-center justify-between font-body text-sm text-neutral-900"
            >
              <span>{row.name}</span>
              <span>
                {t("dashboard.leaveBalance.daysRemaining", {
                  count: formatNumber(row.daysRemaining, locale, { maximumFractionDigits: 2 }),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("dashboard.leaveBalance.empty")}</p>
      )}
    </div>
  );
}

/**
 * Balances whose leaveTypeId has no match in the active leave-types list
 * (a deactivated type with old balance history) are dropped rather than
 * shown with a blank name — same "active types only" boundary
 * LeaveTypesController.listActive() already draws for the submission form.
 */
function joinRows(balances: LeaveBalanceDto[], nameById: Map<string, string>): Row[] {
  return balances
    .filter((b) => nameById.has(b.leaveTypeId))
    .map((b) => ({
      leaveTypeId: b.leaveTypeId,
      name: nameById.get(b.leaveTypeId)!,
      daysRemaining: Number(b.balance),
    }));
}
