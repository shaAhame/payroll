import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/app/page-header";
import { FormDialog, SchemaForm } from "@/components/app/schema-form";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveCompany, saveDepartment } from "../actions";
import { LogoForm } from "./logo-form";

export const metadata = { title: "Company Settings" };

export default async function CompanySettingsPage() {
  await requirePageRole(["super_admin"]);
  const supabase = await createClient();
  const [{ data: c }, { data: departments }] = await Promise.all([
    supabase.from("company_settings").select("*").limit(1).single(),
    supabase.from("departments").select("*").order("name"),
  ]);
  const logo = c?.logo_path ? (await createAdminClient().storage.from("company-assets").createSignedUrl(c.logo_path, 300)).data?.signedUrl : null;
  return (
    <>
      <PageHeader title="Company Settings" description="Shown on payslips, emails and reports." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Section title="Company details">
          <div className="p-5">
            <SchemaForm schema="company" action={saveCompany} submitLabel="Save company details"
              fields={[
                { name: "company_name", label: "Company name", type: "text", required: true, full: true },
                { name: "company_address", label: "Address", type: "textarea" },
                { name: "company_email", label: "Email", type: "email" },
                { name: "company_phone", label: "Phone", type: "tel" },
                { name: "registration_number", label: "Business registration no.", type: "text" },
                { name: "employer_epf_number", label: "Employer EPF number", type: "text" },
              ]}
              defaultValues={{ company_name: c?.company_name ?? "", company_address: c?.company_address ?? "", company_email: c?.company_email ?? "", company_phone: c?.company_phone ?? "", registration_number: c?.registration_number ?? "", employer_epf_number: c?.employer_epf_number ?? "" }} />
          </div>
        </Section>
        <div className="space-y-4">
          <Section title="Logo" description="PNG or JPG, used on PDF payslips">
            <div className="space-y-4 p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo ? <img src={logo} alt="Company logo" className="h-16 max-w-[220px] object-contain" /> : <p className="text-sm text-muted-foreground">No logo uploaded.</p>}
              <LogoForm />
            </div>
          </Section>
          <Section title="Departments" actions={<FormDialog trigger={<Button size="sm"><Plus /> Add</Button>} title="Add department" schema="department" action={saveDepartment.bind(null, null)} fields={[{ name: "name", label: "Department name", type: "text", required: true }]} defaultValues={{ name: "" }} />}>
            <ul className="divide-y divide-border">
              {(departments ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  {d.name}
                  <FormDialog trigger={<Button size="icon" variant="ghost" aria-label="Edit"><Pencil /></Button>} title="Rename department" schema="department" action={saveDepartment.bind(null, d.id)} fields={[{ name: "name", label: "Department name", type: "text", required: true }]} defaultValues={{ name: d.name }} />
                </li>
              ))}
              {!departments?.length && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No departments yet.</li>}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
