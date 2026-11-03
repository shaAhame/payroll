import { PageHeader, Section } from "@/components/app/page-header";
import { SchemaForm } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonthStart } from "@/lib/format";
import { createEmployee } from "../actions";
import { employeeFields, prefixed, salaryFields } from "../fields";
import { loadEmployeeFormOptions } from "../options-loader";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  await requirePageRole(ADMIN_ROLES);
  const supabase = await createClient();
  const options = await loadEmployeeFormOptions(supabase);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Add employee" description="The employee ID is generated automatically when you save." />
      <Section title="Employee details">
        <div className="p-5">
          <SchemaForm
            schema="newEmployee"
            action={createEmployee}
            redirectTo="/employees"
            submitLabel="Register employee"
            fields={[
              ...employeeFields(options),
              { name: "_s", label: "Salary structure", type: "section" },
              ...prefixed(salaryFields, "salary"),
            ]}
            defaultValues={{
              full_name: "", contact_number: "", email: "", address: "", designation: "", department_id: "", epf_number: "",
              branch_id: "", employment_start_date: today, employment_status: "active", employment_type: "permanent", shift_id: "",
              email_notifications_enabled: true, email_verification_status: "unverified",
              salary: { basic_salary: "", bra2: "0", bra1: "0", performance_incentive: "0", effective_from: currentMonthStart(), notes: "" },
            }}
          />
        </div>
      </Section>
    </>
  );
}
