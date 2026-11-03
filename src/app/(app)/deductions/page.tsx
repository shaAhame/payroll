import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { LinkTabs } from "@/components/app/link-tabs";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { employeeOptions } from "@/lib/options";
import { formatAmount, formatDateTime, formatMonth, titleCase } from "@/lib/format";
import { cancelManualDeduction, createManualDeduction } from "./actions";

export const metadata = { title: "Deductions" };

const CATEGORY_ORDER = ["no_pay_leave", "sales_commission_released", "used_commission_released", "repair_commission_released", "company_device_commission_released", "employee_epf", "late_arrivals", "salary_advance", "loan_repayment", "other"];
const SOURCE: Record<string, string> = {
  attendance: "Attendance (automatic)", epf: "EPF rule (automatic)", commission_release: "Commission register", salary_advance: "Salary advance plan", loan: "Loan plan", manual_deduction: "Authorized manual deduction",
};

export default async function DeductionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(ADMIN_ROLES);
  const params = await searchParams;
  const tab = sp(params.tab) || "summary";
  const supabase = await createClient();
  const [branches, employees, month] = await Promise.all([listBranches(supabase), listEmployeesLite(supabase), resolveMonth(params.month)]);
  const [{ data: lines }, { data: manual }, { data: profiles }] = await Promise.all([
    supabase.from("payroll_deductions").select("id, category, label, amount, source_type, calculation, payroll_records!inner(id, payroll_period_id, employee_name, employee_code, payroll_month, status)")
      .eq("payroll_records.payroll_month", month).gt("amount", 0).limit(10000),
    supabase.from("manual_deductions").select("*, employees(full_name, employee_code)").eq("payroll_month", month).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const L = (lines ?? []) as any[];
  const filtered = sp(params.category) ? L.filter((l) => l.category === sp(params.category)) : L;
  const byCat = CATEGORY_ORDER.map((c) => ({ c, rows: L.filter((l) => l.category === c) })).map((x) => ({ ...x, total: x.rows.reduce((s, l) => s + Number(l.amount), 0) }));
  const who = (id: string) => profiles?.find((p) => p.id === id)?.full_name ?? "—";

  return (
    <>
      <PageHeader title="Deductions" description="Every payroll deduction with its calculation and source. No-pay leave, EPF and late arrivals are automatic; advances and loans are taken from repayment plans; manual deductions need an authorizer and a reason."
        actions={
          <FormDialog trigger={<Button><Plus /> Authorized deduction</Button>} title="Other authorized deduction" description="You are recorded as the authorizer. Open payroll is recalculated."
            schema="manualDeduction" action={createManualDeduction}
            fields={[
              { name: "employee_id", label: "Employee", type: "select", options: employeeOptions(employees, branches), required: true, full: true },
              { name: "payroll_month", label: "Payroll month", type: "month", required: true },
              { name: "amount", label: "Amount (LKR)", type: "money", required: true },
              { name: "reference", label: "Reference", type: "text" },
              { name: "reason", label: "Reason", type: "textarea", required: true },
            ]}
            defaultValues={{ employee_id: "", payroll_month: month.slice(0, 7), amount: "", reason: "", reference: "" }} />
        } />
      <LinkTabs tabs={[{ key: "summary", label: "By category" }, { key: "lines", label: "All payroll deductions" }, { key: "manual", label: "Authorized manual deductions" }]} active={tab} base={`/deductions?month=${month.slice(0, 7)}`} />
      <div className="mb-4"><FilterBar filters={[{ name: "month", label: "Payroll month", type: "month" }, ...(tab === "lines" ? [{ name: "category", label: "Category", type: "select" as const, options: CATEGORY_ORDER.map((c) => ({ value: c, label: titleCase(c) })) }] : [])]} /></div>

      {tab === "summary" && (
        <Section title={`Deductions by category · ${formatMonth(month)}`}>
          <Table>
            <THead><TR><TH>Category</TH><TH>Source</TH><TH className="text-right">Employees</TH><TH className="text-right">Total (LKR)</TH></TR></THead>
            <TBody>
              {byCat.map((x) => (
                <TR key={x.c}>
                  <TD><Link className="text-primary hover:underline" href={`/deductions?tab=lines&month=${month.slice(0, 7)}&category=${x.c}`}>{x.c === "employee_epf" ? "Employee EPF 8%" : titleCase(x.c)}</Link></TD>
                  <TD className="text-muted-foreground">{SOURCE[x.rows[0]?.source_type] ?? "—"}</TD>
                  <TD className="num">{new Set(x.rows.map((r) => r.payroll_records.id)).size}</TD><TD className="num">{formatAmount(x.total)}</TD>
                </TR>
              ))}
            </TBody>
            <TFoot><TR><TD colSpan={3}>Total deductions</TD><TD className="num">{formatAmount(byCat.reduce((s, x) => s + x.total, 0))}</TD></TR></TFoot>
          </Table>
        </Section>
      )}

      {tab === "lines" && (
        <Section title={`Payroll deductions · ${formatMonth(month)}`}>
          {!filtered.length ? <EmptyState title="No deductions" description="Process payroll for this month first." /> : (
            <Table>
              <THead><TR><TH>Employee</TH><TH>Deduction</TH><TH>Source</TH><TH>Calculation</TH><TH className="text-right">Amount</TH><TH>Payroll</TH></TR></THead>
              <TBody>
                {filtered.map((l) => (
                  <TR key={l.id}>
                    <TD><div className="font-medium">{l.payroll_records.employee_name}</div><div className="font-mono text-[11px] text-muted-foreground">{l.payroll_records.employee_code}</div></TD>
                    <TD>{l.label}</TD><TD className="text-muted-foreground">{SOURCE[l.source_type]}</TD>
                    <TD className="max-w-sm whitespace-normal text-xs text-muted-foreground">{explain(l.calculation)}</TD>
                    <TD className="num">{formatAmount(l.amount)}</TD>
                    <TD><Link className="text-xs text-primary hover:underline" href={`/payroll/${l.payroll_records.payroll_period_id}/records/${l.payroll_records.id}`}><StatusBadge status={l.payroll_records.status} /></Link></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}

      {tab === "manual" && (
        <Section title={`Authorized manual deductions · ${formatMonth(month)}`}>
          {!manual?.length ? <EmptyState title="No manual deductions" /> : (
            <Table>
              <THead><TR><TH>Employee</TH><TH className="text-right">Amount</TH><TH>Reason</TH><TH>Reference</TH><TH>Authorized by</TH><TH>Created</TH><TH>Status</TH><TH /></TR></THead>
              <TBody>
                {(manual as any[]).map((m) => (
                  <TR key={m.id}>
                    <TD><div className="font-medium">{m.employees?.full_name}</div><div className="font-mono text-[11px] text-muted-foreground">{m.employees?.employee_code}</div></TD>
                    <TD className="num">{formatAmount(m.amount)}</TD><TD className="max-w-xs whitespace-normal">{m.reason}</TD><TD>{m.reference ?? "—"}</TD>
                    <TD>{who(m.authorized_by)}</TD><TD className="text-muted-foreground">{formatDateTime(m.created_at)}</TD>
                    <TD>{m.processed_payroll_record_id ? <StatusBadge status="finalized" label="Applied" /> : <StatusBadge status={m.status} />}</TD>
                    <TD className="text-right">{!m.processed_payroll_record_id && m.status === "approved" && (
                      <ActionButton size="sm" variant="ghost" action={cancelManualDeduction.bind(null, m.id)} reason={{ label: "Reason for cancelling" }} confirm={{ title: "Cancel deduction?", description: "It is removed from open payroll.", destructive: true }}>Cancel</ActionButton>
                    )}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}
    </>
  );
}

function explain(c: Record<string, any>): string {
  if (c?.additionalOffDays) return `${c.additionalOffDays} additional off day(s) × daily rate ${formatAmount(Number(c.dailySalaryRate).toFixed(2))}`;
  if (c?.epfSalaryBasis) return `EPF basis ${formatAmount(c.epfSalaryBasis)} × ${Number(c.rate) * 100}%`;
  if (Array.isArray(c?.incidents)) return c.incidents.map((i: any) => `${i.date}: ${i.minutes}m → ${i.waived ? "waived" : formatAmount(i.amount)}`).join("; ");
  if (c?.transactionId) return `Txn ${c.transactionId} — ${c.reason ?? ""}`;
  if (c?.outstandingBefore) return `Monthly ${formatAmount(c.monthlyRepayment)}, outstanding before ${formatAmount(c.outstandingBefore)}`;
  return "";
}
