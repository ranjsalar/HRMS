"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { AddEmployeeForm } from "@/features/team/AddEmployeeForm";
import { AttendanceCorrectionForm } from "@/features/team/AttendanceCorrectionForm";
import { TeamList } from "@/features/team/TeamList";
import type { CreateEmployeeResult, TeamMemberDto } from "@/features/team/team-api";
import { fetchDepartments, type DepartmentDto } from "@/features/org/org-api";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

export default function TeamPage() {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { t, dir } = useTranslation();
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [justCreated, setJustCreated] = useState<CreateEmployeeResult | null>(null);
  const [teamKey, setTeamKey] = useState(0); // bumped to force TeamList to re-fetch after a create
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);

  useEffect(() => {
    if (!ready) return;
    void fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, [ready]);

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

      {justCreated ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-4">
          <p className="font-heading text-base font-semibold text-neutral-900">
            {t("team.addEmployee.success", { name: justCreated.fullName })}
          </p>
          {justCreated.temporaryPassword ? (
            <>
              <p className="font-body text-sm text-neutral-900">
                {t("team.addEmployee.temporaryPasswordLabel")}:{" "}
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm">
                  {justCreated.temporaryPassword}
                </code>
              </p>
              <p className="font-body text-xs text-neutral-600">{t("team.addEmployee.passwordNotice")}</p>
            </>
          ) : (
            <p className="font-body text-xs text-neutral-600">{t("team.addEmployee.recordOnlyNotice")}</p>
          )}
          <Button variant="secondary" onClick={() => setJustCreated(null)} className="self-start">
            {t("team.addEmployee.done")}
          </Button>
        </div>
      ) : null}

      {addingEmployee ? (
        <AddEmployeeForm
          isAdmin={user?.role === "company_admin"}
          onCreated={(result) => {
            setJustCreated(result);
            setAddingEmployee(false);
            setTeamKey((k) => k + 1);
          }}
          onCancel={() => setAddingEmployee(false)}
        />
      ) : (
        <Button onClick={() => setAddingEmployee(true)} className="self-start">
          {t("team.addEmployee.addButton")}
        </Button>
      )}

      <TeamList
        key={teamKey}
        departments={departments}
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
