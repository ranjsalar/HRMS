# Sales / CRM — Module Plan
*ERP module #3 as built (listed as #4 in `ERP-Master-Plan.md`; Inventory deliberately skipped for now — see the note below). Same role for this module that `Projects-Module-Plan.md` played for Projects and `HRMS-Project-Plan.md` played for HR — read and confirmed before any code.*

**On the ordering:** `ERP-Master-Plan.md` sequences Inventory as #3 and Sales/CRM as #4. Building Sales/CRM now skips Inventory, which is consistent with that document's own guidance on it ("Worth confirming with real pilot companies first... Don't build this speculatively — ask first") — no pilot has confirmed an inventory need, so not building it is the plan working as intended, not a deviation. Recorded here so the sequence stays honest. The master plan also flagged Sales/CRM as "the module most different in *shape* from everything else" and worth doing after 2–3 other modules' patterns are proven; HR and Projects satisfy that.

**Still open, unchanged, on the HR side:** payroll rate legal review (hard blocker for real payroll use), native-speaker translation review, and no live server deployment. This module runs in parallel with those, same arrangement as Projects.

---

## 1. Core entities

**No new tenancy or identity concept.** Every entity below carries `companyId` and gets the identical Row-Level Security treatment as every existing table. Every reference to a person *inside* the tenant points at `Employee` — never a new "user"/"rep"/"owner" concept — matching the rule this codebase has held since HR (`LeaveRequest.employeeId`, `Task.assigneeId`, `TaskTimeEntry.employeeId`).

### The naming problem, solved explicitly

`ERP-Master-Plan.md` flagged this directly: *"companies (customers, not tenants — different meaning of 'company' here, worth being careful about naming)."* `Company` is already, unambiguously, **the tenant** — it is the root of RLS, it owns every table, and renaming or overloading it is out of the question.

**Decision: the customer organization is `Customer`. The word "Company" never appears in this module's vocabulary.** No `CustomerCompany`, no `Account` (which would introduce a *third* word for the same idea and collide with accounting vocabulary in module #5). Just `Customer`.

| Model | Represents |
|---|---|
| `Customer` | An organization or individual this tenant sells to. Carries an `ownerId` (the `Employee` who owns the account) and a `type` (`organization` / `individual`) — a one-person client and a 200-person client are both real in this market, and forcing an individual into an "organization" record produces junk data. |
| `CustomerContact` | A person at a `Customer` — name, job title, email, phone. Separate from `Customer` rather than flattened into it, see below. |
| `Lead` | An unqualified inbound inquiry that is **not yet a customer** — often just a name and a phone number. Has no `Customer` record until it converts. |
| `Deal` | A real sales opportunity against a `Customer`, moving through pipeline stages, carrying the commercial data (amount, currency, expected close date). |
| `SalesOrder` | The quote/order record produced from a won `Deal`. |
| `SalesOrderLine` | A line item on a `SalesOrder` — free-text description, quantity, unit price (see §4 on why free-text). |

### Why `CustomerContact` is separate from `Customer`

You asked for "Contact/Customer" as one bullet, so this is a judgment call worth stating rather than assuming. **Recommendation: keep them separate (1:N).** Reasoning: in real B2B selling to a 30–300-person company you routinely deal with two or three different people at the same customer — a procurement contact and a finance contact, say — and collapsing them into one embedded contact on `Customer` means either overwriting the person you're not currently talking to, or creating duplicate `Customer` rows per person (which then corrupts every deal-per-customer count). It's a plain 1:N, not real complexity, and retrofitting it later means migrating embedded columns out, which is meaningfully messier than starting with it.

**The alternative, if you'd rather:** collapse to a single `Customer` with `primaryContactName`/`primaryContactEmail`/`primaryContactPhone` columns and defer multi-contact. That drops one model and one CRUD surface from the build. Cheaper now, more painful later. My recommendation is the split, but this is a genuine either/or, not a foregone conclusion.

### Why `Lead` is separate from `Deal`

Your suggested stage set (`new/contacted/qualified/proposal/won/lost`) is actually a *single continuous pipeline* spanning both lead qualification and deal progression — that's a real and legitimate design (it's roughly how HubSpot's simpler setups work), so it's worth being explicit about why I'm proposing something different.

