import { apiFetch } from "@/lib/api-client";

export interface HolidayDto {
  id: string;
  name: string;
  date: string;
  companyId: string | null;
}

export function fetchUpcomingHolidays(limit?: number): Promise<HolidayDto[]> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  return apiFetch<HolidayDto[]>(`/holidays/upcoming${query}`);
}
