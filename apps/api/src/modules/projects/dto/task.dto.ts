import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;

export class CreateTaskDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

// No projectId here — moving a task between projects is out of scope
// (Projects-Module-Plan.md §4 has no "restructuring" feature); a task
// stays in the project it was created in.
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

/**
 * The ONLY DTO reachable from PATCH /tasks/:id/status — structurally
 * cannot carry title/description/assigneeId/dueDate, same
 * belt-and-suspenders reasoning as UpdateOwnEmployeeDto. This is the
 * allow-list the plan calls for: an employee may update a task's status,
 * nothing else, only on a task assigned to them (enforced in
 * TasksService.updateStatus, not here — this DTO just makes the other
 * fields unreachable at the transport layer).
 */
export class UpdateTaskStatusDto {
  @IsIn(TASK_STATUSES)
  status!: (typeof TASK_STATUSES)[number];
}
