import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { ADMIN_ROLES, can, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { employeeOptions } from "@/lib/options";
import { formatAmount, formatDate, formatDays, formatMonth, titleCase } from "@/lib/format";
import { createEarning, deleteEarning, setEarningStatus } from "./actions";

export const metadata = { title: "Additional Earnings" };

const CATEGORIES = [
  { value: "performance_incentive", label: "Performance Incentive" }, { value: "additional_working_pay", label: "Additional Working Pay" },
  { value: "sales_commission", label: "Sales Commission" }, { value: "pre_owned_commission", label: "Pre-Owned Commission" },
  { value: "company_device_commission", label: "Company Device Commission" }, { value: "repair_commission", label: "Repair Commission" }, { value: "other", label: "Other Approved Earning" },
];
const COMM: Record<string, string> = { sales: "sales_commission", pre_owned: "pre_owned_commission", company_device: "company_device_commission", repair: "repair_commission" };

interface Row { key: string; id: string; source: "earning" | "commission" | "attendance"; employee: string; code: string; branch: string; category: string; amount: string; ref: string | null; date: string | null; status: string; description: string | null; processed: boolean; link?: string }

export default async function EarningsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const isAdmin = can(profile, ADMIN_ROLES);
  const supabase = await createClient();
  const branchFilter = profile.role === "branch_manager" ? profile.branch_id : sp(params.branch) || null;
  const [branches, employees, month] = await Promise.all([listBranches(supabase), listEmployeesLite(supabase, { branchId: branchFilter }), resolveMonth(params.month)]);

  let eq = supabase.from("additional_earnings").select("*, employees(full_name, employee_code), branches(name)").eq("payroll_month", month).order("created_at", { ascending: false });
  let cq = supabase.from("commission_records").select("*, employees(full_name, employee_code), branches(name)").eq("payroll_month", month).order("created_at", { ascending: false });
  let pq = supabase.from("payroll_records").select("id, payroll_period_id, employee_name, employee_code, branch_name, branch_id, additional_working_pay, additional_working_days, status").eq("payroll_month", month).gt("additional_working_pay", 0);
  if (branchFilter) { eq = eq.eq("branch_id", branchFilter); cq = cq.eq("branch_id", branchFilter); pq = pq.eq("branch_id", branchFilter); }
  const [{ data: earn }, { data: comm }, { data: awp }] = await Promise.all([eq, cq, isAdmin ? pq : Promise.resolve({ data: [] })]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let rows: Row[] = [
    ...((earn ?? []) as any[]).map((e) => ({ key: `e${e.id}`, id: e.id, source: "earning" as const, employee: e.employees?.full_name, code: e.employees?.employee_code, branch: e.branches?.name, category: e.category, amount: e.amount, ref: e.transaction_reference, date: e.earning_date, status: e.approval_status, description: e.description, processed: !!e.processed_payroll_record_id })),
    ...((comm ?? []) as any[]).map((c) => ({ key: `c${c.id}`, id: c.id, source: "commission" as const, employee: c.employees?.full_name, code: c.employees?.employee_code, branch: c.branches?.name, category: COMM[c.commission_type], amount: c.amount, ref: c.transaction_id, date: c.commission_date, status: c.status, description: c.notes, processed: !!c.included_payroll_record_id, link: "/commissions" })),
    ...((awp ?? []) as any[]).map((p) => ({ key: `p${p.id}`, id: p.id, source: "attendance" as const, employee: p.employee_name, code: p.employee_code, branch: p.branch_name, category: "additional_working_pay", amount: p.additional_working_pay, ref: null, date: null, status: p.status, description: `${formatDays(p.additional_working_days)} additional day(s) × daily rate — calculated from attendance`, processed: p.status === "finalized", link: `/payroll/${p.payroll_period_id}/records/${p.id}` })),
  ];
  if (sp(params.category)) rows = rows.filter((r) => r.category === sp(params.category));
  if (sp(params.status)) rows = rows.filter((r) => r.status === sp(params.status));
  const label = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? titleCase(c);

  return (
    <>
      <PageHeader title="Additional Earnings" description="Performance incentives, commissions, other approved earnings and the automatic additional working pay. Commission entries are kept in the commission register so they can never be counted twice."
        actions={
          <FormDialog trigger={<Button><Plus /> Add earning</Button>} title="Add earning" description={isAdmin ? "Approved immediately and included in that month's payroll." : "Submitted for HR approval."}
            schema="earning" action={createEarning} extraData={{ approve: isAdmin }}
            fields={[
              { name: "employee_id", label: "Employee", type: "select", options: employeeOptions(employees, branches), required: true, full: true },
              { name: "category", label: "Earning category", type: "select", required: true, options: CATEGORIES.filter((c) => c.value !== "additional_working_pay"), hint: "Additional working pay is calculated from attendance" },
              { name: "amount", label: "Amount (LKR)", type: "money", required: true },
              { name: "transaction_reference", label: "Transaction reference", type: "text", hint: "Required for commissions; prevents duplicate entries" },
              { name: "earning_date", label: "Date", type: "date", required: true },
              { name: "payroll_month", label: "Payroll month", type: "month", required: true },
              { name: "description", label: "Description", type: "textarea" },
            ]}
            defaultValues={{ employee_id: "", category: "performance_incentive", amount: "", transaction_reference: "", earning_date: new Date().toISOString().slice(0, 10), payroll_month: month.slice(0, 7), description: "" }} />
        } />
      <Section title={`Earnings for ${formatMonth(month)}`} description="Monthly performance-incentive records are added to the salary-structure incentive (configurable) and paid once as an earning; they are not part of the EPF or daily salary basis."
        actions={<FilterBar filters={[
          { name: "month", label: "Payroll month", type: "month" },
          ...(profile.role !== "branch_manager" ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
          { name: "category", label: "Category", type: "select", options: CATEGORIES },
          { name: "status", label: "Status", type: "select", options: ["pending", "approved", "rejected", "cancelled", "included_in_payroll", "finalized"].map((s) => ({ value: s, label: titleCase(s) })) },
        ]} />}>
        {!rows.length ? <EmptyState title="No additional earnings for this month" /> : (
          <Table>
            <THead><TR><TH>Employee</TH><TH>Branch</TH><TH>Category</TH><TH className="text-right">Amount</TH><TH>Reference</TH><TH>Date</TH><TH>Description</TH><TH>Status</TH>{isAdmin && <TH />}</TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.key}>
                  <TD><div className="font-medium">{r.employee}</div><div className="font-mono text-[11px] text-muted-foreground">{r.code}</div></TD>
                  <TD>{r.branch}</TD><TD>{label(r.category)}</TD><TD className="num">{formatAmount(r.amount)}</TD>
                  <TD className="font-mono text-xs">{r.ref ?? "—"}</TD><TD>{formatDate(r.date)}</TD>
                  <TD className="max-w-xs whitespace-normal text-xs text-muted-foreground">{r.description}</TD>
                  <TD><StatusBadge status={r.status} />{r.processed && r.source === "earning" && <span className="ml-1 text-[11px] text-muted-foreground">paid</span>}</TD>
                  {isAdmin && (
                    <TD className="text-right">
                      {r.source === "earning" && !r.processed ? (
                        <div className="flex justify-end gap-1">
                          {r.status === "pending" && <ActionButton size="sm" variant="ghost" action={setEarningStatus.bind(null, r.id, "approved")}>Approve</ActionButton>}
                          {r.status === "pending" && <ActionButton size="sm" variant="ghost" action={setEarningStatus.bind(null, r.id, "rejected")} confirm={{ title: "Reject earning?", description: "It will not be paid.", destructive: true }}>Reject</ActionButton>}
                          {r.status === "approved" && <ActionButton size="sm" variant="ghost" action={setEarningStatus.bind(null, r.id, "cancelled")} confirm={{ title: "Cancel earning?", description: "It is removed from open payroll.", destructive: true }}>Cancel</ActionButton>}
                          <ActionButton size="icon" variant="ghost" aria-label="Delete" action={deleteEarning.bind(null, r.id)} confirm={{ title: "Delete earning?", description: "This cannot be undone.", destructive: true }}><Trash2 /></ActionButton>
                        </div>
                      ) : r.link ? <Link className="text-xs text-primary hover:underline" href={r.link}>{r.source === "commission" ? "Manage" : "Breakdown"}</Link> : null}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
