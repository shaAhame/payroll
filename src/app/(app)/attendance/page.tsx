import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { LinkTabs } from "@/components/app/link-tabs";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog } from "@/components/app/schema-form";
import { Button } from "@/components/ui/button";
import { ADMIN_ROLES, can, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveMonth } from "@/lib/month";
import { listBranches, listEmployeesLite, sp } from "@/lib/queries";
import { branchOptions, employeeOptions } from "@/lib/options";
import { formatDate, formatDays, formatMonth, monthEnd } from "@/lib/format";
import { AttendanceDialog, BulkMarkDialog, ImportPanel } from "./client";
import { deleteAllocation, deleteAttendance, saveAllocation, setLateWaiver } from "./actions";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const tab = sp(params.tab) || "daily";
  const isAdmin = can(profile, ADMIN_ROLES);
  const supabase = await createClient();
  const branchFilter = profile.role === "branch_manager" ? profile.branch_id : sp(params.branch) || null;
  const [branches, employees, month] = await Promise.all([
    listBranches(supabase), listEmployeesLite(supabase, { branchId: branchFilter }), resolveMonth(params.month),
  ]);
  const empOptions = employeeOptions(employees, branches);
  const tabs = [
    { key: "daily", label: "Daily attendance" }, { key: "monthly", label: "Monthly summary" },
    ...(isAdmin ? [{ key: "allocations", label: "Working-day allocation" }] : []), { key: "import", label: "Import" },
  ];
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Attendance Management" description="Attendance drives actual working days, additional working pay, no-pay leave and late deductions."
        actions={<>
          <BulkMarkDialog branches={profile.role === "branch_manager" ? [] : branchOptions(branches)} defaultDate={sp(params.date) || today} />
          <AttendanceDialog employees={empOptions} initial={{ work_date: sp(params.date) || today, employee_id: "" }} />
        </>} />
      <LinkTabs tabs={tabs} active={tab} base={`/attendance?${new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "tab" && typeof v === "string") as [string, string][]).toString()}`} />
      {tab === "daily" && <Daily params={params} today={today} branchFilter={branchFilter} empOptions={empOptions} isAdmin={isAdmin} branches={branches} isBM={profile.role === "branch_manager"} month={month} />}
      {tab === "monthly" && <Monthly month={month} branchFilter={branchFilter} branches={branches} isBM={profile.role === "branch_manager"} />}
      {tab === "allocations" && isAdmin && <Allocations month={month} branches={branches} empOptions={empOptions} />}
      {tab === "import" && <Section title="Import attendance from Excel or CSV"><ImportPanel isBranchManager={profile.role === "branch_manager"} /></Section>}
    </>
  );
}

