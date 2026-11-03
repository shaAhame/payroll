import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { StatusBadge } from "@/components/app/status-badge";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sp } from "@/lib/queries";
import { currentMonthStart, formatDate, formatMonth, monthEnd } from "@/lib/format";

export const metadata = { title: "My Attendance" };

export default async function MyAttendance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(["employee"]);
  const m = sp((await searchParams).month);
  const month = m ? `${m.slice(0, 7)}-01` : currentMonthStart();
  const supabase = await createClient();
  const { data } = await supabase.from("attendance").select("*").gte("work_date", month).lte("work_date", monthEnd(month)).order("work_date");
  return (
    <>
      <PageHeader title="My Attendance" description={formatMonth(month)} actions={<FilterBar filters={[{ name: "month", label: "Month", type: "month" }]} />} />
      <Section title="Daily attendance">
        {!data?.length ? <EmptyState title="No attendance recorded for this month" /> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Status</TH><TH>Check-in</TH><TH>Check-out</TH><TH className="text-right">Late (min)</TH><TH className="text-right">Hours</TH><TH>Remarks</TH></TR></THead>
            <TBody>
              {data.map((a) => (
                <TR key={a.id}>
                  <TD>{formatDate(a.work_date)}</TD><TD><StatusBadge status={a.status} /></TD><TD>{a.check_in_time?.slice(0, 5) ?? "—"}</TD><TD>{a.check_out_time?.slice(0, 5) ?? "—"}</TD>
                  <TD className="num">{a.late_minutes || "—"}{a.late_waived && " (waived)"}</TD><TD className="num">{a.working_hours ?? "—"}</TD><TD className="text-muted-foreground">{a.remarks}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
