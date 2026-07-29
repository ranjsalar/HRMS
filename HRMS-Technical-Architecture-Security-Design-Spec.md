# HRMS Platform — Full Technical, Security & Design Specification
*Self-contained handoff document. A solo developer is building a multi-tenant SaaS HR platform for companies in Kurdistan and Iraq (Slemani, Erbil, and other cities), to compete with ZenHR. This document is meant to be given to a fresh Claude/Claude Code session as complete context — read it in full before writing any code.*

---

## 0. Project Context (read first)

- **What it is:** Multi-tenant HR/payroll SaaS. One developer builds it; many companies subscribe to it.
- **Roles:** Super Admin (the developer/owner, controls all companies) → Company Admin (one per client company, controls only their own company) → Manager (their team only) → Employee (self only).
- **Tenancy:** Every company is fully data-isolated ("zone"). Companies can be suspended/archived (not hard-deleted) when they stop paying, so data is recoverable.
- **Build order:** Web app first (full feature set). Mobile (iOS + Android) comes after, and must feel faster/smoother/more polished than the web version, not a rushed port.
- **Languages:** Arabic, English, Kurdish Sorani — full translation of every string, not partial. Arabic and Sorani are RTL; English is LTR. The UI must flip direction correctly per language, not just translate text.
- **Non-negotiables from the founder:** high security, strict per-department/per-role access control, clean architecture, no crashes, no lag, smooth animations, a distinctive professional design (not a generic AI-template look), full trilingual support.

---

## 1. Security Architecture

Security is treated as a first-class module, not an afterthought bolted on later. Layers, outside-in:

### 1.1 Network & transport layer
- HTTPS everywhere, TLS 1.2+ only, HSTS enabled.
- All API endpoints behind a reverse proxy (Nginx/Caddy) with rate limiting at the proxy layer, before requests even reach the app.
- CORS locked to known frontend origins only — never `*` in production.

