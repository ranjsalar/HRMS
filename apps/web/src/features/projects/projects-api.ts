import { apiFetch } from "@/lib/api-client";

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";

export interface ProjectDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberDto {
  id: string;
  employeeId: string;
  employee: { id: string; fullName: string; departmentId: string | null };
}

export interface ProjectDetailDto extends ProjectDto {
  members: ProjectMemberDto[];
}

/**
 * Deliberately no query params or client-side filtering — same reasoning
 * as team-api.ts's fetchTeam: GET /projects already resolves the
 * caller's scope server-side (all/own_department/self), so rendering
 * exactly what comes back is the point.
 */
export function fetchProjects(): Promise<ProjectDto[]> {
  return apiFetch<ProjectDto[]>("/projects");
}

export function fetchProject(id: string): Promise<ProjectDetailDto> {
  return apiFetch<ProjectDetailDto>(`/projects/${id}`);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
}

export function createProject(input: CreateProjectInput): Promise<ProjectDto> {
  return apiFetch<ProjectDto>("/projects", { method: "POST", body: input });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  dueDate?: string;
}

export function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
  return apiFetch<ProjectDto>(`/projects/${id}`, { method: "PATCH", body: input });
}

/** Soft archive — status -> cancelled, never a hard delete. Matches DELETE /projects/:id's real backend behavior. */
export function archiveProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}`, { method: "DELETE" });
}

export function addProjectMember(projectId: string, employeeId: string): Promise<ProjectMemberDto> {
  return apiFetch<ProjectMemberDto>(`/projects/${projectId}/members`, {
    method: "POST",
    body: { employeeId },
  });
}

export function removeProjectMember(projectId: string, employeeId: string): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/members/${employeeId}`, { method: "DELETE" });
}
