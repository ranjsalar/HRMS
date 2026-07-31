# Projects / Task Management — Module Plan
*ERP module #2, per `ERP-Master-Plan.md`. Plays the same role for this module that `HRMS-Project-Plan.md` played for HR — read and confirmed before any code.*

---

## 1. Core entities and how they attach to the existing foundation

**No new tenancy or identity concept.** Every entity below carries `companyId` and gets the exact same Row-Level Security treatment as every existing table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + a `tenant_isolation` policy comparing `companyId` to `current_setting('app.current_company_id', true)`, applied via the same migration pattern as the original `enable_rls_and_roles` migration). No parallel "workspace" or "org" concept — a project belongs to a `Company`, exactly like an `Employee` or a `LeaveRequest` does.

**Task assignment and project membership both reference `Employee`, directly — never a new "user" or "team member" concept.** Every existing cross-module reference in this schema points at `Employee.id` (`LeaveRequest.employeeId`, `AttendanceRecord.employeeId`, `Payslip.employeeId`), and this module follows the identical pattern: `Task.assigneeId` and `ProjectMember.employeeId` are both foreign keys to `Employee`. A person with no `Employee` row (a record-only employee never given a login, or — structurally — Super Admin, who has none at all) simply cannot be assigned anything or added to a project, the same limitation that already exists everywhere else in this app.

**Four new models:**

| Model | Represents |
|---|---|
| `Project` | A body of work with a name, status, and optional dates. Not tied to a single Department — projects are commonly cross-departmental, so scoping is driven entirely by membership (see §3), not a department FK. |
| `ProjectMember` | Explicit membership: which Employees are on a Project. A join table, not implicit from task assignment — someone can be a project member (sees the whole project) without being assigned any specific task yet. |
| `Task` | A unit of work inside exactly one Project. Has a status, an optional single assignee, an optional due date. |
| `TaskTimeEntry` | A manually-logged amount of time an Employee spent on a Task on a given date (see §2 for why this is a log, not a live timer). |

---

## 2. Core workflow

**Project creation → add members → create tasks → assign → work → status updates → (optional) time logging.**

- **Status sets** (both are real Prisma enums, matching every other status field in this schema — `EmployeeStatus`, `LeaveStatus`, `PayrollRunStatus` — for the same DB-level validation guarantee; the trade-off, stated plainly, is that adding a new status value later needs a migration, unlike a plain string. Flagging that trade-off now rather than silently picking one.):
  - `Project.status`: `planning`, `active`, `on_hold`, `completed`, `cancelled`
  - `Task.status`: `todo`, `in_progress`, `blocked`, `done` — your own suggested default set, adopted as-is
