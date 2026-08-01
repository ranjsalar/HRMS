"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

const MANAGER_ROLES = new Set(["manager", "company_admin"]);

interface NavLink {
  href: string;
  labelKey: string;
  managerOnly?: boolean;
  companyAdminOnly?: boolean;
  superadminOnly?: boolean;
}

const LINKS: NavLink[] = [
  { href: "/", labelKey: "nav.dashboard" },
  { href: "/leave", labelKey: "nav.leave" },
  { href: "/payslips", labelKey: "nav.payslips" },
  // No scope flag — visible to every role. GET /projects already resolves
  // the caller's own scope server-side (self/own_department/all), the
  // same "no client-side role gate, backend already scopes it" pattern
  // /leave and /payslips use.
  { href: "/projects", labelKey: "nav.projects" },
  { href: "/documents", labelKey: "nav.documents" },
  { href: "/profile", labelKey: "nav.profile" },
  { href: "/team", labelKey: "nav.team", managerOnly: true },
  { href: "/leave/approvals", labelKey: "nav.leaveApprovals", managerOnly: true },
  { href: "/org-chart", labelKey: "nav.orgChart", managerOnly: true },
  // company_admin only, deliberately NOT managerOnly — a manager keeps
  // their existing department-scoped Team view, this is not a wider
  // version of it. See DECISIONS.md, "Verification-pass item 2."
  { href: "/overview", labelKey: "nav.overview", companyAdminOnly: true },
  // The one link a superadmin session sees here — everything past it
  // (/superadmin/*) is deliberately English-only, unlike this shared nav
  // chrome itself. See DECISIONS.md, "Super Admin dashboard: frontend".
  { href: "/superadmin", labelKey: "nav.superadmin", superadminOnly: true },
];

/**
 * The shared header for every authenticated page (step 9.3+) — factored
 * out of what was previously duplicated inline on the dashboard page
 * alone. Manager/company_admin-only links are omitted entirely for a
 * plain employee, not just hidden — matching this app's existing
 * "structural, not a runtime check" preference (see AttendanceService,
 * DECISIONS.md step 6) applied to navigation instead of an API call.
 */
export function AppNav() {
  const { t, dir } = useTranslation();
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const isManager = user ? MANAGER_ROLES.has(user.role) : false;
  const isCompanyAdmin = user?.role === "company_admin";
  const isSuperadmin = user?.role === "superadmin";

  return (
    <header dir={dir} className="flex flex-col gap-3 border-b border-neutral-200 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl text-primary">{t("app.name")}</h1>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Button variant="secondary" onClick={() => void logout()}>
            {t("auth.logout")}
          </Button>
        </div>
      </div>
      <nav className="flex flex-wrap gap-2">
        {LINKS.filter(
          (link) =>
            (!link.managerOnly || isManager) &&
            (!link.companyAdminOnly || isCompanyAdmin) &&
            (!link.superadminOnly || isSuperadmin),
        ).map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 font-body text-sm ${
                active
                  ? "bg-primary text-white"
                  : "text-neutral-900 hover:bg-neutral-100"
              }`}
            >
              {t(link.labelKey)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
