import type { PrismaClient } from "@prisma/client";

export interface HolidaySeed {
  name: string;
  date: string; // YYYY-MM-DD
  recurring: boolean; // false = lunar-based / date shifts yearly, needs reseeding
}

/**
 * System-wide default holiday calendar (companyId: null) for 2026.
 *
 * Lunar-calendar holidays (Eid al-Fitr, Eid al-Adha, Islamic New Year) are
 * moon-sighting-based and only confirmed a day or two in advance by
 * religious authorities each year — the dates below are commonly published
 * estimates for 2026, not certainties, and can be off by a day depending on
 * the sighting. `recurring: false` on those flags them as needing yearly
 * reseeding/confirmation rather than being trusted long-term. This list is
 * a starting point, not a labor-law-reviewed calendar — confirm regional
 * accuracy (and any missing observances) with local HR/legal expertise
 * before relying on it for real payroll/attendance decisions.
 */
export const SYSTEM_HOLIDAYS_2026: HolidaySeed[] = [
  { name: "New Year's Day", date: "2026-01-01", recurring: true },
  { name: "Halabja Memorial Day", date: "2026-03-16", recurring: true },
  { name: "Newroz", date: "2026-03-21", recurring: true },
  // Eid al-Fitr: approximate, pending official moon-sighting confirmation.
  { name: "Eid al-Fitr (Day 1)", date: "2026-03-20", recurring: false },
  { name: "Eid al-Fitr (Day 2)", date: "2026-03-21", recurring: false },
  { name: "Eid al-Fitr (Day 3)", date: "2026-03-22", recurring: false },
  { name: "International Workers' Day", date: "2026-05-01", recurring: true },
  // Eid al-Adha: approximate, pending official moon-sighting confirmation.
  { name: "Eid al-Adha (Day 1)", date: "2026-05-27", recurring: false },
  { name: "Eid al-Adha (Day 2)", date: "2026-05-28", recurring: false },
  { name: "Eid al-Adha (Day 3)", date: "2026-05-29", recurring: false },
  // Islamic New Year: approximate, pending official moon-sighting confirmation.
  { name: "Islamic New Year", date: "2026-06-16", recurring: false },
  { name: "Iraq Republic Day", date: "2026-07-14", recurring: true },
  { name: "Iraq Independence Day", date: "2026-10-03", recurring: true },
  { name: "Kurdistan Flag Day", date: "2026-12-17", recurring: true },
];

/**
 * Replaces the system-wide (companyId: null) holiday calendar with the
 * list above. Company-specific override rows (companyId set) are left
 * untouched. Safe to re-run.
 */
export async function seedHolidays(prisma: PrismaClient): Promise<void> {
  await prisma.holiday.deleteMany({ where: { companyId: null } });
  await prisma.holiday.createMany({
    data: SYSTEM_HOLIDAYS_2026.map((holiday) => ({
      companyId: null,
      name: holiday.name,
      date: new Date(`${holiday.date}T00:00:00.000Z`),
      recurring: holiday.recurring,
    })),
  });
}
