"use client";

import Link from "next/link";

/**
 * A "back" chevron that actually points the right direction in both
 * writing modes: authored pointing left (the LTR default), flipped 180°
 * in RTL via Tailwind's `rtl:` variant (keyed off `[dir="rtl"]` on an
 * ancestor — `<html dir>` in this app's case, set both server-side at
 * first paint and client-side on locale switch — see layout.tsx /
 * locale-context.tsx). Verified against real SSR output for ar/ku.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 font-body text-sm text-primary hover:underline"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 rtl:rotate-180">
        <path
          d="M12.5 15L7.5 10L12.5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  );
}
