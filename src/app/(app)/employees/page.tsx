import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar, Pagination } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { can, ADMIN_ROLES, requirePageRole, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listBranches, pageRange, sp } from "@/lib/queries";
import { EMPLOYMENT_STATUS } from "@/lib/options";
import { formatDate, titleCase } from "@/lib/format";

export const metadata = { title: "Employees" };
const PAGE = 25;

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(STAFF_ROLES);
  const params = await searchParams;
  const supabase = await createClient();
  const branches = await listBranches(supabase, true);
  const { data: departments } = await supabase.from("departments").select("id, name").order("name");
  const { page, from, to } = pageRange(Number(sp(params.page)), PAGE);

  let q = supabase.from("employees")
    .select("id, employee_code, full_name, designation, epf_number, email, employment_status, employment_type, employment_start_date, branches(name), departments(name)", { count: "exact" })
    .order("employee_code");
  const search = sp(params.q).trim();
  if (search) q = q.or(`full_name.ilike.%${search.replace(/[%,()]/g, "")}%,employee_code.ilike.%${search.replace(/[%,()]/g, "")}%,epf_number.ilike.%${search.replace(/[%,()]/g, "")}%`);
  if (sp(params.branch)) q = q.eq("branch_id", sp(params.branch));
  if (sp(params.status)) q = q.eq("employment_status", sp(params.status));
  if (sp(params.department)) q = q.eq("department_id", sp(params.department));
  const { data, count } = await q.range(from, to);
  const rows = (data ?? []) as unknown as {
    id: string; employee_code: string; full_name: string; designation: string; epf_number: string | null; email: string | null;
    employment_status: string; employment_type: string; employment_start_date: string; branches: { name: string } | null; departments: { name: string } | null;
  }[];
  const isAdmin = can(profile, ADMIN_ROLES);

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${count ?? 0} employee record${count === 1 ? "" : "s"}${profile.role === "branch_manager" ? " in your branch" : ""}`}
        actions={isAdmin && <Button asChild><Link href="/employees/new"><Plus /> Add employee</Link></Button>}
      />
      <Section
        title="Employee directory"
        actions={
          <FilterBar filters={[
            { name: "q", label: "Search", type: "text", placeholder: "Name, ID or EPF no." },
            ...(profile.role !== "branch_manager" ? [{ name: "branch", label: "Branch", type: "select" as const, options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
            { name: "department", label: "Department", type: "select", options: (departments ?? []).map((d) => ({ value: d.id, label: d.name })) },
            { name: "status", label: "Status", type: "select", options: EMPLOYMENT_STATUS },
          ]} />
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No employees found" description={search ? "Try a different search." : "Register your first employee to get started."}
            action={isAdmin && <Button asChild size="sm"><Link href="/employees/new"><Plus /> Add employee</Link></Button>} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee ID</TH><TH>Name</TH><TH>Designation</TH><TH>Department</TH><TH>Branch</TH><TH>EPF No.</TH><TH>Type</TH><TH>Start date</TH><TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((e) => (
                <TR key={e.id}>
                  <TD className="font-mono text-xs">{e.employee_code}</TD>
                  <TD>
                    <Link href={`/employees/${e.id}`} className="font-medium text-primary hover:underline">{e.full_name}</Link>
                    {e.email && <div className="text-xs text-muted-foreground">{e.email}</div>}
                  </TD>
                  <TD>{e.designation}</TD>
                  <TD>{e.departments?.name ?? "—"}</TD>
                  <TD>{e.branches?.name ?? "—"}</TD>
                  <TD>{e.epf_number ?? "—"}</TD>
                  <TD>{titleCase(e.employment_type)}</TD>
                  <TD>{formatDate(e.employment_start_date)}</TD>
                  <TD><StatusBadge status={e.employment_status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={count ?? 0} />
      </Section>
    </>
  );
}
