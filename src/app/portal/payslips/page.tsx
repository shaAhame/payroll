import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAmount, formatDays, formatMonth } from "@/lib/format";

export const metadata = { title: "My Payslips" };

export default async function MyPayslips() {
  await requirePageRole(["employee"]);
  const supabase = await createClient();
  const { data } = await supabase.from("payroll_records")
    .select("id, payroll_month, total_earnings, total_deductions, employee_epf, net_salary, allocated_working_days, actual_working_days, payslips(id, reference_number, status)")
    .eq("status", "finalized").order("payroll_month", { ascending: false });
  return (
    <>
      <PageHeader title="My Payslips" description="Your finalized payroll history. Payslip downloads use a link that expires after a minute." />
      <Section title="Payroll history">
        {!data?.length ? <EmptyState title="No payslips yet" /> : (
          <Table>
            <THead><TR><TH>Month</TH><TH className="text-right">Days (actual / allocated)</TH><TH className="text-right">Total earnings</TH><TH className="text-right">Total deductions</TH><TH className="text-right">EPF 8%</TH><TH className="text-right">Net salary</TH><TH /></TR></THead>
            <TBody>
              {data.map((r) => {
                const slip = (r.payslips as unknown as { id: string; reference_number: string; status: string }[])?.[0];
                return (
                  <TR key={r.id}>
                    <TD className="font-medium">{formatMonth(r.payroll_month)}{slip && <div className="font-mono text-[11px] text-muted-foreground">{slip.reference_number}</div>}</TD>
                    <TD className="num">{formatDays(r.actual_working_days)} / {formatDays(r.allocated_working_days)}</TD>
                    <TD className="num">{formatAmount(r.total_earnings)}</TD><TD className="num">{formatAmount(r.total_deductions)}</TD>
                    <TD className="num">{formatAmount(r.employee_epf)}</TD><TD className="num font-semibold">{formatAmount(r.net_salary)}</TD>
                    <TD className="text-right">{slip?.status === "generated" ? <Button size="sm" variant="outline" asChild><a href={`/api/payslips/${slip.id}`} target="_blank" rel="noreferrer"><Download /> PDF</a></Button> : <span className="text-xs text-muted-foreground">Preparing</span>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
