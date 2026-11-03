import type { ReportFilters } from "@/lib/reports/definitions";

export function parseReportFilters(get: (k: string) => string | null | undefined): ReportFilters {
  const v = (k: string) => (get(k) || "").trim() || undefined;
  const m = v("month");
  return {
    month: m && /^\d{4}-\d{2}/.test(m) ? `${m.slice(0, 7)}-01` : undefined,
    year: v("year"), employee: v("employee"), branch: v("branch"), designation: v("designation"),
    payrollStatus: v("payroll_status"), emailStatus: v("email_status"), period: v("period"),
  };
}