async function Daily({ params, today, branchFilter, empOptions, isAdmin, branches, isBM, month }: {
  params: Record<string, string | string[] | undefined>; today: string; branchFilter: string | null; empOptions: { value: string; label: string }[];
  isAdmin: boolean; branches: { id: string; name: string }[]; isBM: boolean; month: string;
}) {
  const supabase = await createClient();
  const employee = sp(params.employee);
  const date = sp(params.date) || today;
  let q = supabase.from("attendance").select("*, employees(employee_code, full_name), branches(name)").order("work_date", { ascending: false }).limit(1000);
  q = employee ? q.eq("employee_id", employee).gte("work_date", month).lte("work_date", monthEnd(month)) : q.eq("work_date", date);
  if (branchFilter) q = q.eq("branch_id", branchFilter);
  if (sp(params.status)) q = q.eq("status", sp(params.status));
  if (sp(params.late) === "1") q = q.gt("late_minutes", 0);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; employee_id: string; work_date: string; status: string; shift_start_time: string | null; check_in_time: string | null; check_out_time: string | null;
    late_minutes: number; late_waived: boolean; late_waiver_reason: string | null; working_hours: string | null; is_additional_working_day: boolean; is_off_day: boolean; remarks: string | null;
    employees: { employee_code: string; full_name: string } | null; branches: { name: string } | null;
  }[];
  const marked = new Set(rows.map((r) => r.employee_id));
  const unmarked = employee ? [] : empOptions.filter((e) => !marked.has(e.value));
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-4">
      {!employee && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Present" value={count("present")} tone="success" />
          <StatCard label="Late arrivals" value={rows.filter((r) => r.late_minutes > 0).length} tone="warning" />
          <StatCard label="Absent / No-pay" value={count("absent") + count("no_pay_leave")} tone="danger" />
          <StatCard label="Leave / Off / Holiday" value={count("approved_leave") + count("weekly_off") + count("public_holiday")} />
          <StatCard label="Not marked" value={unmarked.length} hint="active employees" />
        </div>
      )}
      <Section title={employee ? `${empOptions.find((e) => e.value === employee)?.label ?? "Employee"} · ${formatMonth(month)}` : `Attendance for ${formatDate(date)}`}
        actions={<FilterBar filters={[
          ...(employee ? [{ name: "month", label: "Month", type: "month" as const, defaultValue: month }] : [{ name: "date", label: "Date", type: "date" as const, defaultValue: date }]),
          ...(!isBM ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
          { name: "status", label: "Status", type: "select", options: [{ value: "present", label: "Present" }, { value: "absent", label: "Absent" }, { value: "no_pay_leave", label: "No-Pay Leave" }, { value: "approved_leave", label: "Approved Leave" }, { value: "weekly_off", label: "Weekly Off" }, { value: "public_holiday", label: "Public Holiday" }] },
          { name: "late", label: "Late only", type: "select", options: [{ value: "1", label: "Late arrivals" }] },
        ]} />}>
        {!rows.length ? <EmptyState title="No attendance recorded" description="Add attendance manually, import a file, or mark a holiday." /> : (
          <Table>
            <THead><TR><TH>Employee</TH>{employee ? <TH>Date</TH> : <TH>Branch</TH>}<TH>Status</TH><TH>Shift start</TH><TH>Check-in</TH><TH>Check-out</TH><TH className="text-right">Late (min)</TH><TH className="text-right">Hours</TH><TH>Flags</TH><TH>Remarks</TH><TH /></TR></THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/employees/${a.employee_id}?tab=attendance`}>{a.employees?.full_name}</Link><div className="font-mono text-[11px] text-muted-foreground">{a.employees?.employee_code}</div></TD>
                  <TD>{employee ? formatDate(a.work_date) : a.branches?.name}</TD>
                  <TD><StatusBadge status={a.status} /></TD>
                  <TD>{a.shift_start_time?.slice(0, 5) ?? "—"}</TD><TD>{a.check_in_time?.slice(0, 5) ?? "—"}</TD><TD>{a.check_out_time?.slice(0, 5) ?? "—"}</TD>
                  <TD className="num">{a.late_minutes ? <span className={a.late_waived ? "text-muted-foreground line-through" : "font-medium text-warning"}>{a.late_minutes}</span> : "—"}</TD>
                  <TD className="num">{a.working_hours ?? "—"}</TD>
                  <TD className="space-x-1">{a.is_additional_working_day && <StatusBadge status="approved" label="Additional day" />}{a.late_waived && <StatusBadge status="cancelled" label="Waived" />}</TD>
                  <TD className="max-w-[180px] truncate text-xs text-muted-foreground" title={a.late_waiver_reason ?? a.remarks ?? ""}>{a.late_waiver_reason ?? a.remarks}</TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && a.late_minutes > 0 && (a.late_waived
                        ? <ActionButton size="sm" variant="ghost" action={setLateWaiver.bind(null, a.id, false)}>Unwaive</ActionButton>
                        : <ActionButton size="sm" variant="ghost" action={setLateWaiver.bind(null, a.id, true)} reason={{ label: "Reason for waiving" }}
                            confirm={{ title: "Waive late deduction?", description: `${a.employees?.full_name} was ${a.late_minutes} minute(s) late on ${formatDate(a.work_date)}.` }}>Waive</ActionButton>)}
                      <AttendanceDialog icon="edit" id={a.id} employees={empOptions}
                        initial={{ employee_id: a.employee_id, work_date: a.work_date, status: a.status, shift_start_time: a.shift_start_time?.slice(0, 5) ?? "", check_in_time: a.check_in_time?.slice(0, 5) ?? "", check_out_time: a.check_out_time?.slice(0, 5) ?? "", is_additional_working_day: a.is_additional_working_day, remarks: a.remarks ?? "" }} />
                      <ActionButton size="icon" variant="ghost" aria-label="Delete" action={deleteAttendance.bind(null, a.id)} confirm={{ title: "Delete attendance?", description: "The employee's open payroll is recalculated.", destructive: true, confirmLabel: "Delete" }}><Trash2 /></ActionButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      {unmarked.length > 0 && (
        <Section title={`Not marked on ${formatDate(date)}`} description="Active employees without an attendance record for this date.">
          <div className="flex flex-wrap gap-2 p-4">
            {unmarked.slice(0, 120).map((e) => <AttendanceDialog key={e.value} employees={empOptions} triggerLabel={e.label} initial={{ employee_id: e.value, work_date: date }} />)}
          </div>
        </Section>
      )}
    </div>
  );
}

async function Monthly({ month, branchFilter, branches, isBM }: { month: string; branchFilter: string | null; branches: { id: string; name: string; allocated_working_days: string | null }[]; isBM: boolean }) {
  const supabase = await createClient();
  let q = supabase.from("v_attendance_monthly").select("*").eq("month", month);
  if (branchFilter) q = q.eq("branch_id", branchFilter);
  let eq = supabase.from("employees").select("id, employee_code, full_name, branch_id").limit(5000);
  if (branchFilter) eq = eq.eq("branch_id", branchFilter);
  const [{ data: summary }, { data: emps }, { data: alloc }, { data: settings }] = await Promise.all([
    q, eq, supabase.from("working_day_allocations").select("employee_id, branch_id, allocated_days").eq("payroll_month", month),
    isBM ? Promise.resolve({ data: null }) : supabase.from("payroll_settings").select("default_working_days, approved_leave_treatment, public_holiday_treatment, weekly_off_treatment").limit(1).maybeSingle(),
  ]);
  const emp = new Map((emps ?? []).map((e) => [e.id, e]));
  const allocFor = (e: { id: string; branch_id: string }) =>
    alloc?.find((a) => a.employee_id === e.id)?.allocated_days ?? alloc?.find((a) => !a.employee_id && a.branch_id === e.branch_id)?.allocated_days
    ?? branches.find((b) => b.id === e.branch_id)?.allocated_working_days ?? settings?.default_working_days ?? null;
  const worked = (r: Record<string, number>) => r.present + (settings?.approved_leave_treatment !== "unpaid" ? r.approved_leave : 0)
    + (settings?.public_holiday_treatment === "paid" ? r.public_holiday : 0) + (settings?.weekly_off_treatment === "counts_as_worked" ? r.weekly_off : 0);
  const rows = (summary ?? []).map((r) => ({ ...r, e: emp.get(r.employee_id) })).filter((r) => r.e).sort((a, b) => a.e!.employee_code.localeCompare(b.e!.employee_code));
  return (
    <Section title={`Monthly summary · ${formatMonth(month)}`} description="Actual working days follow the leave/holiday treatment in Payroll Settings."
      actions={<FilterBar filters={[{ name: "month", label: "Month", type: "month", defaultValue: month }, ...(!isBM ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : [])]} />}>
      {!rows.length ? <EmptyState title="No attendance for this month" /> : (
        <Table>
          <THead><TR><TH>Employee</TH><TH className="text-right">Present</TH><TH className="text-right">Approved leave</TH><TH className="text-right">Weekly off</TH><TH className="text-right">Holidays</TH><TH className="text-right">Absent</TH><TH className="text-right">No-pay</TH><TH className="text-right">Late</TH>{!isBM && <><TH className="text-right">Allocated</TH><TH className="text-right">Actual</TH><TH className="text-right">Difference</TH></>}</TR></THead>
          <TBody>
            {rows.map((r) => {
              const a = allocFor(r.e!);
              const w = worked(r);
              const diff = a ? w - Number(a) : null;
              return (
                <TR key={r.employee_id}>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/attendance?tab=daily&employee=${r.employee_id}&month=${month.slice(0, 7)}`}>{r.e!.full_name}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.e!.employee_code}</div></TD>
                  <TD className="num">{r.present}</TD><TD className="num">{r.approved_leave}</TD><TD className="num">{r.weekly_off}</TD><TD className="num">{r.public_holiday}</TD>
                  <TD className="num">{r.absent}</TD><TD className="num">{r.no_pay_leave}</TD><TD className="num">{r.late_count}</TD>
                  {!isBM && <><TD className="num">{a ? formatDays(a) : "—"}</TD><TD className="num">{w}</TD>
                    <TD className={`num font-medium ${diff && diff > 0 ? "text-success" : diff && diff < 0 ? "text-destructive" : ""}`}>{diff === null ? "—" : diff > 0 ? `+${formatDays(diff)} additional` : diff < 0 ? `${formatDays(-diff)} off` : "0"}</TD></>}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Section>
  );
}

