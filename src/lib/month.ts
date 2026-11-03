import "server-only";
import { cookies } from "next/headers";
import { currentMonthStart } from "@/lib/format";

export const MONTH_COOKIE = "payroll_month";

/** The month selected in the top bar (cookie), defaulting to the current month. */
export async function getSelectedMonth(): Promise<string> {
  const c = (await cookies()).get(MONTH_COOKIE)?.value;
  return c && /^\d{4}-\d{2}-01$/.test(c) ? c : currentMonthStart();
}

/** A `?month=YYYY-MM` search param wins over the cookie. */
export async function resolveMonth(param: string | string[] | undefined): Promise<string> {
  const v = Array.isArray(param) ? param[0] : param;
  if (v && /^\d{4}-\d{2}(-01)?$/.test(v)) return `${v.slice(0, 7)}-01`;
  return getSelectedMonth();
}
