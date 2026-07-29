import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@/styles/globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import { LOCALE_COOKIE, LOCALE_DIR, resolveLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "HRMS",
  description: "HR & Payroll platform for Kurdistan & Iraq",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read server-side, before any HTML is sent, so the correct dir/lang is
  // present on the very first byte — no LTR-then-flip-to-RTL flash on
  // load. The client-side LocaleProvider below is seeded with this same
  // value and takes over from there.
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]}>
      <body>
        <AuthProvider>
          <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
