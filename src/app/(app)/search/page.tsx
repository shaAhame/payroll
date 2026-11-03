import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { ADMIN_ROLES, can, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sp } from "@/lib/queries";
import { formatMonth } from "@/lib/format";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const q = sp((await searchParams).q).trim().replace(/[%,()]/g, "");
  const supabase = await createClient();
  const [{ data: emps }, { data: slips }] = q ? await Promise.all([
    supabase.from("employees").select("id, employee_code, full_name, designation, epf_number, email, employment_status, branches(name)")
      .or(`full_name.ilike.%${q}%,employee_code.ilike.%${q}%,epf_number.ilike.%${q}%,email.ilike.%${q}%,contact_number.ilike.%${q}%`).limit(50),
    can(profile, ADMIN_ROLES) ? supabase.from("payslips").select("id, reference_number, payroll_month, status, payroll_records(employee_name)").ilike("reference_number", `%${q}%`).limit(20) : Promise.resolve({ data: [] }),
  ]) : [{ data: [] }, { data: [] }];
  return (
    <>
      <PageHeader title="Search" description={q ? `Results for “${q}”` : "Search by employee name, ID, EPF number, email, phone or payslip reference."} />
      <Section title="Employees">
        {!emps?.length ? <EmptyState title="No matching employees" /> : (
          <Table>
            <THead><TR><TH>Employee ID</TH><TH>Name</TH><TH>Designation</TH><TH>Branch</TH><TH>EPF No.</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(emps as unknown as { id: string; employee_code: string; full_name: string; designation: string; epf_number: string | null; employment_status: string; branches: { name: string } | null }[]).map((e) => (
                <TR key={e.id}>
                  <TD className="font-mono text-xs">{e.employee_code}</TD>
                  <TD><Link className="font-medium text-primary hover:underline" href={`/employees/${e.id}`}>{e.full_name}</Link></TD>
                  <TD>{e.designation}</TD><TD>{e.branches?.name}</TD><TD>{e.epf_number ?? "—"}</TD><TD><StatusBadge status={e.employment_status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      {!!slips?.length && (
        <Section className="mt-4" title="Payslips">
          <Table>
            <THead><TR><TH>Reference</TH><TH>Employee</TH><TH>Month</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(slips as unknown as { id: string; reference_number: string; payroll_month: string; status: string; payroll_records: { employee_name: string } | null }[]).map((p) => (
                <TR key={p.id}>
                  <TD><a className="font-mono text-xs text-primary hover:underline" href={`/api/payslips/${p.id}`} target="_blank" rel="noreferrer">{p.reference_number}</a></TD>
                  <TD>{p.payroll_records?.employee_name}</TD><TD>{formatMonth(p.payroll_month)}</TD><TD><StatusBadge status={p.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
