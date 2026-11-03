import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { ADMIN_ROLES, can, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { COMMISSION_TYPES, employeeOptions } from "@/lib/options";
import { addMonths, formatAmount, formatDate, formatMonth, titleCase } from "@/lib/format";
import { approveAllPending, createCommission, deleteCommission, setCommissionStatus, undoRelease } from "./actions";
import { ReleaseDialog } from "./release-dialog";

export const metadata = { title: "Commissions" };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const isAdmin = can(profile, ADMIN_ROLES);
  const supabase = await createClient();
  const branchFilter = profile.role === "branch_manager" ? profile.branch_id : sp(params.branch) || null;
  const [branches, employees, month] = await Promise.all([listBranches(supabase), listEmployeesLite(supabase, { branchId: branchFilter }), resolveMonth(params.month)]);
  let q = supabase.from("commission_records").select("*, employees(full_name, employee_code), branches(name)").order("commission_date", { ascending: false }).limit(1000);
  q = sp(params.view) === "releases" ? q.eq("release_deduction_month", month) : q.eq("payroll_month", month);
  if (branchFilter) q = q.eq("branch_id", branchFilter);
  if (sp(params.type)) q = q.eq("commission_type", sp(params.type));
  if (sp(params.status)) q = q.eq("status", sp(params.status));
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; employee_id: string; commission_type: string; transaction_id: string; amount: string; commission_date: string; payroll_month: string; status: string;
    released_date: string | null; release_deduction_month: string | null; included_payroll_record_id: string | null; release_deducted_payroll_record_id: string | null;
    notes: string | null; employees: { full_name: string; employee_code: string } | null; branches: { name: string } | null;
  }[];
  const total = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + Number(r.amount), 0);
  const pending = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <PageHeader title="Commission Management" description="Commissions are paid as payroll earnings once approved. A commission is deducted only if it was paid in payroll and later released separately."
        actions={<>
          {isAdmin && pending > 0 && <ActionButton variant="outline" action={approveAllPending.bind(null, month, branchFilter ?? undefined)} confirm={{ title: `Approve ${pending} pending commission(s)?`, description: `For ${formatMonth(month)}.` }}>Approve all pending</ActionButton>}
          <FormDialog trigger={<Button><Plus /> Add commission</Button>} title="Add commission" description={isAdmin ? "Approved immediately and included in that month's payroll." : "Submitted for HR approval."}
            schema="commission" action={createCommission} extraData={{ approve: isAdmin }}
            fields={[
              { name: "employee_id", label: "Employee", type: "select", options: employeeOptions(employees, branches), required: true, full: true },
              { name: "commission_type", label: "Commission type", type: "select", options: COMMISSION_TYPES, required: true },
              { name: "transaction_id", label: "Transaction ID", type: "text", required: true, hint: "Unique per type and employee — prevents duplicates" },
              { name: "amount", label: "Commission amount (LKR)", type: "money", required: true },
              { name: "commission_date", label: "Commission date", type: "date", required: true },
              { name: "payroll_month", label: "Payroll month", type: "month", required: true },
              { name: "notes", label: "Notes", type: "textarea" },
            ]}
            defaultValues={{ employee_id: "", commission_type: "sales", transaction_id: "", amount: "", commission_date: new Date().toISOString().slice(0, 10), payroll_month: month.slice(0, 7), notes: "" }} />
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pending approval" value={formatAmount(total((r) => r.status === "pending"))} hint={`${pending} record(s)`} tone={pending ? "warning" : "default"} />
        <StatCard label="Approved (to be paid)" value={formatAmount(total((r) => r.status === "approved"))} />
        <StatCard label="Included in payroll" value={formatAmount(total((r) => r.status === "included_in_payroll"))} />
        <StatCard label="Released separately" value={formatAmount(total((r) => r.status === "released"))} />
      </div>
      <Section title={`${sp(params.view) === "releases" ? "Releases recovered in" : "Commissions for"} ${formatMonth(month)}`}
        actions={<FilterBar filters={[
          { name: "month", label: "Payroll month", type: "month" },
          { name: "view", label: "View", type: "select", options: [{ value: "releases", label: "Releases to recover this month" }] },
          ...(profile.role !== "branch_manager" ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
          { name: "type", label: "Type", type: "select", options: COMMISSION_TYPES },
          { name: "status", label: "Status", type: "select", options: ["pending", "approved", "included_in_payroll", "released", "cancelled"].map((s) => ({ value: s, label: titleCase(s) })) },
        ]} />}>
        {!rows.length ? <EmptyState title="No commissions" /> : (
          <Table>
            <THead><TR><TH>Employee</TH><TH>Branch</TH><TH>Type</TH><TH>Transaction</TH><TH>Date</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH>Released</TH><TH>Recovery</TH>{isAdmin && <TH />}</TR></THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD><div className="font-medium">{c.employees?.full_name}</div><div className="font-mono text-[11px] text-muted-foreground">{c.employees?.employee_code}</div></TD>
                  <TD>{c.branches?.name}</TD><TD>{titleCase(c.commission_type)}</TD><TD className="font-mono text-xs">{c.transaction_id}</TD>
                  <TD>{formatDate(c.commission_date)}</TD><TD className="num">{formatAmount(c.amount)}</TD><TD><StatusBadge status={c.status} /></TD>
                  <TD>{c.released_date ? formatDate(c.released_date) : "—"}</TD>
                  <TD className="text-xs">{c.release_deduction_month ? (c.release_deducted_payroll_record_id ? `Recovered ${formatMonth(c.release_deduction_month)}` : `Due ${formatMonth(c.release_deduction_month)}`) : c.status === "released" ? "Not paid via payroll" : "—"}</TD>
                  {isAdmin && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {c.status === "pending" && <ActionButton size="sm" variant="ghost" action={setCommissionStatus.bind(null, c.id, "approved")}>Approve</ActionButton>}
                        {(c.status === "pending" || c.status === "approved") && <ActionButton size="sm" variant="ghost" action={setCommissionStatus.bind(null, c.id, "cancelled")} reason={{ label: "Reason" }} confirm={{ title: "Cancel commission?", description: "It will not be paid.", destructive: true }}>Cancel</ActionButton>}
                        {(c.status === "approved" || c.status === "included_in_payroll") && <ReleaseDialog id={c.id} includedInPayroll={!!c.included_payroll_record_id} defaultMonth={addMonths(month, c.included_payroll_record_id ? 1 : 0).slice(0, 7)} label={c.transaction_id} />}
                        {c.status === "released" && !c.release_deducted_payroll_record_id && <ActionButton size="sm" variant="ghost" action={undoRelease.bind(null, c.id)} confirm={{ title: "Undo release?", description: "The pending recovery deduction is removed." }}>Undo release</ActionButton>}
                        {(c.status === "pending" || c.status === "cancelled") && <ActionButton size="icon" variant="ghost" aria-label="Delete" action={deleteCommission.bind(null, c.id)} confirm={{ title: "Delete commission?", description: "This cannot be undone.", destructive: true }}><Trash2 /></ActionButton>}
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
            <TFoot><TR><TD colSpan={5}>Total (excluding cancelled)</TD><TD className="num">{formatAmount(total((r) => r.status !== "cancelled"))}</TD><TD colSpan={isAdmin ? 4 : 3} /></TR></TFoot>
          </Table>
        )}
      </Section>
    </>
  );
}
