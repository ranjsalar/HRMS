# HRMS → Full ERP Master Plan
*From "HR & Payroll for Kurdistan" to "every department, every company, one platform"*

---

## 1. Where you actually stand today

Not a pitch — a real inventory, since everything below depends on it being accurate.

**Built, tested, in CI, on GitHub:**
- Multi-tenant foundation: `company_id` + Postgres Row-Level Security on every table, proven to genuinely block cross-company data leaks
- Super Admin: creates companies + their first admin, suspends/reactivates companies, sees every tenant
- Company Admin: full company-wide visibility and control over their own tenant only
- HR & Payroll module, complete: Employee Management, Attendance, Leave, Payroll (KRG + federal Iraq rules engine — mechanically correct, legally unreviewed), Employee/Manager Self-Service, RBAC, 2FA, audit logging, email notifications — all in English/Arabic/Kurdish Sorani with RTL support
- Infrastructure: Docker, reverse proxy + TLS, backups, monitoring, rate limiting, CI — code-complete, locally proven, not yet live on a real server

**This matters for everything below**: the *hardest* part of a multi-tenant ERP — tenant isolation, RBAC, the superadmin/company_admin/manager/employee hierarchy — is already built and proven. Every new department you add plugs into this same foundation. You are not starting over for each module; you're extending a working spine.

---

## 2. The full vision, stated plainly

One platform. Super Admin (you) sells access to companies. Each company's Admin manages **every department** their business has — not just HR, but Accounting, Inventory, Sales, and Projects too — all under the same login, same design, same multi-tenant isolation, same RBAC model. A company in Slemani running this system should be able to close their books, track stock, manage a sales pipeline, run projects, and run payroll — all in one place, in their own language.

That is a real, legitimate, large ambition. It is also, honestly, a multi-year build for a solo founder even with AI-assisted development — Odoo itself took over a decade to reach this breadth. The plan below isn't to talk you out of the destination. It's to make sure you actually get there, instead of ending up with five half-finished modules and zero paying customers.

---

## 3. The new modules

Each one below is, honestly, roughly the size of everything built for HR so far — this isn't a "quick add," it's a real project each time.

### 3.1 Accounting / Finance
- Chart of accounts, general ledger, journal entries
- Invoicing (customer-facing) and bills (vendor-facing)
- Bank account tracking, reconciliation
- Financial reports: P&L, balance sheet, cash flow
- Tax reporting (ties into the same "region-specific rules engine, not hardcoded" principle already used for payroll)
- **Why it's hard**: real double-entry bookkeeping correctness, currency handling at real precision, and — like payroll — genuine legal/accounting review before any real company's real books touch it. Errors here aren't UX bugs, they're potentially illegal.

### 3.2 Inventory / Warehouse
- Product catalog, SKUs, stock levels per location/branch
- Stock movements (in/out/transfer), low-stock alerts
- Purchase orders, receiving
- **Why it's hard**: real-time stock accuracy across concurrent operations, integration with Accounting (a stock movement often needs a matching journal entry) and eventually Sales (an order needs to check/reserve stock)

### 3.3 Sales / CRM
- Leads, contacts, companies (customers, not tenants — different meaning of "company" here, worth being careful about naming)
- Sales pipeline / deal stages
- Quotes and orders, converting to Accounting invoices
- **Why it's hard**: this is the module most different in *shape* from everything else — pipeline/kanban-style workflows, not record-CRUD like HR

### 3.4 Projects / Task Management
- Projects, tasks, assignments, deadlines
- Time tracking (can reuse patterns from Attendance)
- Ties into HR (who's assigned) and potentially billing (project hours → invoice)
- **Why it's easier relatively**: closest in shape to what's already built (assignment, status workflows, RBAC-scoped visibility) — likely the fastest of the four to build

### 3.5 Cross-cutting: Super Admin platform management
Once there are real paying companies, Super Admin needs more than create/suspend:
- Billing/subscription management per company
- Usage dashboards across all tenants
- This isn't a "module" like the others — it's an extension of what already exists (Super Admin dashboard) as real usage demands it

---

## 4. Recommended build order, and why

**1. Finish and deploy HR/Payroll first — genuinely finish it, not "build more."**
You have zero live users right now. Every hour spent on Accounting before HR is proven with a real paying company is an hour spent guessing. This is the same argument as before, stated once more because it's the actual foundation the rest of this plan depends on: real feedback from one real customer using HR/Payroll will tell you more about what to build next than any amount of planning tonight.

**2. Projects/Task Management — likely module #2.**
Closest in shape to existing patterns (fastest to build well), genuinely useful standalone even before Accounting exists, and lower legal/compliance risk than Accounting or Payroll-adjacent work.

**3. Inventory — module #3, if your target customers need it.**
Worth confirming with real pilot companies first: do Kurdistan SMEs in your target segment (30-300 employees) actually need inventory, or is that a different customer profile than who needs HR/Payroll? Don't build this speculatively — ask first.

**4. Sales/CRM — module #4.**
Different enough in shape (pipeline-based, not record-based) that it benefits from having 2-3 other modules' patterns already proven first.

**5. Accounting — last, and only with real financial/legal review lined up before writing code, same as payroll.**
The highest-stakes module (real money, real legal exposure) deserves the most preparation, and by this point you'll have real revenue to justify a proper accountant's involvement in the design, not just the launch review.

**This order is a recommendation, not a mandate — you know your target customers better than I do.** If your first pilot conversations reveal everyone actually needs Inventory before Projects, reorder it. The point of asking real companies first is exactly so this order can be corrected by real information instead of guesses.

---

## 5. How each module actually gets built (same process, every time)

This is the part that matters most — not the feature list above, but the discipline that got HR/Payroll to a genuinely production-ready state tonight:

1. **A real plan document for that module** (like this one, but scoped to just that department) — written and reviewed before any code.
2. **A real Prisma schema addition**, reviewed and confirmed before migrations run.
3. **Built in small, reviewable steps** — scaffolding, then core CRUD, then business logic, then UI — each one run and verified against real infrastructure before moving to the next, exactly like HR was built.
4. **Every step tested for real** — real database, real RBAC boundaries proven with e2e tests, not assumed.
5. **A full verification pass at the end** — the same kind of audit that just caught the employee-onboarding gap in HR, run again for the new module before calling it done.

No module skips this. The temptation, especially with the energy you have right now, will be to rush a module through faster than HR was built. Every real bug caught tonight came from *not* doing that.

---

## 6. What to actually do next

Pick one:
- **Confirm this plan** roughly matches your vision, adjust the module list or order if not.
- **Then**: either (a) go get HR/Payroll actually deployed and in front of a real company first, per section 4's #1 — genuinely the fastest path to knowing this plan is even right — or (b) if you want to start building module #2 in parallel with figuring out deployment, we scope Projects/Task Management properly, the same way HR was originally scoped, before writing a single Claude Code prompt for it.

This document is the map. It doesn't replace real customer conversations — it gets updated by them.

---

*Status as of 2026-08-01: option confirmed as "close the HR/Payroll gaps first" (payroll legal review, translation review, real deployment) in parallel with scoping module #2 — see `Projects-Module-Plan.md`.*