async function Allocations({ month, branches, empOptions }: { month: string; branches: { id: string; name: string; code: string; allocated_working_days: string | null }[]; empOptions: { value: string; label: string }[] }) {
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from("working_day_allocations").select("*, branches(name), employees(full_name, employee_code)").eq("payroll_month", month).order("created_at"),
    supabase.from("payroll_settings").select("default_working_days").limit(1).maybeSingle(),
  ]);
  return (
    <div className="space-y-4">
      <Section title={`Working-day allocation · ${formatMonth(month)}`}
        description={`Priority: employee allocation → branch allocation for the month → branch default → company default (${formatDays(settings?.default_working_days)} days).`}
        actions={<>
          <FilterBar filters={[{ name: "month", label: "Month", type: "month", defaultValue: month }]} />
          <FormDialog trigger={<Button size="sm" className="self-end">Set allocation</Button>} title="Set allocated working days" schema="allocation" action={saveAllocation}
            fields={[
              { name: "payroll_month", label: "Payroll month", type: "month", required: true },
              { name: "scope", label: "Applies to", type: "select", required: true, options: [{ value: "branch", label: "A branch" }, { value: "employee", label: "An employee" }] },
              { name: "branch_id", label: "Branch", type: "select", options: branchOptions(branches), showWhen: { field: "scope", in: ["branch"] } },
              { name: "employee_id", label: "Employee", type: "select", options: empOptions, showWhen: { field: "scope", in: ["employee"] } },
              { name: "allocated_days", label: "Allocated working days", type: "number", required: true },
              { name: "notes", label: "Notes", type: "textarea" },
            ]}
            defaultValues={{ payroll_month: month.slice(0, 7), scope: "branch", branch_id: "", employee_id: "", allocated_days: "", notes: "" }} />
        </>}>
        <Table>
          <THead><TR><TH>Applies to</TH><TH className="text-right">Allocated days</TH><TH>Source</TH><TH>Notes</TH><TH /></TR></THead>
          <TBody>
            {(data ?? []).map((a) => (
              <TR key={a.id}>
                <TD>{a.employees ? `${a.employees.full_name} (${a.employees.employee_code})` : a.branches?.name}</TD>
                <TD className="num font-medium">{formatDays(a.allocated_days)}</TD>
                <TD>{a.employee_id ? "Employee · this month" : "Branch · this month"}</TD>
                <TD className="text-muted-foreground">{a.notes}</TD>
                <TD className="text-right"><ActionButton size="icon" variant="ghost" aria-label="Remove" action={deleteAllocation.bind(null, a.id)} confirm={{ title: "Remove allocation?", description: "The next level in the priority order applies and open payroll is recalculated.", destructive: true }}><Trash2 /></ActionButton></TD>
              </TR>
            ))}
            {branches.filter((b) => !(data ?? []).some((a) => !a.employee_id && a.branch_id === b.id)).map((b) => (
              <TR key={b.id} className="text-muted-foreground">
                <TD>{b.name}</TD><TD className="num">{formatDays(b.allocated_working_days ?? settings?.default_working_days)}</TD>
                <TD>{b.allocated_working_days ? "Branch default" : "Company default"}</TD><TD /><TD />
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </div>
  );
}
