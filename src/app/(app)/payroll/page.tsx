import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSelectedMonth } from "@/lib/month";
import { listBranches, sp } from "@/lib/queries";
import { formatAmount, formatDateTime, formatMonth } from "@/lib/format";
import { RunPayrollDialog } from "./run-payroll-dialog";

export const metadata = { title: "Payroll Management" };
export const maxDuration = 300;

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(ADMIN_ROLES);
  const params = await searchParams;
  const supabase = await createClient();
  const [branches, month] = await Promise.all([listBranches(supabase), getSelectedMonth()]);
  let q = supabase.from("payroll_periods").select("*, branches(name)").order("payroll_month", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (sp(params.status)) q = q.eq("status", sp(params.status));
  if (sp(params.year)) q = q.gte("payroll_month", `${sp(params.year)}-01-01`).lte("payroll_month", `${sp(params.year)}-12-01`);
  const { data: periods } = await q;
  const ids = (periods ?? []).map((p) => p.id);
  const { data: totals } = ids.length
    ? await supabase.from("payroll_records").select("payroll_period_id, net_salary, total_earnings, needs_recalculation").in("payroll_period_id", ids)
    : { data: [] };
  const agg = new Map<string, { n: number; net: number; gross: number; stale: number }>();
  for (const r of totals ?? []) {
    const a = agg.get(r.payroll_period_id) ?? { n: 0, net: 0, gross: 0, stale: 0 };
    a.n++; a.net += Number(r.net_salary); a.gross += Number(r.total_earnings); if (r.needs_recalculation) a.stale++;
    agg.set(r.payroll_period_id, a);
  }
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <>
      <PageHeader title="Payroll Management" description="Draft → Pending Approval → Approved → Finalized. Payslips are generated and emailed only after finalization."
        actions={<RunPayrollDialog branches={branches} defaultMonth={month} />} />
      <Section title="Payroll runs" actions={<FilterBar filters={[
        { name: "year", label: "Year", type: "select", options: years.map((y) => ({ value: y, label: y })) },
        { name: "status", label: "Status", type: "select", options: ["draft", "processing", "pending_approval", "approved", "finalized"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
      ]} />}>
        {!periods?.length ? (
          <EmptyState title="No payroll runs yet" description="Process payroll for a month to calculate every employee's salary." />
        ) : (
          <Table>
            <THead><TR><TH>Month</TH><TH>Branch</TH><TH className="text-right">Employees</TH><TH className="text-right">Total earnings</TH><TH className="text-right">Net payable</TH><TH>Status</TH><TH>Created</TH><TH>Finalized</TH></TR></THead>
            <TBody>
              {periods.map((p) => {
                const a = agg.get(p.id);
                return (
                  <TR key={p.id}>
                    <TD><Link href={`/payroll/${p.id}`} className="font-medium text-primary hover:underline">{formatMonth(p.payroll_month)}</Link></TD>
                    <TD>{p.branches?.name ?? "All branches"}</TD>
                    <TD className="num">{a?.n ?? 0}{a?.stale ? <span className="ml-1 text-xs text-warning">({a.stale} stale)</span> : null}</TD>
                    <TD className="num">{formatAmount(a?.gross ?? 0)}</TD>
                    <TD className="num font-semibold">{formatAmount(a?.net ?? 0)}</TD>
                    <TD><StatusBadge status={p.status} /></TD>
                    <TD className="text-muted-foreground">{formatDateTime(p.created_at)}</TD>
                    <TD className="text-muted-foreground">{formatDateTime(p.finalized_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
