"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchUpcomingHolidays, type HolidayDto } from "./holidays-api";

export function HolidaysWidget() {
  const { t, locale, dir } = useTranslation();
  const [holidays, setHolidays] = useState<HolidayDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setHolidays(await fetchUpcomingHolidays());
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
        {t("dashboard.holidays.title")}
      </h2>
      {holidays && holidays.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {holidays.map((holiday) => (
            <li
              key={holiday.id}
              className="flex items-center justify-between font-body text-sm text-neutral-900"
            >
              <span>{holiday.name}</span>
              <span className="text-neutral-600">{formatDate(new Date(holiday.date), locale)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("dashboard.holidays.empty")}</p>
      )}
    </div>
  );
}
