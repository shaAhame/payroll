import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarCog, FilePlus2, MinusCircle, PlusCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { KV, PageHeader, Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addMonths, formatAmount, formatDate, formatDateTime, formatDays, formatLKR, formatMonth } from "@/lib/format";
import type { PayrollLine, PayrollRecord } from "@/lib/types";
import { recalcRecord, setRecordAllocation } from "../../../actions";
import { createEarning } from "@/app/(app)/earnings/actions";
import { createManualDeduction } from "@/app/(app)/deductions/actions";
import { AdjustmentDialog } from "./adjustment-dialog";

export const metadata = { title: "Salary breakdown" };

export default async function RecordPage({ params }: { params: Promise<{ periodId: string; recordId: string }> }) {
  const profile = await requirePageRole(ADMIN_ROLES);
  const { periodId, recordId } = await params;
  const supabase = await createClient();
  const [{ data: rec }, { data: earnings }, { data: deductions }, { data: slip }] = await Promise.all([
    supabase.from("payroll_records").select("*").eq("id", recordId).maybeSingle(),
    supabase.from("payroll_earnings").select("*").eq("payroll_record_id", recordId).order("created_at"),
    supabase.from("payroll_deductions").select("*").eq("payroll_record_id", recordId).order("created_at"),
    supabase.from("payslips").select("id, reference_number, status").eq("payroll_record_id", recordId).maybeSingle(),
  ]);
  if (!rec) notFound();
  const r = rec as PayrollRecord;
  const E = (earnings ?? []) as PayrollLine[];
  const Dd = (deductions ?? []) as PayrollLine[];
  const b = r.calculation_breakdown as {
    allocationSource?: string; dailyRateDivisor?: string;
    workingDays?: { present: number; approvedLeave: number; publicHoliday: number; weeklyOff: number; absent: number; noPayLeave: number; countedAsWorked: number; recordedDays: number };
    lateIncidents?: { date: string; minutes: number; amount: string; waived: boolean }[];
  };
  const open = r.status !== "finalized";
  const today = new Date().toISOString().slice(0, 10);
  const commissions = E.filter((e) => e.source_type === "commission").reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <Link href={`/payroll/${periodId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to payroll</Link>
      <PageHeader
        title={r.employee_name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{r.employee_code}</span> · {r.designation} · {r.branch_name} · {formatMonth(r.payroll_month)} <StatusBadge status={r.needs_recalculation ? "pending" : r.status} label={r.needs_recalculation ? "Needs recalculation" : undefined} /></span>}
        actions={
          <>
            <Button variant="outline" asChild><Link href={`/employees/${r.employee_id}`}>Employee profile</Link></Button>
            {slip?.status === "generated" && <Button variant="outline" asChild><a href={`/api/payslips/${slip.id}`} target="_blank" rel="noreferrer">Payslip PDF</a></Button>}
            {open && (
              <>
                <ActionButton variant="outline" action={recalcRecord.bind(null, recordId)}><RefreshCw /> Recalculate</ActionButton>
                <FormDialog trigger={<Button variant="outline"><CalendarCog /> Allocated days</Button>} title="Allocated working days"
                  description={`Sets an employee-specific allocation for ${formatMonth(r.payroll_month)} (currently ${formatDays(r.allocated_working_days)} from ${b.allocationSource ?? "default"}).`}
                  schema="allocation" action={setRecordAllocation.bind(null, recordId)}
                  fields={[{ name: "allocated_days", label: "Allocated working days", type: "number", required: true }, { name: "notes", label: "Reason / notes", type: "textarea" }]}
                  defaultValues={{ allocated_days: r.allocated_working_days, notes: "", scope: "employee", employee_id: r.employee_id, payroll_month: r.payroll_month }} />
                <FormDialog trigger={<Button variant="outline"><PlusCircle /> Add earning</Button>} title="Add earning" description="Saved as an approved additional earning for this month and recalculated."
                  schema="earning" action={createEarning}
                  fields={[
                    { name: "category", label: "Category", type: "select", required: true, options: [{ value: "other", label: "Other approved earning" }, { value: "performance_incentive", label: "Performance incentive (monthly)" }] },
                    { name: "amount", label: "Amount (LKR)", type: "money", required: true },
                    { name: "transaction_reference", label: "Reference", type: "text" },
                    { name: "description", label: "Description", type: "textarea" },
                  ]}
                  defaultValues={{ employee_id: r.employee_id, category: "other", amount: "", transaction_reference: "", earning_date: today, payroll_month: r.payroll_month, description: "" }}
                  extraData={{ approve: true }} />
                <FormDialog trigger={<Button variant="outline"><MinusCircle /> Add deduction</Button>} title="Other authorized deduction" description="Requires a reason; you are recorded as the authorizer."
                  schema="manualDeduction" action={createManualDeduction}
                  fields={[{ name: "amount", label: "Amount (LKR)", type: "money", required: true }, { name: "reference", label: "Reference", type: "text" }, { name: "reason", label: "Reason", type: "textarea", required: true }]}
                  defaultValues={{ employee_id: r.employee_id, payroll_month: r.payroll_month, amount: "", reason: "", reference: "" }} />
              </>
            )}
            {!open && profile.role === "super_admin" && (
              <AdjustmentDialog recordId={recordId} defaultMonth={addMonths(r.payroll_month, 1).slice(0, 7)} trigger={<Button variant="outline"><FilePlus2 /> Correction / adjustment</Button>} />
            )}
          </>
        }
      />

      {r.warnings?.length > 0 && (
        <div className="mb-4 space-y-1 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          {r.warnings.map((w) => <div key={w.code} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />{w.message}{w.blocking && <span className="text-xs font-semibold text-warning">(blocks finalization)</span>}</div>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Salary components">
          <div className="divide-y divide-border px-5 py-2">
            <KV label="Basic Salary" value={formatAmount(r.basic_salary)} mono />
            <KV label="BRA 2" value={formatAmount(r.bra2)} mono />
            <KV label="BRA 1" value={formatAmount(r.bra1)} mono />
            <KV label="Performance Incentive" value={formatAmount(r.performance_incentive)} mono />
            <KV label="Commissions" value={formatAmount(commissions)} mono />
          </div>
        </Section>
        <Section title="EPF calculation basis" description="Basic + BRA 2 + BRA 1 (no Performance Incentive)">
          <div className="divide-y divide-border px-5 py-2">
            <KV label="EPF Salary Basis" value={formatLKR(r.epf_salary_basis)} mono />
            <KV label="Employee EPF" value={formatLKR(r.employee_epf)} mono />
            <KV label="Employer EPF (not deducted)" value={formatLKR(r.employer_epf)} mono />
            <KV label="Employer ETF (not deducted)" value={formatLKR(r.employer_etf)} mono />
          </div>
        </Section>
        <Section title="Daily salary calculation" description="Basic + BRA 2 + BRA 1 (no Performance Incentive)">
          <div className="divide-y divide-border px-5 py-2">
            <KV label="Daily Salary Basis" value={formatLKR(r.daily_salary_basis)} mono />
            <KV label={`Daily Salary Rate (÷ ${formatDays(b.dailyRateDivisor ?? r.allocated_working_days)})`} value={formatLKR(Number(r.daily_salary_rate).toFixed(2))} mono />
            <KV label="Allocated working days" value={`${formatDays(r.allocated_working_days)} · ${b.allocationSource ?? ""}`} />
            <KV label="Actual working days" value={formatDays(r.actual_working_days)} />
            <KV label="Additional working days" value={formatDays(r.additional_working_days)} />
            <KV label="Additional off days" value={formatDays(r.additional_off_days)} />
            <KV label="Additional working pay" value={<span className="text-success">{formatAmount(r.additional_working_pay)}</span>} mono />
            <KV label="No-pay leave" value={<span className="text-destructive">{formatAmount(r.no_pay_leave)}</span>} mono />
          </div>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Lines title="Earnings" lines={E} total={r.total_earnings} />
        <Lines title="Deductions" lines={Dd} total={r.total_deductions} />
      </div>

      <div className="mt-4 flex flex-col items-start justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 sm:flex-row sm:items-center">
        <div className="text-sm text-muted-foreground">Net Salary = Total Earnings ({formatAmount(r.total_earnings)}) − Total Deductions ({formatAmount(r.total_deductions)})</div>
        <div className="text-xl font-semibold tabular-nums">NET SALARY PAYABLE: {formatLKR(r.net_salary)}</div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Attendance breakdown">
          <div className="grid grid-cols-2 gap-x-6 px-5 py-2 sm:grid-cols-3">
            {b.workingDays && Object.entries({
              Present: b.workingDays.present, "Approved leave": b.workingDays.approvedLeave, "Public holidays": b.workingDays.publicHoliday,
              "Weekly off": b.workingDays.weeklyOff, Absent: b.workingDays.absent, "No-pay leave": b.workingDays.noPayLeave,
              "Counted as worked": b.workingDays.countedAsWorked, "Days recorded": b.workingDays.recordedDays,
            }).map(([k, v]) => <KV key={k} label={k} value={v} />)}
          </div>
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            The difference between actual and allocated days is a single adjustment — additional working pay or no-pay leave, never both.
            <Link className="ml-1 text-primary hover:underline" href={`/attendance?tab=daily&employee=${r.employee_id}&month=${r.payroll_month.slice(0, 7)}`}>View attendance</Link>
          </p>
        </Section>
        <Section title="Late arrivals">
          {!b.lateIncidents?.length ? <p className="px-5 py-6 text-sm text-muted-foreground">No late arrivals this month.</p> : (
            <Table>
              <THead><TR><TH>Date</TH><TH className="text-right">Minutes late</TH><TH className="text-right">Deduction</TH><TH></TH></TR></THead>
              <TBody>
                {b.lateIncidents.map((i) => (
                  <TR key={i.date}><TD>{formatDate(i.date)}</TD><TD className="num">{i.minutes}</TD><TD className="num">{i.waived ? <s>{formatAmount(i.amount)}</s> : formatAmount(i.amount)}</TD><TD>{i.waived && <StatusBadge status="cancelled" label="Waived" />}</TD></TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Calculated {formatDateTime(r.calculated_at)} by the central payroll engine.{!open && " This record is finalized and locked."}</p>
    </>
  );
}

function Lines({ title, lines, total }: { title: string; lines: PayrollLine[]; total: string }) {
  return (
    <Section title={title}>
      <Table>
        <THead><TR><TH>Item</TH><TH>Calculation / source</TH><TH className="text-right">Amount (LKR)</TH></TR></THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD className="whitespace-normal font-medium">{l.label}</TD>
              <TD className="whitespace-normal text-xs text-muted-foreground">{describe(l)}</TD>
              <TD className="num">{formatAmount(l.amount)}</TD>
            </TR>
          ))}
        </TBody>
        <TFoot><TR><TD>Total {title.toLowerCase()}</TD><TD /><TD className="num">{formatAmount(total)}</TD></TR></TFoot>
      </Table>
    </Section>
  );
}

function describe(l: PayrollLine): string {
  const c = l.calculation as Record<string, unknown>;
  if (c.formula && c.additionalWorkingDays) return `${c.additionalWorkingDays} day(s) × ${formatAmount(Number(c.dailySalaryRate).toFixed(2))}`;
  if (c.formula && c.additionalOffDays) return `${c.additionalOffDays} day(s) × ${formatAmount(Number(c.dailySalaryRate).toFixed(2))}`;
  if (c.formula && c.epfSalaryBasis) return `${formatAmount(String(c.epfSalaryBasis))} × ${Number(c.rate) * 100}%`;
  if (Array.isArray(c.incidents)) return `${(c.incidents as { waived: boolean }[]).filter((i) => !i.waived).length} incident(s), ${String(c.frequency).replace("_", " ")}`;
  if (c.transactionId) return `Transaction ${c.transactionId}${c.reason ? ` · ${c.reason}` : ""}`;
  if (c.outstandingBefore) return `Outstanding before: ${formatAmount(String(c.outstandingBefore))}`;
  if (l.source_type === "salary_structure") return "Salary structure";
  if (l.source_type === "manual_deduction") return "Authorized manual deduction";
  if (l.source_type === "additional_earning") return "Approved additional earning";
  return "";
}
