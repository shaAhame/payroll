import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, KV, PageHeader, Section } from "@/components/app/page-header";
import { LinkTabs } from "@/components/app/link-tabs";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { PhotoUpload } from "./photo-upload";
import { ADMIN_ROLES, can, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateDailySalaryBasis, calculateEPFSalary, calculateEmployeeEPF } from "@/lib/payroll/engine";
import { currentMonthStart, formatAmount, formatDate, formatDateTime, formatDays, formatLKR, formatMonth, titleCase } from "@/lib/format";
import { sp } from "@/lib/queries";
import { addSalaryStructure, setEmployeeStatus } from "../actions";
import { salaryFields } from "../fields";

export const metadata = { title: "Employee profile" };

export default async function EmployeeProfile({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requirePageRole(STAFF_ROLES);
  const { id } = await params;
  const tab = sp((await searchParams).tab) || "overview";
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees").select("*, branches(name, code), departments(name), shifts(name, start_time, end_time)").eq("id", id).maybeSingle();
  if (!e) notFound();
  const isAdmin = can(profile, ADMIN_ROLES);

  const tabs = [
    { key: "overview", label: "Overview" },
    ...(isAdmin ? [{ key: "salary", label: "Salary structure" }] : []),
    { key: "attendance", label: "Attendance" },
    ...(isAdmin ? [{ key: "payroll", label: "Payroll history" }] : []),
    { key: "commissions", label: "Commissions" },
    ...(isAdmin ? [{ key: "loans", label: "Loans & advances" }, { key: "payslips", label: "Payslips" }] : []),
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : "overview";

  let photoUrl: string | null = null;
  if (e.photo_path) {
    const { data } = await createAdminClient().storage.from("employee-photos").createSignedUrl(e.photo_path, 300);
    photoUrl = data?.signedUrl ?? null;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: structures } = isAdmin
    ? await supabase.from("salary_structures").select("*").eq("employee_id", id).order("effective_from", { ascending: false })
    : { data: [] };
  const current = (structures ?? []).find((s) => s.effective_from <= today && (!s.effective_to || s.effective_to >= today)) ?? (structures ?? [])[0];

  return (
    <>
      <PageHeader
        title={e.full_name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{e.employee_code}</span> · {e.designation} · {e.branches?.name} <StatusBadge status={e.employment_status} /></span>}
        actions={isAdmin && (
          <>
            <Button variant="outline" asChild><Link href={`/employees/${id}/edit`}><Pencil /> Edit</Link></Button>
            {e.employment_status === "active" ? (
              <ActionButton variant="outline" action={setEmployeeStatus.bind(null, id, "inactive")}
                confirm={{ title: "Deactivate employee?", description: "Inactive employees are not included in new payroll runs. Existing payroll records are not changed.", confirmLabel: "Deactivate", destructive: true }}
                reason={{ label: "Reason" }}>Deactivate</ActionButton>
            ) : (
              <ActionButton action={setEmployeeStatus.bind(null, id, "active")}
                confirm={{ title: "Activate employee?", description: "The employee will be included in new payroll runs." }}>Activate</ActionButton>
            )}
          </>
        )}
      />
      <LinkTabs tabs={tabs} active={active} base={`/employees/${id}`} />

      {active === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Personal information">
            <div className="flex items-center gap-4 border-b border-border px-5 py-4">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
                  {e.full_name.split(" ").map((p: string) => p[0]).slice(0, 2).join("")}
                </div>
              )}
              {isAdmin && <PhotoUpload employeeId={id} />}
            </div>
            <div className="divide-y divide-border px-5 py-2">
              <KV label="Employee ID" value={e.employee_code} />
              <KV label="Full name" value={e.full_name} />
              <KV label="Contact number" value={e.contact_number} />
              <KV label="Email" value={e.email} />
              <KV label="Address" value={e.address} />
            </div>
          </Section>
          <Section title="Employment information">
            <div className="divide-y divide-border px-5 py-2">
              <KV label="Designation" value={e.designation} />
              <KV label="Department" value={e.departments?.name} />
              <KV label="EPF number" value={e.epf_number} />
              <KV label="Branch" value={e.branches ? `${e.branches.name} (${e.branches.code})` : "—"} />
              <KV label="Start date" value={formatDate(e.employment_start_date)} />
              <KV label="Employment type" value={titleCase(e.employment_type)} />
              <KV label="Allocated shift" value={e.shifts ? `${e.shifts.name} · ${e.shifts.start_time.slice(0, 5)}–${e.shifts.end_time.slice(0, 5)}` : "—"} />
            </div>
          </Section>
          <Section title="Payslip email">
            <div className="divide-y divide-border px-5 py-2">
              <KV label="Email notifications" value={e.email_notifications_enabled ? "Enabled" : "Disabled"} />
              <KV label="Verification" value={<StatusBadge status={e.email_verification_status} />} />
              <KV label="Last payslip sent" value={formatDateTime(e.last_payslip_email_sent_at)} />
            </div>
          </Section>
          {isAdmin && current && <CalculationBases s={current} />}
        </div>
      )}

      {active === "salary" && isAdmin && (
        <div className="space-y-4">
          {current && <div className="grid gap-4 lg:grid-cols-3"><CalculationBases s={current} /></div>}
          <Section
            title="Salary structure history"
            description="Effective-dated. Saving a new structure closes the previous one; finalized payroll keeps its original figures."
            actions={
              <FormDialog
                trigger={<Button size="sm"><Plus /> New salary structure</Button>}
                title="New salary structure"
                description="Open payroll records from the effective month onwards are recalculated automatically."
                schema="salary"
                action={addSalaryStructure.bind(null, id)}
                fields={salaryFields}
                defaultValues={{
                  basic_salary: current?.basic_salary ?? "", bra2: current?.bra2 ?? "0", bra1: current?.bra1 ?? "0",
                  performance_incentive: current?.performance_incentive ?? "0", effective_from: currentMonthStart(), notes: "",
                }}
              />
            }
          >
            <Table>
              <THead><TR><TH>Effective from</TH><TH>Effective to</TH><TH className="text-right">Basic</TH><TH className="text-right">BRA 2</TH><TH className="text-right">BRA 1</TH><TH className="text-right">Perf. Incentive</TH><TH className="text-right">EPF basis</TH><TH className="text-right">Daily basis</TH><TH>Notes</TH></TR></THead>
              <TBody>
                {(structures ?? []).map((s) => (
                  <TR key={s.id}>
                    <TD>{formatDate(s.effective_from)}</TD>
                    <TD>{s.effective_to ? formatDate(s.effective_to) : <span className="text-success">Current</span>}</TD>
                    <TD className="num">{formatAmount(s.basic_salary)}</TD>
                    <TD className="num">{formatAmount(s.bra2)}</TD>
                    <TD className="num">{formatAmount(s.bra1)}</TD>
                    <TD className="num">{formatAmount(s.performance_incentive)}</TD>
                    <TD className="num">{formatAmount(calculateEPFSalary({ basicSalary: s.basic_salary, bra2: s.bra2, bra1: s.bra1 }).toFixed(2))}</TD>
                    <TD className="num">{formatAmount(calculateDailySalaryBasis({ basicSalary: s.basic_salary, bra2: s.bra2, bra1: s.bra1 }).toFixed(2))}</TD>
                    <TD className="max-w-xs truncate text-muted-foreground">{s.notes ?? ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>
      )}

      {active === "attendance" && <AttendanceTab employeeId={id} />}
      {active === "payroll" && isAdmin && <PayrollTab employeeId={id} />}
      {active === "commissions" && <CommissionsTab employeeId={id} />}
      {active === "loans" && isAdmin && <LoansTab employeeId={id} />}
      {active === "payslips" && isAdmin && <PayslipsTab employeeId={id} />}
    </>
  );
}

function CalculationBases({ s }: { s: { basic_salary: string; bra2: string; bra1: string; performance_incentive: string; effective_from: string } }) {
  const epf = calculateEPFSalary({ basicSalary: s.basic_salary, bra2: s.bra2, bra1: s.bra1 });
  const daily = calculateDailySalaryBasis({ basicSalary: s.basic_salary, bra2: s.bra2, bra1: s.bra1 });
  return (
    <>
      <Section title="EPF Salary Basis" description="Basic Salary + BRA 2 + BRA 1">
        <div className="divide-y divide-border px-5 py-2">
          <KV label="Basic Salary" value={formatAmount(s.basic_salary)} mono />
          <KV label="BRA 2" value={formatAmount(s.bra2)} mono />
          <KV label="BRA 1" value={formatAmount(s.bra1)} mono />
          <KV label="EPF Salary Basis" value={<strong>{formatLKR(epf.toFixed(2))}</strong>} mono />
          <KV label="Employee EPF 8%" value={formatLKR(calculateEmployeeEPF(epf).toFixed(2))} mono />
        </div>
      </Section>
      <Section title="Daily Salary Calculation Basis" description="Basic Salary + BRA 2 + BRA 1">
        <div className="divide-y divide-border px-5 py-2">
          <KV label="Basic Salary" value={formatAmount(s.basic_salary)} mono />
          <KV label="BRA 2" value={formatAmount(s.bra2)} mono />
          <KV label="BRA 1" value={formatAmount(s.bra1)} mono />
          <KV label="Daily Salary Basis" value={<strong>{formatLKR(daily.toFixed(2))}</strong>} mono />
          <KV label="Performance Incentive (paid separately)" value={formatAmount(s.performance_incentive)} mono />
          <KV label="Effective from" value={formatDate(s.effective_from)} />
        </div>
        <p className="px-5 pb-4 text-xs text-muted-foreground">Daily rate = Daily Salary Basis ÷ allocated working days for the month.</p>
      </Section>
    </>
  );
}

async function AttendanceTab({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const [{ data: summary }, { data: recent }] = await Promise.all([
    supabase.from("v_attendance_monthly").select("*").eq("employee_id", employeeId).order("month", { ascending: false }).limit(12),
    supabase.from("attendance").select("*").eq("employee_id", employeeId).order("work_date", { ascending: false }).limit(31),
  ]);
  return (
    <div className="space-y-4">
      <Section title="Monthly summary">
        {!summary?.length ? <EmptyState title="No attendance recorded" /> : (
          <Table>
            <THead><TR><TH>Month</TH><TH className="text-right">Present</TH><TH className="text-right">Approved leave</TH><TH className="text-right">No-pay</TH><TH className="text-right">Absent</TH><TH className="text-right">Weekly off</TH><TH className="text-right">Holidays</TH><TH className="text-right">Late</TH></TR></THead>
            <TBody>
              {summary.map((m) => (
                <TR key={m.month}>
                  <TD><Link className="text-primary hover:underline" href={`/attendance?tab=monthly&month=${m.month.slice(0, 7)}`}>{formatMonth(m.month)}</Link></TD>
                  <TD className="num">{m.present}</TD><TD className="num">{m.approved_leave}</TD><TD className="num">{m.no_pay_leave}</TD>
                  <TD className="num">{m.absent}</TD><TD className="num">{m.weekly_off}</TD><TD className="num">{m.public_holiday}</TD><TD className="num">{m.late_count}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <Section title="Recent days">
        <Table>
          <THead><TR><TH>Date</TH><TH>Status</TH><TH>Shift start</TH><TH>Check-in</TH><TH>Check-out</TH><TH className="text-right">Late (min)</TH><TH className="text-right">Hours</TH><TH>Remarks</TH></TR></THead>
          <TBody>
            {(recent ?? []).map((a) => (
              <TR key={a.id}>
                <TD>{formatDate(a.work_date)}</TD><TD><StatusBadge status={a.status} /></TD>
                <TD>{a.shift_start_time?.slice(0, 5) ?? "—"}</TD><TD>{a.check_in_time?.slice(0, 5) ?? "—"}</TD><TD>{a.check_out_time?.slice(0, 5) ?? "—"}</TD>
                <TD className="num">{a.late_minutes || "—"}{a.late_waived && " (waived)"}</TD><TD className="num">{a.working_hours ?? "—"}</TD>
                <TD className="max-w-xs truncate text-muted-foreground">{a.remarks}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </div>
  );
}

async function PayrollTab({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("payroll_records").select("id, payroll_period_id, payroll_month, total_earnings, total_deductions, employee_epf, net_salary, status, actual_working_days, allocated_working_days")
    .eq("employee_id", employeeId).order("payroll_month", { ascending: false });
  return (
    <Section title="Payroll history">
      {!data?.length ? <EmptyState title="No payroll yet" /> : (
        <Table>
          <THead><TR><TH>Month</TH><TH className="text-right">Days (actual/allocated)</TH><TH className="text-right">Total earnings</TH><TH className="text-right">Total deductions</TH><TH className="text-right">EPF 8%</TH><TH className="text-right">Net salary</TH><TH>Status</TH></TR></THead>
          <TBody>
            {data.map((r) => (
              <TR key={r.id}>
                <TD><Link className="text-primary hover:underline" href={`/payroll/${r.payroll_period_id}/records/${r.id}`}>{formatMonth(r.payroll_month)}</Link></TD>
                <TD className="num">{formatDays(r.actual_working_days)} / {formatDays(r.allocated_working_days)}</TD>
                <TD className="num">{formatAmount(r.total_earnings)}</TD><TD className="num">{formatAmount(r.total_deductions)}</TD>
                <TD className="num">{formatAmount(r.employee_epf)}</TD><TD className="num font-semibold">{formatAmount(r.net_salary)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

async function CommissionsTab({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("commission_records").select("*").eq("employee_id", employeeId).order("commission_date", { ascending: false }).limit(100);
  return (
    <Section title="Commission history">
      {!data?.length ? <EmptyState title="No commissions recorded" /> : (
        <Table>
          <THead><TR><TH>Date</TH><TH>Type</TH><TH>Transaction</TH><TH className="text-right">Amount</TH><TH>Payroll month</TH><TH>Status</TH><TH>Released</TH></TR></THead>
          <TBody>
            {data.map((c) => (
              <TR key={c.id}>
                <TD>{formatDate(c.commission_date)}</TD><TD>{titleCase(c.commission_type)}</TD><TD className="font-mono text-xs">{c.transaction_id}</TD>
                <TD className="num">{formatAmount(c.amount)}</TD><TD>{formatMonth(c.payroll_month)}</TD><TD><StatusBadge status={c.status} /></TD>
                <TD>{c.released_date ? formatDate(c.released_date) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

async function LoansTab({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const [{ data: loans }, { data: advances }] = await Promise.all([
    supabase.from("employee_loans").select("*, loan_repayments(payroll_month, amount, balance_after)").eq("employee_id", employeeId).order("start_date", { ascending: false }),
    supabase.from("salary_advances").select("*, advance_repayments(payroll_month, amount, balance_after)").eq("employee_id", employeeId).order("advance_date", { ascending: false }),
  ]);
  const Plan = ({ title, rows, amountKey, dateKey }: { title: string; rows: Record<string, unknown>[]; amountKey: string; dateKey: string }) => (
    <Section title={title}>
      {!rows.length ? <EmptyState title="None" /> : (
        <Table>
          <THead><TR><TH>Date</TH><TH className="text-right">Amount</TH><TH className="text-right">Monthly</TH><TH className="text-right">Outstanding</TH><TH>Status</TH><TH>Repayments</TH></TR></THead>
          <TBody>
            {rows.map((r) => {
              const reps = ((r.loan_repayments ?? r.advance_repayments) as { payroll_month: string; amount: string }[]) ?? [];
              return (
                <TR key={String(r.id)}>
                  <TD>{formatDate(String(r[dateKey]))}</TD><TD className="num">{formatAmount(String(r[amountKey]))}</TD>
                  <TD className="num">{formatAmount(String(r.monthly_repayment))}</TD><TD className="num font-medium">{formatAmount(String(r.outstanding_balance))}</TD>
                  <TD><StatusBadge status={String(r.status)} /></TD>
                  <TD className="text-xs text-muted-foreground">{reps.length ? reps.map((p) => `${formatMonth(p.payroll_month)}: ${formatAmount(p.amount)}`).join(" · ") : "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Section>
  );
  return (
    <div className="space-y-4">
      <Plan title="Loans" rows={loans ?? []} amountKey="original_amount" dateKey="start_date" />
      <Plan title="Salary advances" rows={advances ?? []} amountKey="amount" dateKey="advance_date" />
    </div>
  );
}

async function PayslipsTab({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("payslips").select("id, reference_number, payroll_month, status, generated_at").eq("employee_id", employeeId).order("payroll_month", { ascending: false });
  return (
    <Section title="Payslips">
      {!data?.length ? <EmptyState title="No payslips yet" description="Payslips are generated when payroll is finalized." /> : (
        <Table>
          <THead><TR><TH>Month</TH><TH>Reference</TH><TH>Status</TH><TH>Generated</TH><TH></TH></TR></THead>
          <TBody>
            {data.map((p) => (
              <TR key={p.id}>
                <TD>{formatMonth(p.payroll_month)}</TD><TD className="font-mono text-xs">{p.reference_number}</TD><TD><StatusBadge status={p.status} /></TD>
                <TD>{formatDateTime(p.generated_at)}</TD>
                <TD className="text-right">{p.status === "generated" && <Button variant="outline" size="sm" asChild><a href={`/api/payslips/${p.id}`} target="_blank" rel="noreferrer">Download PDF</a></Button>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
