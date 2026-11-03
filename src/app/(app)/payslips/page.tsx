import { Cog, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { ActionButton } from "@/components/app/action-button";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, sp } from "@/lib/queries";
import { formatMonth } from "@/lib/format";
import { runJobsNow } from "../payroll/actions";
import { PayslipTable, type PayslipRow } from "./table";

export const metadata = { title: "Payslips" };
export const maxDuration = 120;

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(ADMIN_ROLES);
  const params = await searchParams;
  const supabase = await createClient();
  const [branches, month] = await Promise.all([listBranches(supabase), resolveMonth(params.month)]);
  let q = supabase.from("payslips")
    .select("id, reference_number, payroll_month, status, generated_at, error_message, employee_id, payroll_records!inner(id, payroll_period_id, employee_name, employee_code, branch_id, branch_name, net_salary), employees(email), email_notifications(email_status, created_at, is_manual_resend)")
    .eq("payroll_month", month).order("reference_number").limit(3000);
  if (sp(params.branch)) q = q.eq("payroll_records.branch_id", sp(params.branch));
  if (sp(params.status)) q = q.eq("status", sp(params.status));
  const { data } = await q;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let rows: PayslipRow[] = ((data ?? []) as any[]).map((p) => {
    const latest = [...(p.email_notifications ?? [])].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: p.id, reference_number: p.reference_number, payroll_month: p.payroll_month, status: p.status, generated_at: p.generated_at, error_message: p.error_message,
      employee_id: p.employee_id, employee_name: p.payroll_records.employee_name, employee_code: p.payroll_records.employee_code, branch_name: p.payroll_records.branch_name,
      net_salary: p.payroll_records.net_salary, email: p.employees?.email ?? null, email_status: latest?.email_status ?? null, email_at: latest?.created_at ?? null,
      record_id: p.payroll_records.id, period_id: p.payroll_records.payroll_period_id,
    };
  });
  const q2 = sp(params.q).toLowerCase();
  if (q2) rows = rows.filter((r) => `${r.employee_name} ${r.employee_code} ${r.reference_number}`.toLowerCase().includes(q2));
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Payslips" description="PDF payslips are generated automatically for finalized payroll and stored in private storage. Downloads use short-lived signed links."
        actions={<>
          <ActionButton variant="outline" action={runJobsNow}><Cog /> Process pending now</ActionButton>
          <Button asChild disabled={!count("generated")}><a href={`/api/payslips/bulk?month=${month.slice(0, 7)}${sp(params.branch) ? `&branch=${sp(params.branch)}` : ""}`}><Download /> Bulk download ({count("generated")})</a></Button>
        </>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Generated" value={count("generated")} tone="success" />
        <StatCard label="Pending generation" value={count("pending")} hint="processed by the background worker" />
        <StatCard label="Failed" value={count("failed")} tone={count("failed") ? "danger" : "default"} hint="retried automatically up to 5 times" />
      </div>
      <Section title={`Payslips · ${formatMonth(month)}`} actions={<FilterBar filters={[
        { name: "month", label: "Month", type: "month", defaultValue: month },
        { name: "branch", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) },
        { name: "status", label: "Status", type: "select", options: [{ value: "generated", label: "Generated" }, { value: "pending", label: "Pending" }, { value: "failed", label: "Failed" }] },
        { name: "q", label: "Search", type: "text", placeholder: "Name, ID or reference" },
      ]} />}>
        {!rows.length ? <EmptyState title="No payslips for this month" description="Payslips appear here once payroll is finalized." /> : <PayslipTable rows={rows} />}
      </Section>
    </>
  );
}