**Recommendation: separate `Lead` and `Deal`.** Reasoning:

1. **Different data requirements.** A lead is frequently a name and a phone number from a WhatsApp message or a trade-show card, with no organization, no amount, no close date. Forcing it into `Deal` means either making `customerId` and `amount` nullable on `Deal` (which then makes every pipeline-value calculation defensive and every report caveated), or fabricating a `Customer` record for someone who may never become one — which pollutes the customer list with junk.
2. **Unqualified noise corrupts the pipeline.** If leads live in the deal pipeline, "total open pipeline value" includes tyre-kickers. Keeping them separate means `Deal` rows are all real, qualified opportunities with a real `Customer` and a real amount.
3. **Conversion is a genuine, auditable event** — "this lead became this customer and this deal" is information worth recording, and it only exists if the two are distinct.

The stage sets then split cleanly across the two, covering your list between them with no overlap:

- `LeadStatus`: `new` → `contacted` → `qualified` (terminal, converted) / `disqualified` (terminal)
- `DealStage`: `new` → `proposal` → `negotiation` → `won` (terminal) / `lost` (terminal)

Both are real Prisma enums, matching every other status field in this schema (`EmployeeStatus`, `LeaveStatus`, `ProjectStatus`, `TaskStatus`). Same trade-off stated in the Projects plan applies and is restated here rather than assumed: **adding a stage later requires a migration**, unlike a plain string. Per-company custom pipeline stages are explicitly out of scope (§4).

### The Accounting connection point — documented, not built

You asked for the future connection to Accounting invoices to be *noted in the schema design*, not built. Being precise about what that means:

**No speculative column is added now.** Adding an `invoiceId String?` to `SalesOrder` today would be a column pointing at a table that does not exist, which is exactly the kind of guessing this build has refused before (the birthday-field decision in the notifications work).

**The connection point, stated for the record:** when Accounting is built, `Invoice` will carry a nullable `salesOrderId` FK pointing *back* at `SalesOrder`. The new module carries the reference to the older one. This direction is deliberate and matters: it means Accounting can be built without a single migration to any Sales table (only a Prisma back-relation, which is not a database change), and a `SalesOrder` remains perfectly valid and complete with no invoice ever attached — which it must, since plenty of orders never get invoiced through this system. `SalesOrder` needs nothing added today to be ready for that.

---

## 2. Core workflow

**Lead captured → contacted → qualified (converts to Customer + Deal) → deal moves through stages → won → SalesOrder created.**

- **Lead capture** is manual entry in v1 (a rep logging an inquiry). No web-form embed, no email parsing, no import — see §4. `Lead.source` is a free-text string (e.g. "trade show", "referral", "walk-in") rather than an enum, deliberately: the useful values here are genuinely per-company and unknowable in advance, and an enum would need a migration every time a company tried a new channel. This is the one place a plain string beats an enum in this module, and the asymmetry with `LeadStatus`/`DealStage` is intentional — those are workflow states the application reasons about; `source` is a label the application never branches on.

- **Conversion** (`POST /leads/:id/convert`) is a single transactional operation: creates a `Customer` (and optionally a first `CustomerContact`) from the lead's data, creates an opening `Deal` against it, sets the lead's status to `qualified`, and records `convertedCustomerId`/`convertedDealId` on the lead. All in one transaction — a half-converted lead (customer created, deal missing) is exactly the kind of inconsistent state that's painful to clean up by hand. Converting an already-converted lead is rejected (409), not silently repeated.

- **Stage transitions are deliberately unrestricted for v1** — any stage to any stage, by anyone with edit rights on that deal. No enforced state machine, no "cannot skip negotiation", no "won is irreversible". This matches the Projects module's identical decision, which you explicitly confirmed as a deliberate yes rather than an unexamined default; restating it here so it's a deliberate yes for this module too, not inherited by momentum. Real sales genuinely do jump stages and re-open lost deals. Revisit only if real usage shows a specific transition needs blocking.

