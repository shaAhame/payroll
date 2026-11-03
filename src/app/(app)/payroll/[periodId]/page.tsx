import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Send, ShieldCheck, Undo2, UserPlus, Lock, Trash2, Cog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sp } from "@/lib/queries";
import { formatAmount, formatDateTime, formatDays, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PayrollRecord } from "@/lib/types";
import {
  addMissingEmployees, approvePeriod, deleteDraftPeriod, finalizePeriod, recalcPeriod, returnToDraft, runJobsNow, submitPeriod,
} from "../actions";

export const metadata = { title: "Payroll run" };
export const maxDuration = 300;

const STEPS = [
  { key: "draft", label: "Draft" }, { key: "pending_approval", label: "Pending approval" }, { key: "approved", label: "Approved" }, { key: "finalized", label: "Finalized" },
];

export default async function PeriodPage({ params, searchParams }: {
  params: Promise<{ periodId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requirePageRole(ADMIN_ROLES);
  const { periodId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: period } = await supabase.from("payroll_periods").select("*, branches(name)").eq("id", periodId).maybeSingle();
  if (!period) notFound();
  const [{ data: settings }, { data: allRecords }, { data: issues }, { data: slips }, { data: emails }, { data: people }] = await Promise.all([
    supabase.from("payroll_settings").select("require_approval").limit(1).maybeSingle(),
    supabase.from("payroll_records").select("*").eq("payroll_period_id", periodId).order("employee_code").limit(5000),
    supabase.rpc("payroll_blocking_issues", { p_period_id: periodId }),
    supabase.from("payslips").select("status, payroll_records!inner(payroll_period_id)").eq("payroll_records.payroll_period_id", periodId),
    supabase.from("email_notifications").select("email_status, payroll_records!inner(payroll_period_id)").eq("payroll_records.payroll_period_id", periodId).eq("is_manual_resend", false),
    supabase.from("profiles").select("id, full_name").in("id", [period.created_by, period.submitted_by, period.approved_by, period.finalized_by].filter(Boolean) as string[]),
  ]);
  const records = (allRecords ?? []) as PayrollRecord[];
  const search = sp(query.q).toLowerCase();
  const shown = records.filter((r) => (!search || `${r.employee_name} ${r.employee_code} ${r.designation}`.toLowerCase().includes(search))
    && (!sp(query.branch) || r.branch_id === sp(query.branch))
    && (!sp(query.flag) || (sp(query.flag) === "warnings" ? r.warnings?.length > 0 : r.needs_recalculation)));
  const blocking = (issues ?? []) as { employee_code: string; employee_name: string; issue: string }[];
  const stale = records.filter((r) => r.needs_recalculation).length;
  const total = (k: keyof PayrollRecord) => records.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const shownTotal = (k: keyof PayrollRecord) => shown.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const isSuper = profile.role === "super_admin";
  const requireApproval = settings?.require_approval ?? true;
  const s = period.status as string;
  const canFinalize = isSuper && (s === "approved" || (!requireApproval && s !== "finalized"));
  const name = (id: string | null) => people?.find((p) => p.id === id)?.full_name ?? "—";
  const branchList = [...new Map(records.map((r) => [r.branch_id, r.branch_name])).entries()];
  const stepIndex = STEPS.findIndex((x) => x.key === (s === "processing" ? "draft" : s));
  const slipCounts = (slips ?? []).reduce<Record<string, number>>((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {});
  const emailCounts = (emails ?? []).reduce<Record<string, number>>((a, x) => ({ ...a, [x.email_status]: (a[x.email_status] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader
        title={`${formatMonth(period.payroll_month)} payroll`}
        description={<span className="flex flex-wrap items-center gap-2">{period.branches?.name ?? "All branches"} · {records.length} employees <StatusBadge status={s} /></span>}
        actions={
          <>
            <Button variant="outline" asChild><a href={`/api/reports/payroll_register?format=xlsx&period=${periodId}`}><Download /> Excel</a></Button>
            {s !== "finalized" && (
              <>
                <ActionButton variant="outline" action={recalcPeriod.bind(null, periodId, true)}><RefreshCw /> Recalculate all</ActionButton>
                {(s === "draft" || s === "processing") && <ActionButton variant="outline" action={addMissingEmployees.bind(null, periodId)}><UserPlus /> Add new employees</ActionButton>}
              </>
            )}
            {(s === "draft" || s === "processing") && requireApproval && (
              <ActionButton action={submitPeriod.bind(null, periodId)} disabled={blocking.length > 0}
                confirm={{ title: "Submit for approval?", description: "Stale records are recalculated first. Any later change to inputs returns the payroll to draft." }}>
                <Send /> Submit for approval
              </ActionButton>
            )}
            {s === "pending_approval" && isSuper && (
              <ActionButton variant="success" action={approvePeriod.bind(null, periodId)}
                confirm={{ title: "Approve payroll?", description: `Net payable LKR ${formatAmount(total("net_salary"))} for ${records.length} employees.` }}>
                <ShieldCheck /> Approve
              </ActionButton>
            )}
            {(s === "pending_approval" || s === "approved") && (
              <ActionButton variant="outline" action={returnToDraft.bind(null, periodId)} reason={{ label: "Reason for returning to draft" }}
                confirm={{ title: "Return to draft?", description: "The approval is cleared and the payroll can be edited again." }}>
                <Undo2 /> Return to draft
              </ActionButton>
            )}
            {canFinalize && (
              <ActionButton variant="success" action={finalizePeriod.bind(null, periodId)} disabled={blocking.length > 0}
                confirm={{
                  title: "Finalize payroll?",
                  description: (
                    <>
                      <p>This locks every record permanently, updates loan and advance balances, marks commissions as paid, generates PDF payslips and queues payslip emails.</p>
                      <p className="font-medium text-foreground">Net payable: LKR {formatAmount(total("net_salary"))} · {records.length} employees</p>
                      <p>Corrections after this point are made through authorized adjustments in a later month.</p>
                    </>
                  ),
                  confirmLabel: "Finalize payroll",
                }}>
                <Lock /> Finalize
              </ActionButton>
            )}
            {s === "finalized" && <ActionButton variant="outline" action={runJobsNow}><Cog /> Process payslips & emails now</ActionButton>}
            {s === "draft" && (
              <ActionButton variant="ghost" action={deleteDraftPeriod.bind(null, periodId)} redirectTo="/payroll"
                confirm={{ title: "Delete this draft payroll?", description: "Only the calculation is removed; attendance and other inputs are kept.", destructive: true, confirmLabel: "Delete draft" }}>
                <Trash2 /> Delete draft
              </ActionButton>
            )}
          </>
        }
      />

      <ol className="mb-6 grid grid-cols-4 gap-2">
        {STEPS.map((step, i) => (
          <li key={step.key} className={cn("rounded-lg border px-3 py-2 text-xs", i <= stepIndex ? "border-primary/30 bg-primary/5" : "border-border bg-card")}>
            <div className={cn("flex items-center gap-1.5 font-semibold", i <= stepIndex ? "text-primary" : "text-muted-foreground")}>
              {i < stepIndex || s === "finalized" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px]">{i + 1}</span>}
              {step.label}
            </div>
            <div className="mt-0.5 hidden text-muted-foreground sm:block">
              {i === 0 && `by ${name(period.created_by)}`}
              {i === 1 && period.submitted_at && `${name(period.submitted_by)} · ${formatDateTime(period.submitted_at)}`}
              {i === 2 && period.approved_at && `${name(period.approved_by)} · ${formatDateTime(period.approved_at)}`}
              {i === 3 && period.finalized_at && `${name(period.finalized_by)} · ${formatDateTime(period.finalized_at)}`}
            </div>
          </li>
        ))}
      </ol>

      {(blocking.length > 0 || stale > 0) && s !== "finalized" && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> {blocking.length} issue(s) must be resolved before submission or finalization</div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-foreground">
            {blocking.slice(0, 50).map((b, i) => <li key={i}><span className="font-mono text-xs">{b.employee_code}</span> {b.employee_name}: {b.issue}</li>)}
          </ul>
          {stale > 0 && <p className="mt-2 text-muted-foreground">{stale} record(s) have changed inputs. Use “Recalculate all” or open the record.</p>}
        </div>
      )}
      {period.notes && <p className="mb-4 whitespace-pre-line rounded-lg bg-muted px-4 py-2 text-xs text-muted-foreground">{period.notes}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total earnings" value={formatAmount(total("total_earnings"))} hint="LKR" />
        <StatCard label="Total deductions" value={formatAmount(total("total_deductions"))} hint="LKR" />
        <StatCard label="Net salary payable" value={formatAmount(total("net_salary"))} hint="LKR" tone="success" />
        <StatCard label="Employee EPF 8%" value={formatAmount(total("employee_epf"))} hint="LKR" />
        <StatCard label="Employer EPF / ETF" value={`${formatAmount(total("employer_epf"))} / ${formatAmount(total("employer_etf"))}`} hint="Not deducted from employees" />
        {s === "finalized" ? (
          <StatCard label="Payslips · emails" value={`${slipCounts.generated ?? 0}/${records.length} · ${(emailCounts.sent ?? 0) + (emailCounts.delivered ?? 0)}`}
            hint={<Link href="/emails" className="text-primary hover:underline">{(emailCounts.failed ?? 0) + (emailCounts.bounced ?? 0)} failed · {emailCounts.queued ?? 0} queued</Link>} />
        ) : (
          <StatCard label="Needs recalculation" value={stale} tone={stale ? "warning" : "default"} />
        )}
      </div>

      <Section title="Employee payroll" description="Click an employee for the complete salary breakdown."
        actions={<FilterBar filters={[
          { name: "q", label: "Search", type: "text", placeholder: "Name or ID" },
          ...(branchList.length > 1 ? [{ name: "branch", label: "Branch", type: "select" as const, options: branchList.map(([v, l]) => ({ value: v, label: l })) }] : []),
          { name: "flag", label: "Show", type: "select", options: [{ value: "warnings", label: "With warnings" }, { value: "stale", label: "Needs recalculation" }] },
        ]} />}>
        <Table className="text-[13px]">
          <THead>
            <TR>
              <TH className="sticky left-0 z-10 bg-muted">Employee</TH><TH>Designation</TH><TH>Branch</TH>
              <TH className="text-right">Basic</TH><TH className="text-right">BRA 2</TH><TH className="text-right">BRA 1</TH><TH className="text-right">Perf. Inc.</TH>
              <TH className="text-right">EPF basis</TH><TH className="text-right">Daily basis</TH>
              <TH className="text-right">Alloc.</TH><TH className="text-right">Actual</TH><TH className="text-right">Add. days</TH><TH className="text-right">Off days</TH>
              <TH className="text-right">Add. pay</TH><TH className="text-right">No-pay</TH>
              <TH className="text-right">Earnings</TH><TH className="text-right">Deductions</TH><TH className="text-right">EPF 8%</TH><TH className="text-right">Net salary</TH>
              <TH>Status</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((r) => {
              const href = `/payroll/${periodId}/records/${r.id}`;
              return (
                <TR key={r.id} className={cn(r.needs_recalculation && "bg-warning-soft/50")}>
                  <TD className="sticky left-0 z-10 bg-card">
                    <Link href={href} className="font-medium text-primary hover:underline">{r.employee_name}</Link>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.employee_code}</div>
                  </TD>
                  <TD>{r.designation}</TD><TD>{r.branch_name}</TD>
                  <TD className="num">{formatAmount(r.basic_salary)}</TD><TD className="num">{formatAmount(r.bra2)}</TD><TD className="num">{formatAmount(r.bra1)}</TD>
                  <TD className="num">{formatAmount(r.performance_incentive)}</TD>
                  <TD className="num">{formatAmount(r.epf_salary_basis)}</TD><TD className="num">{formatAmount(r.daily_salary_basis)}</TD>
                  <TD className="num">{formatDays(r.allocated_working_days)}</TD><TD className="num">{formatDays(r.actual_working_days)}</TD>
                  <TD className="num">{Number(r.additional_working_days) ? formatDays(r.additional_working_days) : "—"}</TD>
                  <TD className="num">{Number(r.additional_off_days) ? formatDays(r.additional_off_days) : "—"}</TD>
                  <TD className="num text-success">{Number(r.additional_working_pay) ? formatAmount(r.additional_working_pay) : "—"}</TD>
                  <TD className="num text-destructive">{Number(r.no_pay_leave) ? formatAmount(r.no_pay_leave) : "—"}</TD>
                  <TD className="num">{formatAmount(r.total_earnings)}</TD><TD className="num">{formatAmount(r.total_deductions)}</TD>
                  <TD className="num">{formatAmount(r.employee_epf)}</TD>
                  <TD className={cn("num font-semibold", Number(r.net_salary) < 0 && "text-destructive")}>{formatAmount(r.net_salary)}</TD>
                  <TD>
                    {r.needs_recalculation ? <StatusBadge status="pending" label="Stale" /> : <StatusBadge status={r.status} />}
                    {r.warnings?.some((w) => w.blocking) && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-warning" />}
                  </TD>
                  <TD><Link href={href} className="text-xs text-primary hover:underline">Details</Link></TD>
                </TR>
              );
            })}
          </TBody>
          {shown.length > 0 && (
            <TFoot>
              <TR>
                <TD className="sticky left-0 bg-muted">Total ({shown.length})</TD><TD /><TD />
                <TD className="num">{formatAmount(shownTotal("basic_salary"))}</TD><TD className="num">{formatAmount(shownTotal("bra2"))}</TD><TD className="num">{formatAmount(shownTotal("bra1"))}</TD>
                <TD className="num">{formatAmount(shownTotal("performance_incentive"))}</TD><TD className="num">{formatAmount(shownTotal("epf_salary_basis"))}</TD>
                <TD className="num">{formatAmount(shownTotal("daily_salary_basis"))}</TD><TD /><TD /><TD /><TD />
                <TD className="num">{formatAmount(shownTotal("additional_working_pay"))}</TD><TD className="num">{formatAmount(shownTotal("no_pay_leave"))}</TD>
                <TD className="num">{formatAmount(shownTotal("total_earnings"))}</TD><TD className="num">{formatAmount(shownTotal("total_deductions"))}</TD>
                <TD className="num">{formatAmount(shownTotal("employee_epf"))}</TD><TD className="num">{formatAmount(shownTotal("net_salary"))}</TD><TD /><TD />
              </TR>
            </TFoot>
          )}
        </Table>
      </Section>
    </>
  );
}
