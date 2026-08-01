import { apiFetch } from "@/lib/api-client";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export interface TaskDto {
  id: string;
  companyId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * No `projectId` query param — `GET /tasks` has none (it returns every
 * task within the caller's scope, same as `/projects`). Callers that need
 * "tasks for this one project" (ProjectDetail's task list) filter
 * client-side by `task.projectId`, same reasoning as everywhere else in
 * this app: render exactly what the server's scope resolution returned,
 * narrowed by a real field on the data, not a second server round-trip
 * this API doesn't offer.
 */
export function fetchTasks(): Promise<TaskDto[]> {
  return apiFetch<TaskDto[]>("/tasks");
}

/** The employee allow-list route — status only, and (at self scope) only on a task assigned to the caller. See TasksService.updateStatus. */
export function updateTaskStatus(id: string, status: TaskStatus): Promise<TaskDto> {
  return apiFetch<TaskDto>(`/tasks/${id}/status`, { method: "PATCH", body: { status } });
}
