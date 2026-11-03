import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/app/page-header";
import { SchemaForm } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateEmployee } from "../../actions";
import { employeeFields } from "../../fields";
import { loadEmployeeFormOptions } from "../../options-loader";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(ADMIN_ROLES);
  const { id } = await params;
  const supabase = await createClient();
  const { data: e } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const options = await loadEmployeeFormOptions(supabase);
  return (
    <>
      <PageHeader title={`Edit ${e.full_name}`} description={`${e.employee_code} · Salary changes are made from the profile's Salary tab as new effective-dated structures.`} />
      <Section title="Employee details">
        <div className="p-5">
          <SchemaForm
            schema="employee"
            action={updateEmployee.bind(null, id)}
            redirectTo={`/employees/${id}`}
            submitLabel="Save changes"
            fields={employeeFields(options)}
            defaultValues={{
              ...e,
              contact_number: e.contact_number ?? "", email: e.email ?? "", address: e.address ?? "", department_id: e.department_id ?? "",
              epf_number: e.epf_number ?? "", shift_id: e.shift_id ?? "",
            }}
          />
        </div>
      </Section>
    </>
  );
}
