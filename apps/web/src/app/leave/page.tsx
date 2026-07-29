"use client";

import { useCallback, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { LeaveRequestHistory } from "@/features/leave/LeaveRequestHistory";
import { LeaveSubmitForm } from "@/features/leave/LeaveSubmitForm";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useTranslation } from "@/lib/locale-context";

export default function LeavePage() {
  const { ready } = useRequireAuth();
  const { dir } = useTranslation();
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const handleSubmitted = useCallback(() => {
    setHistoryRefreshToken((n) => n + 1);
  }, []);

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LeaveSubmitForm onSubmitted={handleSubmitted} />
        <LeaveRequestHistory refreshToken={historyRefreshToken} />
      </div>
    </main>
  );
}
