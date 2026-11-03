import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { BarChartCard, DonutChartCard, LineChartCard } from "@/components/app/charts";
import { StatusBadge } from "@/components/app/status-badge";
import { requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, sp } from "@/lib/queries";
import { addMonths, formatAmount, formatDate, formatDateTime, formatMonth, monthEnd, titleCase } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
const shortMonth = (m: string) => new Date(m + "T00:00:00Z").toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const month = await resolveMonth(params.month);
  const isAdmin = profile.role !== "branch_manager";
  const branchId = isAdmin ? sp(params.branch) : profile.branch_id ?? "";
  const supabase = await createClient();
  const branches = await listBranches(supabase, true);
  const from = addMonths(month, -11);

  const empQ = supabase.from("employees").select("id, employment_status", { count: "exact", head: false });
  const [emps, summary, commissions, periods, failedEmails, recentEmployees, salaryUpdates, attendanceChanges, recentEmails, attendanceMonth] = await Promise.all([
    branchId ? empQ.eq("branch_id", branchId) : empQ,
    isAdmin
      ? (branchId ? supabase.from("v_payroll_monthly_branch").select("*").gte("payroll_month", from).lte("payroll_month", month).eq("branch_id", branchId)
                  : supabase.from("v_payroll_monthly_branch").select("*").gte("payroll_month", from).lte("payroll_month", month))
      : Promise.resolve({ data: [] }),
    (branchId ? supabase.from("v_commission_monthly").select("*").eq("payroll_month", month).eq("branch_id", branchId)
              : supabase.from("v_commission_monthly").select("*").eq("payroll_month", month)),
    isAdmin ? supabase.from("payroll_periods").select("id, payroll_month, status, branch_id, finalized_at, created_at").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    isAdmin ? supabase.from("email_notifications").select("id", { count: "exact", head: true }).in("email_status", ["failed", "bounced"]) : Promise.resolve({ count: 0 }),
    (branchId ? supabase.from("employees").select("id, employee_code, full_name, designation, created_at").eq("branch_id", branchId)
              : supabase.from("employees").select("id, employee_code, full_name, designation, created_at")).order("created_at", { ascending: false }).limit(5),
    isAdmin ? supabase.from("salary_structure_history").select("id, employee_id, action, changed_at, new_values, employees(full_name, employee_code)").order("changed_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    (branchId ? supabase.from("attendance").select("id, work_date, status, updated_at, employees(full_name)").eq("branch_id", branchId)
              : supabase.from("attendance").select("id, work_date, status, updated_at, employees(full_name)")).order("updated_at", { ascending: false }).limit(5),
    isAdmin ? supabase.from("email_notifications").select("id, recipient_email, email_status, created_at, failure_reason, employees(full_name)").order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
    (branchId ? supabase.from("v_attendance_monthly").select("*").eq("month", month).eq("branch_id", branchId)
              : supabase.from("v_attendance_monthly").select("*").eq("month", month)),
  ]);

  const employeeRows = (emps.data ?? []) as { employment_status: string }[];
  const rows = (summary.data ?? []) as Record<string, string>[];
  const current = rows.filter((r) => r.payroll_month === month);
  const byMonth = new Map<string, Record<string, number>>();
  for (let i = 0; i < 12; i++) byMonth.set(addMonths(from, i), {});
  for (const r of rows) {
    const m = byMonth.get(r.payroll_month) ?? {};
    for (const k of ["total_earnings", "total_deductions", "net_salary", "employee_epf", "employer_epf", "employees"]) m[k] = (m[k] ?? 0) + Number(r[k] ?? 0);
    byMonth.set(r.payroll_month, m);
  }
  const trend = [...byMonth.entries()].map(([m, v]) => ({ month: shortMonth(m), ...v }));
  const branchSeries = current.map((r) => ({ branch: r.branch_name, total_earnings: Number(r.total_earnings), net_salary: Number(r.net_salary) }));
  const commissionData = Object.entries(
    ((commissions.data ?? []) as { commission_type: string; amount: string; status: string }[])
      .filter((c) => c.status !== "cancelled")
      .reduce<Record<string, number>>((acc, c) => ({ ...acc, [titleCase(c.commission_type)]: (acc[titleCase(c.commission_type)] ?? 0) + Number(c.amount) }), {}),
  ).map(([name, value]) => ({ name, value }));
  const pendingPeriods = ((periods.data ?? []) as { status: string }[]).filter((p) => p.status !== "finalized").length;
  const att = (attendanceMonth.data ?? []) as Record<string, number>[];
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? "—" : "All branches");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatMonth(month)} · ${branchId ? branchName(branchId) : "All branches"}`}
        actions={
          <FilterBar
            filters={[
              { name: "month", label: "Month", type: "month" },
              ...(isAdmin ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
            ]}
          />
        }
      />

      {isAdmin ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Total Employees" value={employeeRows.length} />
          <StatCard label="Active Employees" value={employeeRows.filter((e) => e.employment_status === "active").length} />
          <StatCard label="Total Basic Salary" value={formatAmount(sum(current, "basic_salary"))} hint="LKR" />
          <StatCard label="Performance Incentives" value={formatAmount(sum(current, "performance_incentive"))} hint="LKR" />
          <StatCard label="Additional Earnings" value={formatAmount(sum(current, "additional_earnings"))} hint="LKR · working pay + commissions + other" />
          <StatCard label="Total Monthly Deductions" value={formatAmount(sum(current, "total_deductions"))} hint="LKR" />
          <StatCard label="Net Salary Payable" value={formatAmount(sum(current, "net_salary"))} hint="LKR" tone="success" />
          <StatCard label="Employee EPF (8%)" value={formatAmount(sum(current, "employee_epf"))} hint="LKR" />
          <StatCard label="Pending Payrolls" value={pendingPeriods} tone={pendingPeriods ? "warning" : "default"} hint="not yet finalized" />
          <StatCard label="Failed Payslip Emails" value={failedEmails.count ?? 0} tone={(failedEmails.count ?? 0) > 0 ? "danger" : "default"} hint={<Link className="text-primary hover:underline" href="/emails?status=failed">Review</Link>} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Branch Employees" value={employeeRows.length} />
          <StatCard label="Active Employees" value={employeeRows.filter((e) => e.employment_status === "active").length} />
          <StatCard label="Late Arrivals (month)" value={att.reduce((s, r) => s + Number(r.late_count), 0)} tone="warning" />
          <StatCard label="No-Pay / Absent Days" value={att.reduce((s, r) => s + Number(r.no_pay_leave) + Number(r.absent), 0)} />
        </div>
      )}

      {isAdmin && (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <Section title="Monthly Payroll Expenses" description="Total earnings, last 12 months">
            <div className="p-4"><BarChartCard data={trend} x="month" series={[{ key: "total_earnings", label: "Total earnings" }]} /></div>
          </Section>
          <Section title="Branch-wise Payroll Expenses" description={formatMonth(month)}>
            <div className="p-4"><BarChartCard data={branchSeries} x="branch" series={[{ key: "total_earnings", label: "Total earnings" }, { key: "net_salary", label: "Net salary" }]} /></div>
          </Section>
          <Section title="Earnings vs Deductions" description="Last 12 months">
            <div className="p-4"><BarChartCard data={trend} x="month" series={[{ key: "total_earnings", label: "Earnings" }, { key: "total_deductions", label: "Deductions", color: "#c2362b" }]} /></div>
          </Section>
          <Section title="Monthly Employee Distribution" description="Employees on payroll per month">
            <div className="p-4"><BarChartCard data={trend} x="month" money={false} series={[{ key: "employees", label: "Employees", color: "#0e7490" }]} /></div>
          </Section>
          <Section title="Commission Breakdown" description={formatMonth(month)}>
            <div className="p-4"><DonutChartCard data={commissionData} /></div>
          </Section>
          <Section title="Monthly EPF Contributions" description="Employee 8% and employer share">
            <div className="p-4"><BarChartCard data={trend} x="month" stacked series={[{ key: "employee_epf", label: "Employee EPF" }, { key: "employer_epf", label: "Employer EPF", color: "#7c3aed" }]} /></div>
          </Section>
          <Section title="Monthly Net Salary Trend" className="xl:col-span-2">
            <div className="p-4"><LineChartCard data={trend} x="month" series={[{ key: "net_salary", label: "Net salary", color: "#17804a" }]} /></div>
          </Section>
        </div>
      )}
      {!isAdmin && (
        <div className="mt-6">
          <Section title="Commission Breakdown" description={formatMonth(month)}>
            <div className="p-4"><DonutChartCard data={commissionData} /></div>
          </Section>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-[15px] font-semibold">Recent activity</h2>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ActivityList title="Recently registered employees" items={((recentEmployees.data ?? []) as { id: string; full_name: string; employee_code: string; designation: string; created_at: string }[]).map((e) => ({
          key: e.id, href: `/employees/${e.id}`, primary: e.full_name, secondary: `${e.employee_code} · ${e.designation}`, meta: formatDate(e.created_at),
        }))} />
        {isAdmin && <ActivityList title="Salary structure updates" items={((salaryUpdates.data ?? []) as unknown as { id: string; employee_id: string; action: string; changed_at: string; new_values: { basic_salary?: string; effective_from?: string } | null; employees: { full_name: string } | null }[]).map((h) => ({
          key: h.id, href: `/employees/${h.employee_id}?tab=salary`, primary: h.employees?.full_name ?? "Employee",
          secondary: `${titleCase(h.action)} · basic ${formatAmount(h.new_values?.basic_salary)} from ${formatDate(h.new_values?.effective_from)}`, meta: formatDateTime(h.changed_at),
        }))} />}
        <ActivityList title="Recent attendance changes" items={((attendanceChanges.data ?? []) as unknown as { id: string; work_date: string; status: string; updated_at: string; employees: { full_name: string } | null }[]).map((a) => ({
          key: a.id, href: `/attendance?date=${a.work_date}`, primary: a.employees?.full_name ?? "Employee", secondary: `${formatDate(a.work_date)} · ${titleCase(a.status)}`, meta: formatDateTime(a.updated_at),
        }))} />
        {isAdmin && <ActivityList title="Payroll processing" items={((periods.data ?? []) as { id: string; payroll_month: string; status: string; branch_id: string | null; created_at: string; finalized_at: string | null }[]).slice(0, 6).map((p) => ({
          key: p.id, href: `/payroll/${p.id}`, primary: `${formatMonth(p.payroll_month)} — ${branchName(p.branch_id)}`,
          secondary: <StatusBadge status={p.status} />, meta: p.finalized_at ? `Finalized ${formatDate(p.finalized_at)}` : formatDate(p.created_at),
        }))} />}
        {isAdmin && <ActivityList title="Recent payslip emails" items={((recentEmails.data ?? []) as unknown as { id: string; recipient_email: string; email_status: string; created_at: string; failure_reason: string | null; employees: { full_name: string } | null }[]).map((n) => ({
          key: n.id, href: `/emails?q=${encodeURIComponent(n.recipient_email)}`, primary: n.employees?.full_name ?? n.recipient_email,
          secondary: <span className="flex items-center gap-2"><StatusBadge status={n.email_status} />{n.failure_reason && <span className="flex items-center gap-1 truncate text-destructive"><AlertTriangle className="h-3 w-3" />{n.failure_reason}</span>}</span>,
          meta: formatDateTime(n.created_at),
        }))} />}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Figures include draft and finalized payroll for {formatMonth(month)} up to {formatDate(monthEnd(month))}. All values are read live from the database.</p>
    </>
  );
}

function ActivityList({ title, items }: { title: string; items: { key: string; href: string; primary: string; secondary: React.ReactNode; meta: string }[] }) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-start gap-3 px-5 py-2.5 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.primary}</div>
                  <div className="truncate text-xs text-muted-foreground">{i.secondary}</div>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">{i.meta}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
