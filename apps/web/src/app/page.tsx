"use client";

import { AppNav } from "@/components/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { ClockWidget } from "@/features/attendance/ClockWidget";
import { HolidaysWidget } from "@/features/holidays/HolidaysWidget";
import { LeaveBalanceWidget } from "@/features/leave/LeaveBalanceWidget";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

// The employee/manager dashboard landing (sub-step 9.2): today's
// attendance status, leave balance summary, and upcoming holidays. Also
// the thing every protected route redirects TO.
export default function Home() {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { t, dir } = useTranslation();

  if (!ready) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  return (
    <main dir={dir} className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <AppNav />

      {user?.email ? (
        <p className="font-body text-sm text-neutral-900">
          {t("dashboard.greeting", { name: user.email })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ClockWidget />
        <LeaveBalanceWidget />
        <HolidaysWidget />
      </div>
    </main>
  );
}
