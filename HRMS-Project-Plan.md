# HRMS for Kurdistan & Iraq — Full Project Plan
*A ZenHR-style HR platform built solo, with Claude Code as your build partner*

---

## 1. Vision & Positioning

**What you're building:** A multi-tenant HR & payroll platform (SaaS) for companies in Slemani, Erbil, and other Iraqi cities.

**Why you can win against ZenHR locally:**
- Native Kurdish (Sorani) + Arabic + English support, not translated as an afterthought
- Payroll logic that actually matches KRG/Iraqi labor law and local social security
- Local biometric device support (ZKTeco and similar, common in the region)
- Offline-tolerant mobile app for areas with unreliable internet
- Local pricing in IQD, local payment methods, local support/onboarding in Kurdish/Arabic
- Faster, more responsive support because you're local — not a regional office of a bigger company

**Target customer for v1:** SMEs (30–300 employees) in Slemani/Erbil who currently run HR on Excel/WhatsApp/paper. Don't target giant enterprises first — their procurement cycles will kill you as a solo dev.

---

## 2. MVP Scope (v1) — build this first, nothing else

| # | Module | Core features only |
|---|--------|---------------------|
| 1 | Employee Management | Profiles, departments/branches, document storage (ID, contract, passport), org chart |
| 2 | Attendance | Clock in/out (web + mobile), basic shift assignment, timesheet view |
| 3 | Leave Management | Request/approve workflow, leave types, balance auto-calculation |
| 4 | Payroll (basic) | Salary structure, overtime/deductions, payslip generation (PDF), payroll history |
| 5 | Employee Self-Service | Mobile/web portal: request leave, view payslip, clock in/out, update basic info |
| 6 | Manager Self-Service | Approve leave, approve attendance corrections, view team list |
| 7 | Security | Role-based permissions (Admin/HR/Manager/Employee), 2FA, audit log |
| 8 | Notifications | Email + push (leave approved/rejected, payslip ready, birthdays) |

**Explicitly OUT of scope for v1:** ATS/recruitment, performance management (OKRs/360), custom dashboards, ERP/accounting integrations, biometric hardware integration. These are v2/v3 — resist the urge to add them early.

---

## 3. Tech Stack

Pick one lane and commit — don't mix stacks as a solo dev.

**Recommended stack:**
- **Backend:** Node.js + NestJS (TypeScript) — strong structure, built-in support for modular architecture, guards/roles for RBAC, good with Claude Code since it's well-documented and conventions are strict (Claude Code writes cleaner NestJS than loose Express)
- **Database:** PostgreSQL — relational integrity matters a lot for payroll/leave balances; use Prisma or TypeORM as the ORM
- **Frontend (web):** Next.js + Tailwind CSS
- **Mobile:** React Native (Expo) — one codebase, faster for a solo dev, easier OTA updates
- **Auth:** JWT + refresh tokens, role-based guards, TOTP-based 2FA (e.g. `otplib`)
- **File storage:** S3-compatible storage (for contracts, IDs, payslip PDFs) — start with local disk in dev, S3/DigitalOcean Spaces in prod
- **Background jobs:** BullMQ (Redis-based) — for payslip generation, leave-balance recalculation, reminder emails
- **PDF generation:** Puppeteer or a template-based PDF library for payslips
- **Hosting:** Start simple — a single VPS (Hetzner/DigitalOcean) with Docker Compose (API + Postgres + Redis + frontend). Don't over-engineer with Kubernetes at this stage.

---

## 4. Multi-Tenancy Design (critical — decide this before writing code)

Since you're selling to multiple companies, decide the tenancy model now:

- **Recommended for solo dev:** Shared database, shared schema, with a `company_id` (tenant_id) column on every table + Postgres Row-Level Security (RLS) enforcing tenant isolation at the DB level. This is far easier to maintain solo than separate databases per client, and RLS gives you a safety net against app-layer bugs leaking data across tenants.
- Every table (employees, leave_requests, payroll_runs, documents, etc.) gets `company_id`.
- Every query goes through a tenant-scoped repository layer — never a raw query without the tenant filter.

---

## 5. Core Data Model (starting schema)

