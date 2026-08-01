import { apiFetch } from "@/lib/api-client";

export interface TaskTimeEntryDto {
  id: string;
  taskId: string;
  employeeId: string;
  date: string;
  // Prisma Decimal's own toJSON() — a plain string like "3.5", never
  // padded ("3.50"). See DECISIONS.md, step 5.
  hours: string;
  note: string | null;
  createdAt: string;
}

/**
 * Scoped by the backend per role — self sees only their own entries,
 * manager/admin see entries scoped by the LOGGING employee's department
 * (own_department) or everyone (all). This is a deliberately different
 * own_department rule than Project/Task's own project-membership-based
 * one — see DECISIONS.md, step 5 and step 6.5.
 */
export function fetchTimeEntries(taskId: string): Promise<TaskTimeEntryDto[]> {
  return apiFetch<TaskTimeEntryDto[]>(`/tasks/${taskId}/time-entries`);
}

export interface LogTimeEntryInput {
  date: string;
  hours: number;
  note?: string;
}

/** Always self-authored — logs against the caller's own Employee record, and only succeeds if the caller is the task's real assignee. See TaskTimeEntriesService.log(). */
export function logTimeEntry(taskId: string, input: LogTimeEntryInput): Promise<TaskTimeEntryDto> {
  return apiFetch<TaskTimeEntryDto>(`/tasks/${taskId}/time-entries`, { method: "POST", body: input });
}
