import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { FormDialog } from "@/components/app/schema-form";
import { createClient } from "@/lib/supabase/server";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { employeeOptions } from "@/lib/options";
import { currentMonthStart, formatAmount, formatDate, formatMonth } from "@/lib/format";
import { createAdvance, createLoan } from "./actions";
import { PlanEditDialog } from "./plan-edit";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function PlansView({ kind, params }: { kind: "advance" | "loan"; params: Record<string, string | string[] | undefined> }) {
  const isLoan = kind === "loan";
  const table = isLoan ? "employee_loans" : "salary_advances";
  const repTable = isLoan ? "loan_repayments" : "advance_repayments";
  const supabase = await createClient();
  const [branches, employees] = await Promise.all([listBranches(supabase), listEmployeesLite(supabase)]);
  let q = supabase.from(table).select(`*, employees(full_name, employee_code, branch_id), ${repTable}(payroll_month, amount, balance_after)`).order("created_at", { ascending: false }).limit(1000);
  if (sp(params.status)) q = q.eq("status", sp(params.status));
  if (sp(params.employee)) q = q.eq("employee_id", sp(params.employee));
  const { data } = await q;
  const rows = (data ?? []) as any[];
  const active = rows.filter((r) => r.status === "active");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={isLoan ? "Loan Management" : "Salary Advances"}
        description="Monthly repayments are picked up automatically during payroll (never more than the outstanding balance). Balances are reduced only when payroll is finalized."
        actions={
          <FormDialog trigger={<Button><Plus /> {isLoan ? "New loan" : "New salary advance"}</Button>} title={isLoan ? "New employee loan" : "New salary advance"}
            schema={isLoan ? "loan" : "advance"} action={isLoan ? createLoan : createAdvance}
            fields={[
              { name: "employee_id", label: "Employee", type: "select", options: employeeOptions(employees, branches), required: true, full: true },
              isLoan ? { name: "original_amount", label: "Loan amount (LKR)", type: "money", required: true } : { name: "amount", label: "Advance amount (LKR)", type: "money", required: true },
              { name: "monthly_repayment", label: "Monthly repayment (LKR)", type: "money", required: true },
              isLoan ? { name: "start_date", label: "Start date", type: "date", required: true } : { name: "advance_date", label: "Advance date", type: "date", required: true },
              { name: "repayment_start_month", label: "First repayment month", type: "month", required: true },
              { name: "remarks", label: "Remarks", type: "textarea" },
            ]}
            defaultValues={{ employee_id: "", original_amount: "", amount: "", monthly_repayment: "", start_date: today, advance_date: today, repayment_start_month: currentMonthStart().slice(0, 7), remarks: "" }} />
        } />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={`Active ${isLoan ? "loans" : "advances"}`} value={active.length} />
        <StatCard label="Outstanding balance" value={formatAmount(active.reduce((s, r) => s + Number(r.outstanding_balance), 0))} hint="LKR" />
        <StatCard label="Monthly recovery" value={formatAmount(active.reduce((s, r) => s + Math.min(Number(r.monthly_repayment), Number(r.outstanding_balance)), 0))} hint="LKR per month" />
      </div>
      <Section title={isLoan ? "Loans" : "Salary advances"} actions={<FilterBar filters={[
        { name: "employee", label: "Employee", type: "select", options: employeeOptions(employees, branches) },
        { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "on_hold", label: "On hold" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }] },
      ]} />}>
        {!rows.length ? <EmptyState title={`No ${isLoan ? "loans" : "salary advances"}`} /> : (
          <Table>
            <THead><TR><TH>Employee</TH><TH>Date</TH><TH className="text-right">Amount</TH><TH className="text-right">Monthly</TH><TH className="text-right">Repaid</TH><TH className="text-right">Outstanding</TH><TH>From</TH><TH>Status</TH><TH>Repayment history</TH><TH /></TR></THead>
            <TBody>
              {rows.map((r) => {
                const reps = (r[repTable] ?? []) as { payroll_month: string; amount: string }[];
                const amount = isLoan ? r.original_amount : r.amount;
                return (
                  <TR key={r.id}>
                    <TD><Link className="font-medium text-primary hover:underline" href={`/employees/${r.employee_id}?tab=loans`}>{r.employees?.full_name}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.employees?.employee_code}</div></TD>
                    <TD>{formatDate(isLoan ? r.start_date : r.advance_date)}</TD>
                    <TD className="num">{formatAmount(amount)}</TD><TD className="num">{formatAmount(r.monthly_repayment)}</TD>
                    <TD className="num">{formatAmount(Number(amount) - Number(r.outstanding_balance))}</TD>
                    <TD className="num font-semibold">{formatAmount(r.outstanding_balance)}</TD>
                    <TD>{formatMonth(r.repayment_start_month)}</TD><TD><StatusBadge status={r.status} /></TD>
                    <TD className="max-w-xs whitespace-normal text-xs text-muted-foreground">{reps.length ? reps.sort((a, b) => a.payroll_month.localeCompare(b.payroll_month)).map((p) => `${formatMonth(p.payroll_month)} ${formatAmount(p.amount)}`).join(" · ") : "—"}</TD>
                    <TD className="text-right">{r.status !== "completed" && <PlanEditDialog table={table} id={r.id} status={r.status} monthly={r.monthly_repayment} remarks={r.remarks ?? ""} />}</TD>
                  </TR>
                );
              })}
            </TBody>
            <TFoot><TR><TD colSpan={5}>Total outstanding</TD><TD className="num">{formatAmount(rows.reduce((s, r) => s + Number(r.outstanding_balance), 0))}</TD><TD colSpan={4} /></TR></TFoot>
          </Table>
        )}
      </Section>
    </>
  );
}
