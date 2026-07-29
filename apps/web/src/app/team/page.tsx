"use client";

import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { AttendanceCorrectionForm } from "@/features/team/AttendanceCorrectionForm";
import { TeamList } from "@/features/team/TeamList";
import type { TeamMemberDto } from "@/features/team/team-api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useTranslation } from "@/lib/locale-context";

export default function TeamPage() {
  const { ready } = useRequireAuth();
  const { t, dir } = useTranslation();
  const [correctingId, setCorrectingId] = useState<string | null>(null);

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
      <TeamList
        renderRowAction={(member: TeamMemberDto) =>
          correctingId === member.id ? (
            <AttendanceCorrectionForm
              employeeId={member.id}
              employeeName={member.fullName}
              onClose={() => setCorrectingId(null)}
            />
          ) : (
            <Button variant="secondary" onClick={() => setCorrectingId(member.id)}>
              {t("team.correctAttendance")}
            </Button>
          )
        }
      />
    </main>
  );
}
