"use client";

import { AppNav } from "@/components/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { PayslipsList } from "@/features/payroll/PayslipsList";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useTranslation } from "@/lib/locale-context";

export default function PayslipsPage() {
  const { ready } = useRequireAuth();
  const { dir } = useTranslation();

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
      <PayslipsList />
    </main>
  );
}