```
companies (id, name, city, timezone, locale_default, subscription_plan)
users (id, company_id, email, password_hash, role, 2fa_secret, locale)
employees (id, company_id, user_id, full_name, national_id, job_title,
           department_id, branch_id, hire_date, salary_base, status)
departments (id, company_id, name, parent_department_id)
branches (id, company_id, name, city)
documents (id, company_id, employee_id, type[contract/id/passport/certificate],
           file_url, expiry_date)
attendance_records (id, company_id, employee_id, clock_in, clock_out, source)
shifts (id, company_id, name, start_time, end_time)
leave_types (id, company_id, name, days_per_year, requires_approval)
leave_requests (id, company_id, employee_id, leave_type_id, start_date,
                end_date, status, approved_by)
leave_balances (id, company_id, employee_id, leave_type_id, year, balance)
payroll_runs (id, company_id, period_start, period_end, status)
payslips (id, company_id, employee_id, payroll_run_id, gross, deductions,
          net, pdf_url)
audit_logs (id, company_id, user_id, action, entity, entity_id, timestamp)
```

This is enough to build the entire MVP. Expand it module by module in v2 (add `candidates`, `job_postings` for ATS; `goals`, `reviews` for performance mgmt, etc.).

---

## 6. Localization Plan

- Store all UI strings in i18n JSON files: `en.json`, `ar.json`, `ku.json` (Sorani) from day one — even if you launch English-only first, structure the code so adding a language is a translation task, not a refactor.
- Payroll module needs a **rules engine per region** (KRG vs federal Iraq) rather than hardcoded formulas — social security %, tax brackets, and overtime rules differ. Build this as a configurable table, not code constants, so you can adjust without redeploying.
- Store salaries with a currency field (IQD/USD) — many companies pay in USD.
- Local holiday calendar (Newroz, Eid al-Fitr, Eid al-Adha, Iraqi national days) as a seedable table, not hardcoded — dates shift yearly (lunar calendar for Eid).

---

## 7. Phased Roadmap

| Phase | Focus | Est. time (solo, using Claude Code) |
|-------|-------|--------------------------------------|
| 0 | Validate with 2–3 real pilot companies in Slemani/Erbil — interview them, confirm they'd pay | 2–3 weeks |
| 1 | MVP backend: auth, multi-tenancy, employee mgmt, attendance, leave | 4–6 weeks |
| 2 | MVP payroll + payslip generation + ESS/manager portals (web) | 4–5 weeks |
| 3 | Mobile app (React Native): clock-in, leave requests, payslips | 3–4 weeks |
| 4 | Polish, pilot deployment with your 2–3 companies, fix real-world bugs | 2–3 weeks |
| 5 | v2: notifications polish, document mgmt, reports, biometric integration | ongoing |
| 6 | v3: ATS, performance management, integrations (accounting/ERP, Slack/Teams) | ongoing |

Total to a sellable MVP: roughly **4–5 months** working solo with AI-assisted coding, if you stay disciplined about scope.

---

## 8. How to Work With Claude Code on This

Suggested workflow, phase by phase:

1. **Set up the repo structure first**, manually or with one Claude Code session:
   ```
   /apps
     /api        (NestJS backend)
     /web        (Next.js frontend)
     /mobile     (React Native/Expo)
   /packages
     /shared     (shared types, i18n strings, validation schemas)
   ```
2. **Give Claude Code the schema above** as a starting point in a `SCHEMA.md` or directly as a Prisma schema file — ask it to generate the Prisma schema + migrations from it.
3. **Build backend module by module**, not all at once. One Claude Code session per module (e.g. "implement the Employee Management module: CRUD + document upload + RBAC guards"), so context stays focused and code stays reviewable.
4. **Write tests as you go** — ask Claude Code to generate unit tests for services (especially payroll calculations and leave-balance logic, since bugs there directly cost your customers money).
5. **Keep a `DECISIONS.md`** in the repo logging key architecture decisions (tenancy model, currency handling, localization approach) so future Claude Code sessions have that context without you re-explaining it every time.
6. **Use this plan file itself** (`HRMS-Project-Plan.md`) as project context — drop it into your repo root and reference it when starting new Claude Code sessions so it always knows the big picture and current phase.

---

## 9. Immediate Next Steps (this week)

1. Talk to 2–3 companies in Slemani/Erbil you have access to — confirm the pain points from the module list actually match what they struggle with today.
2. Decide backend framework (NestJS recommended) and set up the monorepo skeleton.
3. Build the multi-tenant `companies` + `users` + RBAC foundation first — everything else depends on this being solid.
4. Implement Employee Management module end-to-end (backend + basic web UI) as your first real milestone.

---

*This plan is a living document — update it as you learn from pilot customers. The biggest risk to this project isn't technical complexity, it's scope creep: resist building v2/v3 features until v1 has real paying users.*