- **Won deal → SalesOrder** (`POST /deals/:id/sales-order`) creates a `SalesOrder` linked to the deal and its customer. Whether this requires the deal to already be at `won` is a real choice: **recommendation is to allow it at any stage** (quotes are routinely sent *during* negotiation — that's what moves a deal to `won`), with the deal link recorded either way. Requiring `won` first would invert the real-world order of operations.

- **Deal amount vs order total.** `Deal.amount` is the rep's estimate; `SalesOrder`'s total is the sum of its real line items. These are deliberately **not** kept in sync — they answer different questions ("what do I think this is worth" vs "what did we actually quote"), and auto-overwriting the forecast with the quote would destroy the ability to compare them later. No computed/denormalized order total column either; the total is summed from lines at read time (small N, no cache-invalidation class of bug).

---

## 3. RBAC model

**Recommendation: no new role. Reuse the existing `employee` / `manager` / `company_admin` tiers.**

You raised a "sales rep" role as a possibility. My judgment is that it would be a genuine step backwards, and the reasoning is concrete:

1. **The existing model already expresses it exactly.** RBAC here is role × module × action × **scope** (`self` / `own_department` / `all`). A "sales rep" is precisely *an `employee` granted `sales:*` at `self` scope*. A sales manager is *a `manager` at `own_department` scope*, where the department **is** the company's Sales department — a real `Department` row that already exists in the org structure. Nothing about a sales rep needs a concept the current system lacks.
2. **A new role is a schema change with permanent reach.** `RoleName` is a Prisma enum on `User`; adding `sales_rep` means a migration, plus every `roleRequiresTwoFactor`-style check, every seed template, and every role-conditional branch in the frontend gaining a fourth case — forever, across all modules, not just this one.
3. **It would fragment by department, not by function.** If Sales gets its own role, the same argument applies to Support, Procurement, and every other function — ending in a role per department, which is exactly the failure mode the department + scope model was built to avoid.
4. **Precedent.** Projects didn't add a "project manager" role either; it reused `manager` plus an explicit per-company opt-in grant. Same shape here.

### Scope semantics, per entity

| Role | `Customer` / `CustomerContact` | `Lead` / `Deal` / `SalesOrder` |
|---|---|---|
| `company_admin` | `all` (default) | `all` (default) |
| `manager` | `all` for view; `own_department` for edit | `own_department` — records owned by an employee in a department they manage |
| `employee` (sales rep) | `all` for view; `self` for edit (records they own) | `self` — records they own |

**Ownership drives scope.** `Customer.ownerId`, `Lead.ownerId`, and `Deal.ownerId` all reference `Employee`. `own_department` means *"owned by an employee in a department I manage"* — resolved through `Employee.departmentId`, mirroring `AttendanceService.teamTimesheet` and `TaskTimeEntriesService`, **not** Projects' membership-based rule (there is no membership concept here; a deal has exactly one owner). `SalesOrder` inherits its scope from its parent `Deal` rather than carrying its own owner — an order without a deal has no meaning in this module.

### The one decision that genuinely needs your confirmation: customer visibility is wider than deal visibility

**Recommendation: `Customer` and `CustomerContact` are readable at `all` scope by anyone granted `sales:view`, regardless of role — while `Lead`, `Deal`, and `SalesOrder` are owner-scoped as above.**

Reasoning: the single most common, most expensive CRM data failure in a small sales team is **two reps unknowingly working the same customer** — duplicate customer records, duplicate outreach, and occasionally two competing quotes reaching the same buyer. Owner-scoping the customer list causes that directly and predictably. Meanwhile the genuinely sensitive commercial information — what a deal is worth, what stage it's at, what was quoted — lives on `Deal` and `SalesOrder`, which *are* scoped. So a rep can see *that* a customer exists and who owns the account (which is exactly what prevents the collision), without seeing anyone else's numbers.

**The cost, stated plainly:** any employee granted `sales:view` can see the full customer list, which is a real data-exposure consideration if a rep leaves. Two mitigations already exist and neither requires new code: `sales:view` is not a default grant for `employee` (it's an explicit per-company opt-in, see below), and every read is audit-logged.

**The alternative** is owner-scoping `Customer` too, accepting the duplicate-customer problem and adding a "search all customers" escape hatch later. I recommend against it, but this is a real product trade-off and it's your call, not mine — the same way the `own_department` definition in Projects was.

### Default grants

Following the established precedent exactly (`employees:create` and `projects:create` are admin-only by default, manager/employee opt-in per company via `/rbac/permissions`):

- **`company_admin`**: full access to the `sales` module automatically, via the existing `fullAccess()` helper — no explicit rows needed.
- **`manager`**: `sales:view` at `all`, `sales:edit` at `own_department`. **No `sales:create` or `sales:delete` by default.**
- **`employee`**: **nothing by default.** Unlike Projects (where every employee has tasks), most employees at a company are not in sales — granting the whole workforce sight of the customer list by default would be wrong. A company turns a specific employee into a sales rep by granting `sales:view`/`sales:create`/`sales:edit` at `self` scope through the existing RBAC UI. This is the deliberate opt-in that makes the wide customer-read decision above safe.

One RBAC module name — **`sales`** — covering all six entities. Same reasoning as Projects using one `projects` module for Project/Task/TaskTimeEntry: nothing here is reachable from a `self`-scoped grant in a way that could be misread as authority over something else, so the `leave`/`leave_types` split has no analogue.

---

## 4. Explicitly OUT of scope for v1

Matching the discipline of every prior module — this is the section that keeps the build finite:

- **Email integration of any kind** — no inbox sync, no send-from-CRM, no email logging against a deal, no tracking pixels.
- **Marketing automation** — no campaigns, sequences, drip emails, or mass mail.
- **Quote-to-invoice conversion** — explicitly out, per your instruction. Accounting doesn't exist; the connection point is documented in §1 and nothing more.
- **Product catalog / inventory-linked line items.** Inventory isn't built, so there is no `Product` to reference. `SalesOrderLine` carries a free-text `description` with a manual `unitPrice`. **This is a real, visible limitation** — reps retype product names and prices, and nothing validates them against a catalog or reserves stock. The forward-compatible detail: when Inventory ships, `SalesOrderLine` gains a nullable `productId`, existing free-text lines stay valid, and no data migration is needed.
- **Sales forecasting / weighted pipeline** — no `probability` field, no expected-value maths, no quota tracking, no commission calculation.
- **Reports and dashboards of any kind** — no pipeline-by-stage chart, no win-rate, no revenue-by-rep, no CSV export. Records are listable and filterable, nothing more. (Same line the Projects module held on time-entry reporting.)
- **Activity tracking on deals** — no logged calls, meetings, or notes-with-timestamps. The Projects module has `Task`, but those are project-scoped; cross-linking Sales activities to Projects tasks is a deliberate later decision, not a v1 freebie.
- **Duplicate detection or merge tooling** — no fuzzy matching on customer names, no merge UI. Mitigated in v1 by the wide customer-read decision in §3, not solved by it.
- **Per-company custom pipeline stages or custom fields** — the enums are the enums. Genuinely useful, genuinely a large feature (dynamic schema, dynamic UI, dynamic validation), and explicitly not now.
- **Territory management, lead assignment rules, round-robin routing** — owners are set manually.
- **Lead scoring** — no automatic ranking.
- **Customer portal / self-service** — customers have no login; there is no external-facing surface in this module.
- **File attachments on deals or customers** — the Documents module exists and could plausibly attach here someday; not built now.
- **Multi-currency conversion** — each record carries its own `currency` (matching `Employee.salaryBase`/`Payslip`), and no FX rate, conversion, or mixed-currency total is calculated anywhere. Summing a customer's deals across currencies is not offered rather than offered wrongly.
- **Kanban drag-and-drop specifics** — left to the frontend step's own judgment, same as Projects (where the answer landed on a plain list with a status control, not a drag board).

---

## 5. Proposed schema (for review — nothing below has been applied)

Same conventions as every existing table: non-nullable `companyId`, `Decimal @db.Decimal(14, 2)` for money with a sibling `currency String @default("IQD")` (matching `Employee.salaryBase` and `Payslip`), plain-string `createdBy` for audit-adjacent facts, real enums for workflow states.

```prisma
enum CustomerType {
  organization
  individual
}

enum LeadStatus {
  new
  contacted
  qualified
  disqualified
}

enum DealStage {
  new
  proposal
  negotiation
  won
  lost
}

enum SalesOrderStatus {
  draft
  sent
  accepted
  cancelled
}

model Customer {
  id          String       @id @default(uuid())
  companyId   String
  company     Company      @relation(fields: [companyId], references: [id])
  name        String
  type        CustomerType @default(organization)
  // The Employee who owns this account. Nullable: a customer can exist
  // before anyone is assigned (e.g. created by an admin during setup).
  ownerId     String?
  owner       Employee?    @relation("CustomerOwner", fields: [ownerId], references: [id])
  email       String?
  phone       String?
  address     String?
  city        String?
  notes       String?
  createdBy   String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  contacts   CustomerContact[]
  deals      Deal[]
  salesOrders SalesOrder[]
}

model CustomerContact {
  id         String   @id @default(uuid())
  companyId  String
  company    Company  @relation(fields: [companyId], references: [id])
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  fullName   String
  jobTitle   String?
  email      String?
  phone      String?
  // Exactly one contact per customer may be primary — enforced in the
  // service layer, not by a DB constraint (Postgres partial unique
  // indexes aren't expressible in Prisma schema, and the rule is cheap
  // to enforce in the same transaction as the write).
  isPrimary  Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Lead {
  id           String     @id @default(uuid())
  companyId    String
  company      Company    @relation(fields: [companyId], references: [id])
  // Deliberately NOT a Customer FK — a lead has no customer record until
  // it converts. That's the entire reason Lead exists separately.
  contactName  String
  organizationName String?
  email        String?
  phone        String?
  // Free-text, not an enum — see §2. The useful values are per-company
  // and unknowable in advance, and nothing branches on this.
  source       String?
  status       LeadStatus @default(new)
  ownerId      String?
  owner        Employee?  @relation("LeadOwner", fields: [ownerId], references: [id])
  notes        String?
  // Plain strings, no relations — the same audit-adjacent "what did this
  // become" convention as LeaveRequest.approvedBy / Project.createdBy.
  // A trace for humans reading a converted lead, not a query join point.
  convertedCustomerId String?
  convertedDealId     String?
  createdBy    String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}

model Deal {
  id                String    @id @default(uuid())
  companyId         String
  company           Company   @relation(fields: [companyId], references: [id])
  customerId        String
  customer          Customer  @relation(fields: [customerId], references: [id])
  title             String
  stage             DealStage @default(new)
  // The rep's estimate. Deliberately NOT synced with the sum of any
  // SalesOrder's lines — see §2.
  amount            Decimal?  @db.Decimal(14, 2)
  currency          String    @default("IQD") // IQD | USD
  expectedCloseDate DateTime?
  ownerId           String?
  owner             Employee? @relation("DealOwner", fields: [ownerId], references: [id])
  notes             String?
  createdBy         String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  salesOrders SalesOrder[]
}

model SalesOrder {
  id         String           @id @default(uuid())
  companyId  String
  company    Company          @relation(fields: [companyId], references: [id])
  dealId     String
  deal       Deal             @relation(fields: [dealId], references: [id])
  // Denormalized from the deal so an order can be read and scoped without
  // a join, matching how every tenant-owned table already carries its own
  // companyId rather than deriving it.
  customerId String
  customer   Customer         @relation(fields: [customerId], references: [id])
  // Human-facing reference (e.g. "SO-2026-014"). Generated in the service
  // layer, unique per company.
  reference  String
  status     SalesOrderStatus @default(draft)
  currency   String           @default("IQD")
  issuedDate DateTime?
  validUntil DateTime?
  notes      String?
  createdBy  String?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  lines SalesOrderLine[]

  @@unique([companyId, reference])
}

model SalesOrderLine {
  id           String     @id @default(uuid())
  companyId    String
  company      Company    @relation(fields: [companyId], references: [id])
  salesOrderId String
  salesOrder   SalesOrder @relation(fields: [salesOrderId], references: [id])
  // Free text — there is no Product catalog until Inventory is built.
  // A nullable productId FK gets added then; these lines stay valid.
  description  String
  quantity     Decimal    @db.Decimal(12, 2)
  unitPrice    Decimal    @db.Decimal(14, 2)
  // Explicit ordering — insertion order is not guaranteed by the DB and
  // line order is meaningful on a quote a customer reads.
  position     Int        @default(0)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

Plus back-relations on `Company` (`customers`, `customerContacts`, `leads`, `deals`, `salesOrders`, `salesOrderLines`) and on `Employee` (`ownedCustomers`, `ownedLeads`, `ownedDeals` — named relations, since `Employee` now has three separate FKs pointing at it from this module).

Matching RLS additions — all six tables use the simple non-nullable-`companyId` form (`Employee`/`Project`/`Task`'s pattern, **not** the nullable-`companyId` OR/`WITH CHECK` form `Holiday`/`PayrollRegionRule` need):

```sql
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Customer"
  USING ("companyId" = current_setting('app.current_company_id', true));

-- ...identical for "CustomerContact", "Lead", "Deal", "SalesOrder",
-- "SalesOrderLine".
```

Plus additions to existing (not new) files: `"sales"` added to `RBAC_MODULES` (`rbac.constants.ts`), and the manager/employee default grants from §3 added to `DEFAULT_ROLE_PERMISSIONS` (`default-role-permissions.ts`) — carrying the same **retroactive-seeding caveat** documented for `org`, `leave_types`, and `projects`: already-provisioned companies need their seed re-run to pick up new default rows.

---

## 6. Build order

Same granularity and standard as every prior module — each step run and verified against real infrastructure, pushed, and confirmed green on real CI before the next begins:

1. **Schema + migration + RLS.** The six models and four enums above, real migration with hand-added RLS statements, and `verify-rls.ts` extended to prove `Customer`/`Lead`/`Deal`/`SalesOrder` are genuinely isolated cross-tenant — including the **write**-under-RLS check and the maximal-permission cross-tenant probe that the Projects step-7 audit established as the strongest form of this proof.
2. **RBAC wiring.** `"sales"` into `RBAC_MODULES`, default grants from §3 into `DEFAULT_ROLE_PERMISSIONS`, `permission-check.service.spec.ts` extended. Explicitly includes proving `employee` gets **nothing** by default.
3. **Backend: Customer + CustomerContact CRUD.** Real e2e tests proving the deliberate asymmetry from §3 — wide read, owner-scoped write — plus the single-primary-contact rule.
4. **Backend: Lead CRUD + conversion.** Including the transactional convert operation, the 409 on double-conversion, and scope enforcement on both.
5. **Backend: Deal CRUD + stage transitions.** Owner-based `self`/`own_department`/`all` proven end-to-end, same three-tier e2e shape as Projects.
6. **Backend: SalesOrder + SalesOrderLine.** Reference generation, line management, scope inherited from the parent deal.
7. **Frontend UI.** Customer list/detail with contacts, lead list + convert flow, deal pipeline view, order/quote view — real-backend integration tests, fully localized en/ar/ku with RTL. Broken into its own reviewable sub-steps (proposed at that point, the way 6.0–6.5 were for Projects) rather than one large step.
8. **Full verification pass.** The same audit standard as Projects' step 7: RBAC boundaries proven over real HTTP for every role × entity, cross-tenant isolation proven independently of the permission layer, translation completeness and RTL genuinely rendered rather than assumed, and an honest inventory of what's solid versus any real gap found.

No step starts until the previous one is run and verified for real — same rule as everything built so far, no exception for a third module.

---

## Open questions — all three resolved before step 1

These were flagged as genuine either/ors rather than decided silently. **All three confirmed as recommended (2026-08-01):**

1. **`CustomerContact` as a separate model** — confirmed. Handles multiple contacts per customer without corrupting deal-per-customer counts.
2. **`Lead` separate from `Deal`, with an explicit conversion step** — confirmed. Keeps unqualified leads out of pipeline-value totals and avoids fabricating `Customer` records for people who never convert.
3. **Customer list readable company-wide by anyone with `sales:view`** — confirmed. The risk of two reps unknowingly working the same customer outweighs the cost of company-wide read visibility, and it is not a default `employee` grant regardless.

The no-new-role decision (§3) and the Accounting connection-point direction (§1) were confirmed at the same time.

---

*Status: confirmed. Step 1 (schema + migration + RLS) is complete — see `DECISIONS.md`. Steps 2–8 remain as written in §6.*