- **Transitions are deliberately unrestricted for v1** — any status can move to any other status, by anyone with edit rights on that task. No enforced state machine (e.g. "blocked can only be entered from in_progress"). This is a real simplicity decision, not an oversight: inventing workflow rules nobody asked for is exactly the kind of premature constraint this build has avoided elsewhere (see `standardWorkingDaysPerMonth`'s own reasoning in the payroll schema). Revisit only if real usage shows a specific transition needs blocking.
- **Deadlines**: `Project.dueDate` and `Task.dueDate` are both optional plain dates. No automatic overdue detection, no deadline notifications in this pass — notifications are their own build (see the recent leave-decision/payslip-ready work), and task-deadline reminders are a natural *future* extension of that same system, not part of this module's v1.

### Time tracking: a manual log, not a clock-in/clock-out pair — and why

`AttendanceRecord`'s clock-in/clock-out model is tightly coupled to *physical presence verification* — it carries GPS coordinates and geofence checking specifically because its job is confirming an employee is at a real work location right now. Task time has nothing to do with location, and reusing that shape would either drag geofencing into a context it doesn't belong in, or leave `clockInLat`/`clockInLng`-shaped columns permanently unused — a worse fit, not a natural reuse.

**Decision: `TaskTimeEntry` is a simple manual entry — `date` + `hours` (decimal) + optional note — logged after the fact, not a live start/stop timer.** This also matches how time-tracking actually works in comparable tools (Jira, Asana): a person logs "I spent 3 hours on this Tuesday," not a continuously-running clock tied to one task. No reconciliation is attempted against `AttendanceRecord` — an employee's total logged task-hours and their attendance hours are two different, unrelated measurements, and trying to force them to agree would be a real, unrequested feature, not a natural consequence of either existing.

Time entries are logged in v1. Reporting/rollups on them (a "hours by project" dashboard, timesheet export, etc.) is explicitly out of scope — see §4.

---

## 3. RBAC model

Reuses the existing three-tier scope system (`self` / `own_department` / `all`) and the existing `RolePermission` (role × module × action × scope) table — no new permission mechanism. One new RBAC module, **`projects`**, covering both `Project` and `Task` actions. (`leave` and `leave_types` were split into two modules because an employee's own `leave:create` grant could otherwise be misread as company-wide `LeaveType` authoring rights — no equivalent risk exists here: nothing about a `projects:create` grant is reachable from a `self`-scoped action, so one module is sufficient and simpler.)

| Role | `view` | `create` (projects/tasks) | `edit` |
|---|---|---|---|
| `company_admin` | `all` — every project company-wide | `all` (default) | `all` |
| `manager` | `own_department` — see below | not granted by default; opt-in per company | `own_department` |
| `employee` | `self` — projects/tasks they're a member of/assigned to | not granted | `self` — status + own time entries only, on tasks assigned to them |

**What `own_department` means for this module, stated explicitly (this is a real design decision, not an assumption carried over unchanged):** a manager sees any Project that has **at least one `ProjectMember` from a department they manage**, and any Task within it — not "projects the manager personally created," and not "projects whose every member is in their department." This mirrors the same generic scope resolution `EmployeesService.managedDepartmentId` already provides, applied to project membership instead of an employee's home department. A cross-departmental project is visible to every manager with at least one person on it, which is the correct real-world behavior — a manager needs to see what their own report is working on, even if the project also includes people from other teams.

**Project/task creation defaults to admin-only, matching the exact precedent already set for `employees:create`:** company_admin gets it by default (part of the existing `fullAccess()` helper that grants every module to `company_admin`); manager can be granted `projects:create` at `own_department` scope, but only as an explicit **per-company opt-in** via the existing `/rbac/permissions` UI — not a default grant, identical to how manager-created employee accounts already work. Confirms and extends your own assumption, rather than inventing a new pattern.

**Employees never create projects or tasks.** They view what they're a member of/assigned to, and can update a task's `status` and log their own `TaskTimeEntry` rows — the same "self-scoped, narrow allow-list of editable fields" shape already used for `UpdateOwnEmployeeDto`. An employee cannot reassign a task, rename it, change its due date, or add/remove project members.

---

## 4. Explicitly OUT of scope for v1

Matching the discipline of the original HR plan's own out-of-scope section — resist the pull to grow this quietly:

- **Gantt charts / timeline visualization** — a real, separate frontend effort; tasks/projects with dates is not the same as a rendered timeline.
- **Task dependencies** ("Task A blocks Task B") — no relationship modeled between tasks at all in v1.
- **Budgets** — no cost/budget field on Project.
- **Billing / invoicing integration** — no connection to Accounting (which doesn't exist yet anyway) or any billing concept. "Project hours → invoice," mentioned as a someday-possibility in the ERP master plan, stays someday.
- **Time-tracking reports/analytics** — `TaskTimeEntry` rows are logged and listable, nothing more. No aggregate dashboards, no CSV export, no timesheet approval workflow.
- **Sub-tasks / nested tasks** — a Task belongs to exactly one Project; no task-within-a-task.
- **Recurring tasks** — every Task is a one-off row.
- **Task comments / activity feed** — no discussion thread on a task.
- **File attachments on tasks** — the existing Documents module could plausibly attach to a Task someday; not built now.
- **In-project roles** (e.g. "lead" vs "member") — `ProjectMember` is flat membership only, no per-project role distinction.
- **Task-assignment / status-change / deadline-reminder email notifications** — this module ships without any new notification triggers, exactly as HR shipped its core workflows before notifications were added as a separate, later pass. A natural next extension once this module is live, not part of it.
- **Kanban drag-and-drop specifics** — left to the frontend build step's own judgment; not pre-decided here.

---

## 5. Proposed schema (for review — nothing below has been applied)

```prisma
enum ProjectStatus {
  planning
  active
  on_hold
  completed
  cancelled
}

enum TaskStatus {
  todo
  in_progress
  blocked
  done
}

model Project {
  id          String        @id @default(uuid())
  companyId   String
  company     Company       @relation(fields: [companyId], references: [id])
  name        String
  description String?
  status      ProjectStatus @default(planning)
  startDate   DateTime?
  dueDate     DateTime?
  // Plain string, no relation — same "who did this" convention as
  // LeaveRequest.approvedBy / PayrollRun.finalizedBy: an audit-adjacent
  // fact, not a query join point.
  createdBy   String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  members ProjectMember[]
  tasks   Task[]
}

model ProjectMember {
  id         String   @id @default(uuid())
  // Denormalized onto this row (not just reachable via Project) because
  // RLS policies always compare a column on the row itself — every
  // other tenant-owned table in this schema does the same, even ones
  // that could theoretically derive companyId through a join.
  companyId  String
  company    Company  @relation(fields: [companyId], references: [id])
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id])
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id])
  createdAt  DateTime @default(now())

  @@unique([projectId, employeeId])
}

model Task {
  id          String     @id @default(uuid())
  companyId   String
  company     Company    @relation(fields: [companyId], references: [id])
  projectId   String
  project     Project    @relation(fields: [projectId], references: [id])
  title       String
  description String?
  status      TaskStatus @default(todo)
  assigneeId  String?
  assignee    Employee?  @relation(fields: [assigneeId], references: [id])
  dueDate     DateTime?
  createdBy   String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  timeEntries TaskTimeEntry[]
}

model TaskTimeEntry {
  id         String   @id @default(uuid())
  companyId  String
  company    Company  @relation(fields: [companyId], references: [id])
  taskId     String
  task       Task     @relation(fields: [taskId], references: [id])
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id])
  date       DateTime
  hours      Decimal  @db.Decimal(5, 2)
  note       String?
  createdAt  DateTime @default(now())
}
```

Matching RLS additions (same migration shape as every existing table):

```sql
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Project"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "ProjectMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProjectMember"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING ("companyId" = current_setting('app.current_company_id', true));

ALTER TABLE "TaskTimeEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaskTimeEntry"
  USING ("companyId" = current_setting('app.current_company_id', true));
```

Plus additions to existing (not new) files: `"projects"` added to `RBAC_MODULES` (`rbac.constants.ts`), and the manager/employee default grants described in §3 added to `DEFAULT_ROLE_PERMISSIONS` (`default-role-permissions.ts`).

---

## 6. Build order

Same granularity, same standard, as every HR module — each step run and verified against real infrastructure before the next begins:

1. **Schema + migration + RLS.** Add the four models and enums above, generate and run the real migration, extend the existing `verify-rls.ts`-style check to confirm `Project`/`Task` rows are genuinely isolated cross-tenant — proven, not assumed.
2. **RBAC wiring.** Add `projects` to `RBAC_MODULES` and the default grants to `DEFAULT_ROLE_PERMISSIONS`; extend `permission-check.service.spec.ts`'s coverage.
3. **Backend: Project + ProjectMember CRUD.** Create/list/view/update/archive a project; add/remove members. Real e2e tests proving the three-tier scope model end to end — admin sees all, manager sees only projects with a member from their department, employee sees only projects they're a member of.
4. **Backend: Task CRUD.** Create/assign/update status/delete, same scope enforcement, same RBAC boundary e2e tests (including the "employee can only touch their own assigned task's status" allow-list, matching `UpdateOwnEmployeeDto`'s pattern).
5. **Backend: Time entries.** Log/list `TaskTimeEntry` rows, self-scoped for an employee, team-scoped for a manager/admin reviewing them.
6. **Frontend UI.** Project list/detail, task list (or board) view, member management, task assignment, status updates, time logging — real-backend integration tests (not mocked), fully localized en/ar/ku with RTL, matching every other in-company screen (unlike the Super Admin dashboard, this module is used by real company staff).
7. **Full verification pass.** The same kind of audit already run twice for HR (Part 1/2/3-style: confirm the RBAC boundaries actually hold, confirm nothing leaks cross-tenant, confirm the translations are complete and interpolation-correct) before calling module #2 done.

No step starts until the previous one is run and verified for real — same rule as everything built so far, no exception for a second module.

---

*Status: proposed, awaiting confirmation. No code, migration, or schema change has been made — this document and the schema in §5 are the full extent of this pass.*
