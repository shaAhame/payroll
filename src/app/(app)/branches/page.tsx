import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog, type FieldDef } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSelectedMonth } from "@/lib/month";
import { formatAmount, formatDays, formatMonth } from "@/lib/format";
import { deleteShift, saveBranch, saveShift, setBranchActive } from "./actions";

export const metadata = { title: "Branch Management" };

export default async function BranchesPage() {
  const profile = await requirePageRole(ADMIN_ROLES);
  const isSuper = profile.role === "super_admin";
  const supabase = await createClient();
  const month = await getSelectedMonth();
  const [{ data: branches }, { data: shifts }, { data: managers }, { data: emps }, { data: summary }, { data: settings }] = await Promise.all([
    supabase.from("branches").select("*, shifts!branches_default_shift_fk(name, start_time, end_time)").order("name"),
    supabase.from("shifts").select("*, branches!shifts_branch_id_fkey(name)").order("name"),
    supabase.from("profiles").select("id, full_name, role").in("role", ["branch_manager", "super_admin", "hr_manager"]).eq("is_active", true),
    supabase.from("employees").select("branch_id, employment_status").limit(10000),
    supabase.from("v_payroll_monthly_branch").select("*").eq("payroll_month", month),
    supabase.from("payroll_settings").select("default_working_days").limit(1).maybeSingle(),
  ]);
  const shiftOptions = (shifts ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`, group: s.branches?.name ?? "All branches" }));
  const fields: FieldDef[] = [
    { name: "name", label: "Branch name", type: "text", required: true },
    { name: "code", label: "Branch code", type: "text", required: true, hint: "e.g. CMB01" },
    { name: "address", label: "Address", type: "textarea" },
    { name: "manager_profile_id", label: "Branch manager", type: "select", options: (managers ?? []).map((m) => ({ value: m.id, label: m.full_name })) },
    { name: "allocated_working_days", label: "Default allocated working days", type: "number", hint: `Blank = company default (${formatDays(settings?.default_working_days)})` },
    { name: "default_shift_id", label: "Default shift", type: "select", options: shiftOptions },
  ];
  const count = (id: string) => (emps ?? []).filter((e) => e.branch_id === id && e.employment_status === "active").length;
  const sum = (id: string) => (summary ?? []).find((s) => s.branch_id === id);

  return (
    <>
      <PageHeader title="Branch Management" description={`Branch-specific working-day allocations and shifts. Payroll summary for ${formatMonth(month)}.`}
        actions={isSuper && <FormDialog trigger={<Button><Plus /> Add branch</Button>} title="Add branch" schema="branch" action={saveBranch.bind(null, null)} fields={fields}
          defaultValues={{ name: "", code: "", address: "", manager_profile_id: "", allocated_working_days: "", default_shift_id: "" }} />} />
      <Section title="Branches">
        {!branches?.length ? <EmptyState title="No branches yet" description="Add your first branch before registering employees." /> : (
          <Table>
            <THead><TR><TH>Branch</TH><TH>Code</TH><TH>Manager</TH><TH className="text-right">Working days</TH><TH>Default shift</TH><TH className="text-right">Active employees</TH><TH className="text-right">Net payroll ({formatMonth(month)})</TH><TH>Status</TH><TH /></TR></THead>
            <TBody>
              {branches.map((b) => (
                <TR key={b.id}>
                  <TD><div className="font-medium">{b.name}</div><div className="max-w-xs truncate text-xs text-muted-foreground">{b.address}</div></TD>
                  <TD className="font-mono text-xs">{b.code}</TD>
                  <TD>{managers?.find((m) => m.id === b.manager_profile_id)?.full_name ?? "—"}</TD>
                  <TD className="num">{b.allocated_working_days ? formatDays(b.allocated_working_days) : <span className="text-muted-foreground">{formatDays(settings?.default_working_days)} (default)</span>}</TD>
                  <TD>{b.shifts ? `${b.shifts.name} ${b.shifts.start_time.slice(0, 5)}` : "—"}</TD>
                  <TD className="num"><Link className="text-primary hover:underline" href={`/employees?branch=${b.id}`}>{count(b.id)}</Link></TD>
                  <TD className="num">{sum(b.id) ? formatAmount(sum(b.id).net_salary) : "—"}</TD>
                  <TD><StatusBadge status={b.is_active ? "active" : "inactive"} /></TD>
                  <TD className="text-right">
                    {isSuper && (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger={<Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button>} title={`Edit ${b.name}`} schema="branch" action={saveBranch.bind(null, b.id)} fields={fields}
                          defaultValues={{ ...b, address: b.address ?? "", manager_profile_id: b.manager_profile_id ?? "", allocated_working_days: b.allocated_working_days ?? "", default_shift_id: b.default_shift_id ?? "" }} />
                        <ActionButton size="sm" variant="ghost" action={setBranchActive.bind(null, b.id, !b.is_active)}
                          confirm={{ title: b.is_active ? "Deactivate branch?" : "Activate branch?", description: b.is_active ? "A branch with active employees cannot be deactivated." : "The branch becomes available again." }}>
                          {b.is_active ? "Deactivate" : "Activate"}
                        </ActionButton>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <Section className="mt-4" title="Shift schedules" description="A branch can have several shifts. Each employee gets one on their profile; employees without one use the branch default. Late arrivals are counted from the shift start."
        actions={<FormDialog trigger={<Button size="sm"><Plus /> Add shift</Button>} title="Add shift" schema="shift" action={saveShift.bind(null, null)}
          fields={[{ name: "name", label: "Shift name", type: "text", required: true }, { name: "branch_id", label: "Branch", type: "select", options: (branches ?? []).map((b) => ({ value: b.id, label: b.name })), placeholder: "All branches" },
            { name: "start_time", label: "Start time", type: "time", required: true }, { name: "end_time", label: "End time", type: "time", required: true }]}
          defaultValues={{ name: "", branch_id: "", start_time: "09:00", end_time: "18:00" }} />}>
        <Table>
          <THead><TR><TH>Shift</TH><TH>Branch</TH><TH>Start</TH><TH>End</TH><TH /></TR></THead>
          <TBody>
            {(shifts ?? []).map((s) => (
              <TR key={s.id}>
                <TD className="font-medium">{s.name}</TD><TD>{s.branches?.name ?? "All branches"}</TD><TD>{s.start_time.slice(0, 5)}</TD><TD>{s.end_time.slice(0, 5)}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                  <ActionButton size="icon" variant="ghost" aria-label="Delete shift" action={deleteShift.bind(null, s.id)}
                    confirm={{ title: `Delete ${s.name}?`, description: "Employees on this shift fall back to their branch's default shift. Attendance already recorded keeps its shift start time.", destructive: true, confirmLabel: "Delete" }}><Trash2 /></ActionButton>
                  <FormDialog trigger={<Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button>} title="Edit shift" schema="shift" action={saveShift.bind(null, s.id)}
                    fields={[{ name: "name", label: "Shift name", type: "text", required: true }, { name: "branch_id", label: "Branch", type: "select", options: (branches ?? []).map((b) => ({ value: b.id, label: b.name })), placeholder: "All branches" },
                      { name: "start_time", label: "Start time", type: "time", required: true }, { name: "end_time", label: "End time", type: "time", required: true }]}
                    defaultValues={{ name: s.name, branch_id: s.branch_id ?? "", start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) }} />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