### 1.2 Authentication
- Password hashing: **argon2id** (not bcrypt/md5) — resistant to GPU cracking.
- JWT access tokens (short-lived, 15 min) + refresh tokens (longer-lived, stored httpOnly + secure + sameSite cookies, never in localStorage — localStorage is vulnerable to XSS token theft).
- **2FA (TOTP)** mandatory for Super Admin and Company Admin roles; optional but encouraged for Manager/Employee.
- Account lockout after repeated failed login attempts (exponential backoff), to block brute-force attacks.
- Password reset via short-lived signed tokens sent by email, never by exposing user existence (don't reveal "email not found" — say "if this email exists, a reset link was sent").

### 1.3 Authorization (this is your "each department has their own job, not messy" requirement)
- **Role-Based Access Control (RBAC)** at two levels:
  1. **Coarse role** — Super Admin / Company Admin / Manager / Employee.
  2. **Fine-grained permissions per module** — e.g. a Company Admin can grant a specific HR staff member "payroll: view only" without full admin rights, or a department head "leave: approve for their department only." Model this as a `permissions` table (`role_id`, `module`, `action` [view/create/edit/delete/approve]) rather than hardcoding role checks in business logic — this is what keeps it "not messy" as you add more roles later.
- **Every API endpoint** checks: (1) is this user authenticated, (2) does their role have this permission, (3) does the requested resource belong to their `company_id`. All three checks happen in a guard/middleware layer, never left to individual controller logic to remember.
- **Department-scoped access:** a Manager's queries are automatically filtered to employees where `department_id` is in their managed departments — enforced at the query layer (repository pattern), not just hidden in the UI. Hiding a button in the UI is not security; the API must reject the request even if someone calls it directly.

### 1.4 Data isolation (multi-tenant security)
- Every tenant-owned table carries `company_id`.
- **Postgres Row-Level Security (RLS) policies** enforce that a database connection scoped to Company A can never read/write Company B's rows — even if there's a bug in application code that forgets a `WHERE company_id = ...` clause. This is your real safety net against cross-tenant data leaks, which would be a catastrophic trust failure for a multi-company SaaS.

### 1.5 Application-layer hardening (OWASP-aligned)
- Input validation on every endpoint (schema validation library, e.g. Zod/class-validator) — reject malformed input before it touches business logic.
- Parameterized queries only (ORM handles this) — never string-concatenated SQL, to eliminate SQL injection.
- Output encoding on the frontend to prevent stored XSS (React/Next.js does this by default if you avoid `dangerouslySetInnerHTML`).
- File upload validation: check MIME type + magic bytes (not just file extension) for document uploads (contracts, IDs, certificates); scan for malware if budget allows; store outside the web root, serve via signed, expiring URLs — never a public static path.
- CSRF protection on state-changing requests (SameSite cookies + CSRF tokens for cookie-based sessions).
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
- Dependency scanning (`npm audit` / Dependabot/Snyk) as part of your build process — outdated packages are one of the most common real-world breach vectors.

### 1.6 Data protection
- Encryption at rest for the database (most managed Postgres providers offer this by default — enable it).
- Encryption in transit everywhere (TLS, no exceptions, including internal service-to-service calls if you split services later).
- Sensitive fields (national ID numbers, bank account details for payroll) — consider column-level encryption in addition to disk-level, since these are high-value targets.
- **Audit log** on every sensitive action: who did what, to which record, when — required for labor-law disputes and for detecting misuse by a Company Admin themselves.

### 1.7 Mobile-specific hardening (for later phase, plan for it now)
- Never store raw JWTs in plaintext storage — use Keychain (iOS) / Keystore (Android) via a secure-storage library.
- Certificate pinning to prevent man-in-the-middle interception on public wifi (common risk in cafés/offices with shared networks).
- Root/jailbreak detection as a soft warning (not necessarily a hard block, to avoid false positives) for high-privilege accounts.
- Obfuscate/minify release builds; never ship API keys or secrets inside the mobile bundle — all secrets stay server-side.

---

## 2. System Architecture

### 2.1 Overall approach: modular monolith (not microservices)

For a solo developer, microservices add operational overhead (multiple deployments, service discovery, distributed tracing) with no real benefit at your current scale. Instead:

- **One backend codebase**, internally organized into clearly separated modules (Auth, Employees, Attendance, Leave, Payroll, Documents, Notifications, Audit) — each module owns its own service/repository layer and does not reach directly into another module's database tables.
- This gives you clean boundaries now, and an actual path to splitting into microservices later (e.g., pulling Payroll into its own service once it needs independent scaling) without a full rewrite, because the boundaries already exist in code.

### 2.2 Suggested folder structure

```
/apps
  /api                    # NestJS backend
    /src
      /modules
        /auth
        /companies
        /employees
        /attendance
        /leave
        /payroll
        /documents
        /notifications
        /audit
      /common              # guards, decorators, RBAC middleware, RLS helpers
      /i18n                # backend-side translated strings (emails, PDFs)
  /web                     # Next.js frontend
    /src
      /app                 # routes
      /components
      /features            # feature-scoped components matching backend modules
      /locales             # en.json, ar.json, ku.json
      /styles
  /mobile                  # React Native (Expo) — built in Phase 3
/packages
  /shared                  # shared TypeScript types, validation schemas, i18n keys
```

### 2.3 Data flow (request lifecycle)

```
[Web/Mobile Client]
     │  HTTPS request + JWT access token
     ▼
[Reverse Proxy: rate limit, TLS termination]
     ▼
[API Gateway layer: auth guard → RBAC guard → tenant-scope guard]
     ▼
[Module Controller] → validates input schema
     ▼
[Module Service] → business logic (e.g. leave balance calculation)
     ▼
[Repository layer] → tenant-scoped query (company_id filter + RLS enforced at DB)
     ▼
[PostgreSQL] ←→ [Redis: cache + session + job queue]
     ▼
[Background workers (BullMQ)] → payslip PDF generation, email/push notifications, scheduled leave-balance recalculation
     ▼
Response → Controller → Client (only fields the user's role is permitted to see, filtered server-side)
```

Key principle: **the frontend never decides what a user can see** — it just renders what the API returns. All authorization decisions happen server-side. The frontend hiding a button is a UX nicety, not a security boundary.

### 2.4 Performance & reliability (no lag, no crashes)

- **Pagination everywhere** — never return unbounded lists (e.g. "all employees") in one response; cursor or offset pagination on every list endpoint.
- **Avoid N+1 queries** — use ORM eager-loading (`include`/`with`) deliberately; audit slow queries with `EXPLAIN ANALYZE` during development, not after launch.
- **Redis caching** for expensive/frequently-read data (org chart, leave balances, dashboard aggregates) with sensible invalidation on writes.
- **Background jobs for anything slow** — payslip PDF generation, bulk CSV employee import, and report generation must never block the request/response cycle; they run async with a job status the frontend polls or gets notified about.
- **Optimistic UI updates on the frontend** (update UI immediately, roll back on error) for actions like leave approval — this is what makes an app feel instant rather than laggy.
- **Image/asset optimization**: Next.js built-in image optimization, lazy-load below-the-fold content, compress uploaded documents (PDF/image) server-side before storage.
- **Error boundaries** on the frontend (React error boundaries) so one broken component shows a fallback, not a full app crash.
- **Health checks + monitoring** from day one (e.g. Sentry for error tracking, simple uptime monitoring) — you need to know about a crash before your customer tells you about it.
- **Automated backups** of the database (daily minimum, with tested restore process) — for HR/payroll data, losing data is not an acceptable failure mode.

---

## 3. Design System

Per the founder's brief: this needs a distinctive, professional identity — not a generic AI-template look (avoid the common defaults: cream-background-with-serif-and-terracotta, near-black-with-neon-accent, or newspaper-style hairline layouts). The subject here is **trust, precision, and regional identity** — an HR system a traditional business owner in Slemani or Erbil looks at and feels is serious, modern, and made for them specifically.

### 3.1 Color palette (named tokens)

| Token | Hex | Use |
|---|---|---|
| `--color-primary` (Deep Teal) | `#0F5257` | Primary brand color — headers, primary buttons, active states. Evokes trust and stability without being a generic corporate blue. |
| `--color-primary-dark` | `#0A3A3D` | Hover/pressed states, dark mode surfaces |
| `--color-accent` (Warm Amber) | `#E0A458` | Call-to-action highlights, notifications, badges — a warm accent referencing the region's warm-toned textiles/architecture without being literal or clichéd |
| `--color-success` | `#3E8E5A` | Approved leave, successful payroll run |
| `--color-warning` | `#D68A3C` | Pending approvals, expiring documents |
| `--color-danger` | `#B3452C` | Rejections, errors, destructive actions |
| `--color-neutral-900` | `#1B2426` | Primary text |
| `--color-neutral-100` | `#F5F3EF` | App background (soft warm off-white, not stark white — easier on the eyes for a dashboard used all day) |
| `--color-neutral-300` | `#D9D4C8` | Borders, dividers |

This palette avoids both the "cream + terracotta" AI-default and the "near-black + neon" AI-default, while still feeling warm and regionally appropriate rather than a cold corporate blue-and-white template.

### 3.2 Typography

- **Latin (English) UI:** Display/headings — **Manrope** (geometric, modern, highly legible at small sizes for dashboards). Body — **Inter** (excellent readability for data-dense tables).
- **Arabic:** **IBM Plex Sans Arabic** or **Cairo** — both have well-designed, modern Arabic glyph sets that pair cleanly with Manrope/Inter's proportions, avoiding the mismatched-weight look you get from bolting a generic Arabic font onto a Latin design.
- **Kurdish Sorani:** Uses Arabic script — same font family as Arabic (Cairo/IBM Plex Sans Arabic) generally covers Sorani's character set correctly, but this must be verified against the specific Sorani orthography (extra characters like région-specific letters) during implementation — don't assume 100% glyph coverage without checking.
- **Data/tables/numeric:** a monospaced or tabular-figure font variant for payroll numbers so columns of numbers align cleanly — misaligned decimal points in a payroll table looks unprofessional and erodes trust fast.

### 3.3 RTL/LTR handling (critical, and easy to get wrong)

- Use **CSS logical properties** (`margin-inline-start`, not `margin-left`) throughout, so the entire layout mirrors automatically when `dir="rtl"` is set — retrofitting this after building LTR-only is a large, painful rework.
- Store the `dir` attribute on `<html>` dynamically based on selected language (`ar`/`ku` → `rtl`, `en` → `ltr`).
- Icons that imply direction (back arrows, chevrons) must flip in RTL mode — don't hardcode a left-pointing arrow as "back."
- Test every screen in all three languages during development, not just at the end — RTL bugs (overlapping text, misaligned tables, broken forms) are far cheaper to fix as you build than after 50 screens exist.
- Numbers: decide whether to show Eastern Arabic numerals (٠١٢٣) or Western numerals (0123) in Arabic/Sorani mode — most modern business software in the region uses Western numerals for data/payroll even in Arabic UI, but confirm with your pilot customers.

### 3.4 Motion & polish

- Deliberate, not decorative: page transitions, a satisfying check-mark animation on "leave approved," a subtle skeleton-loading state instead of a blank screen while data loads — these small touches are what separate "feels smooth" from "feels laggy," even when actual load times are similar.
- Respect `prefers-reduced-motion` for accessibility.
- Loading states everywhere — never a frozen button with no feedback after a click; every async action gets an immediate visual response (spinner, disabled state, optimistic update).

### 3.5 Signature element

One distinctive, memorable design element tying the brand together: a subtle **geometric pattern motif** (inspired by traditional Kurdish/Mesopotamian textile and tilework geometric patterns, abstracted into a simple line-art pattern) used sparingly — e.g. as a login-page background accent, an empty-state illustration base, or a subtle watermark on generated PDFs (payslips/certificates). This gives the brand a distinctive regional identity without being a literal or clichéd cultural reference, and it's the one place you "spend your boldness" while keeping the rest of the UI clean and disciplined.

---

## 4. Internationalization (i18n) Strategy

- All UI strings live in structured JSON translation files from the very first screen built — never hardcode English text inline "to translate later." That approach always leaves gaps.
- Structure: `/packages/shared/locales/en.json`, `ar.json`, `ku.json` with matching keys, e.g.:
  ```json
  { "leave.request.submit": "Submit Request" }
  ```
- Backend-generated content also needs translation: emails, push notification text, and PDF payslips/certificates must render in the employee's selected language, not just the UI chrome.
- Date/number/currency formatting is locale-aware (`Intl.NumberFormat`, `Intl.DateTimeFormat`) rather than manually formatted strings, so IQD/USD and Gregorian dates display correctly per locale.
- Language is a **per-user setting**, not a per-company setting — different employees in the same company may prefer different languages.
- Plan translation review with native Sorani speakers before launch — machine-translated Sorani in professional software reads poorly to native speakers and undermines the "built for us" positioning that's your competitive edge.

---

## 5. Build Order (confirmed: web first, mobile later)

1. **Web app, full MVP feature set** (see the Project Plan document for module scope) — get this in front of real pilot companies first.
2. **Mobile app (React Native/Expo)** only after the web app is validated with paying/pilot customers and the API is stable — building mobile against a shifting API wastes effort. Mobile should feel distinctly polished: native-feeling navigation, smooth animations, offline-tolerant clock-in (queue actions locally, sync when back online), not a webview wrapper.

---

## 6. Summary Checklist for Implementation

- [ ] RLS-enforced multi-tenant Postgres schema with `company_id` on every tenant table
- [ ] JWT + refresh token auth, argon2id hashing, mandatory 2FA for admin roles
- [ ] Fine-grained RBAC permission table (role × module × action), enforced server-side only
- [ ] Modular monolith backend (NestJS), one module per HR domain
- [ ] Redis caching + BullMQ background jobs for anything slow (PDFs, bulk imports, reports)
- [ ] Full i18n from day one: en/ar/ku, RTL-aware CSS logical properties, locale-aware dates/numbers
- [ ] Design tokens as specified in section 3 — deep teal + warm amber palette, Manrope/Inter + Cairo/IBM Plex Sans Arabic typography
- [ ] Audit logging on every sensitive action
- [ ] Automated backups + error monitoring (Sentry) + uptime checks before real customers onboard
- [ ] Web app fully built and pilot-tested before starting the mobile app

---

*Companion document: `HRMS-Project-Plan.md` (module scope, phased roadmap, multi-tenant admin model, attendance/geofencing decisions). Read both together for full context.*
