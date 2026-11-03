import Link from "next/link";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar, type FilterDef } from "@/components/app/filter-bar";
import { requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REPORTS, getReport } from "@/lib/reports/definitions";
import { parseReportFilters } from "@/lib/reports/filters";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { employeeOptions } from "@/lib/options";
import { getSelectedMonth } from "@/lib/month";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports & Analytics" };
export const maxDuration = 120;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const available = REPORTS.filter((r) => r.roles.includes(profile.role) && r.key !== "payroll_register");
  const report = getReport(sp(params.report)) ?? available[0];
  const supabase = await createClient();
  const [branches, employees, selectedMonth] = await Promise.all([listBranches(supabase, true), listEmployeesLite(supabase, { activeOnly: false }), getSelectedMonth()]);
  const filters = parseReportFilters((k) => sp(params[k]));
  if (report.filters.includes("month") && !filters.month && !(report.filters.includes("year") && filters.year)) filters.month = selectedMonth;
  if (profile.role === "branch_manager") filters.branch = profile.branch_id ?? undefined;
  const rows = await report.load(supabase, filters);
  const qs = new URLSearchParams(Object.entries({ month: filters.month?.slice(0, 7), year: filters.year, employee: filters.employee, branch: profile.role === "branch_manager" ? undefined : filters.branch,
    designation: filters.designation, payroll_status: filters.payrollStatus, email_status: filters.emailStatus }).filter(([, v]) => v) as [string, string][]).toString();

  const defs: Record<string, FilterDef> = {
    month: { name: "month", label: "Month", type: "month", defaultValue: filters.month },
    year: { name: "year", label: "Year", type: "select", options: Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y })) },
    branch: { name: "branch", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) },
    employee: { name: "employee", label: "Employee", type: "select", options: employeeOptions(employees, branches) },
    designation: { name: "designation", label: "Designation", type: "text", placeholder: "e.g. Cashier" },
    payrollStatus: { name: "payroll_status", label: "Payroll status", type: "select", options: ["draft", "pending_approval", "approved", "finalized"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
    emailStatus: { name: "email_status", label: "Email status", type: "select", options: ["queued", "sent", "delivered", "failed", "bounced"].map((s) => ({ value: s, label: s })) },
  };
  const active = report.filters.filter((f) => f !== "period" && !(f === "branch" && profile.role === "branch_manager")).map((f) => defs[f]).filter(Boolean);

  return (
    <>
      <PageHeader title="Reports & Analytics" description="Every report reads live payroll data and exports to Excel, CSV or PDF." />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-2 shadow-card lg:flex-col">
          {available.map((r) => (
            <Link key={r.key} href={`/reports?report=${r.key}`} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm", r.key === report.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {r.title}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <Section title={report.title} description={report.description} actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild><a href={`/api/reports/${report.key}?format=xlsx&${qs}`}><FileSpreadsheet /> Excel</a></Button>
              <Button size="sm" variant="outline" asChild><a href={`/api/reports/${report.key}?format=csv&${qs}`}><FileDown /> CSV</a></Button>
              <Button size="sm" variant="outline" asChild><a href={`/api/reports/${report.key}?format=pdf&${qs}`}><FileText /> PDF</a></Button>
            </div>
          }>
            <div className="border-b border-border px-4 py-3"><FilterBar filters={active} /></div>
            {!rows.length ? <EmptyState title="No data for these filters" /> : (
              <Table className="text-[13px]">
                <THead><TR>{report.columns.map((c) => <TH key={c.key} className={c.type === "money" || c.type === "number" ? "text-right" : undefined}>{c.label}</TH>)}</TR></THead>
                <TBody>
                  {rows.slice(0, 300).map((r, i) => (
                    <TR key={i}>
                      {report.columns.map((c) => {
                        const v = r[c.key];
                        return <TD key={c.key} className={c.type === "money" || c.type === "number" ? "num" : undefined}>{c.type === "money" ? formatAmount(v as string) : c.type === "date" ? (v ? String(v).slice(0, 10) : "—") : String(v ?? "—")}</TD>;
                      })}
                    </TR>
                  ))}
                </TBody>
                {report.columns.some((c) => c.type === "money") && (
                  <TFoot><TR>{report.columns.map((c, i) => <TD key={c.key} className={c.type === "money" ? "num" : undefined}>{i === 0 ? `Total (${rows.length})` : c.type === "money" ? formatAmount(rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0)) : ""}</TD>)}</TR></TFoot>
                )}
              </Table>
            )}
            {rows.length > 300 && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Showing the first 300 of {rows.length} rows. Exports include every row.</p>}
          </Section>
        </div>
      </div>
    </>
  );
}
