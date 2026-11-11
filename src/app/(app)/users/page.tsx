import { Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { FormDialog, type FieldDef } from "@/components/app/schema-form";
import { requirePageRole, ROLE_LABELS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listBranches, listEmployeesLite } from "@/lib/queries";
import { branchOptions, employeeOptions } from "@/lib/options";
import { formatDate } from "@/lib/format";
import { inviteUser, sendPasswordReset, setUserActive, updateUser } from "./actions";

export const metadata = { title: "User Management" };

export default async function UsersPage() {
  const me = await requirePageRole(["super_admin"]);
  const supabase = await createClient();
  const [{ data: users }, branches, employees] = await Promise.all([
    supabase.from("profiles").select("*, branches!profiles_branch_id_fkey(name), employees!profiles_employee_id_fkey(employee_code, full_name)").order("role").order("full_name"),
    listBranches(supabase), listEmployeesLite(supabase),
  ]);
  const fields = (edit: boolean): FieldDef[] => [
    { name: "full_name", label: "Full name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true, disabled: edit },
    { name: "role", label: "Role", type: "select", required: true, options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) },
    { name: "branch_id", label: "Branch", type: "select", options: branchOptions(branches), showWhen: { field: "role", in: ["branch_manager"] } },
    { name: "employee_id", label: "Employee record", type: "select", options: employeeOptions(employees, branches), showWhen: { field: "role", in: ["employee"] }, hint: "The employee will only see their own data" },
  ];

  return (
    <>
      <PageHeader title="User Management" description="Super Admin: full access · HR / Payroll Manager: payroll operations · Branch Manager: own branch attendance and submissions · Employee: self-service portal."
        actions={<FormDialog trigger={<Button><UserPlus /> Invite user</Button>} title="Invite user" description="They receive an email to set their password." schema="user" action={inviteUser} fields={fields(false)}
          defaultValues={{ full_name: "", email: "", role: "hr_manager", branch_id: "", employee_id: "" }} />} />
      <Section title="Users">
        <Table>
          <THead><TR><TH>Name</TH><TH>Email</TH><TH>Role</TH><TH>Scope</TH><TH>Created</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>
            {(users ?? []).map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.full_name}{u.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</TD>
                <TD>{u.email}</TD><TD>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}</TD>
                <TD className="text-muted-foreground">{u.branches?.name ?? (u.employees ? `${u.employees.full_name} (${u.employees.employee_code})` : "All")}</TD>
                <TD>{formatDate(u.created_at)}</TD><TD><StatusBadge status={u.is_active ? "active" : "inactive"} /></TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <FormDialog trigger={<Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button>} title={`Edit ${u.full_name}`} schema="user" action={updateUser.bind(null, u.id)} fields={fields(true)}
                      defaultValues={{ full_name: u.full_name, email: u.email, role: u.role, branch_id: u.branch_id ?? "", employee_id: u.employee_id ?? "" }} />
                    <ActionButton size="sm" variant="ghost" action={sendPasswordReset.bind(null, u.email)} confirm={{ title: "Send password reset?", description: `A reset link is emailed to ${u.email}.` }}>Reset password</ActionButton>
                    {u.id !== me.id && (
                      <ActionButton size="sm" variant="ghost" action={setUserActive.bind(null, u.id, !u.is_active)}
                        confirm={{ title: u.is_active ? "Deactivate user?" : "Activate user?", description: u.is_active ? "They can no longer sign in." : "They can sign in again.", destructive: u.is_active }}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </ActionButton>
                    )}
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
