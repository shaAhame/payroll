import Link from "next/link";
import { KV, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAmount, formatDate, formatMonth, titleCase } from "@/lib/format";

export const metadata = { title: "My Profile" };

export default async function PortalHome() {
  const profile = await requirePageRole(["employee"]);
  const supabase = await createClient(); // RLS: only this employee's own rows are visible
  const [{ data: e }, { data: latest }, { data: att }] = await Promise.all([
    supabase.from("employees").select("*, branches(name), departments(name), shifts(name, start_time, end_time)").eq("id", profile.employee_id!).single(),
    supabase.from("payroll_records").select("id, payroll_month, total_earnings, total_deductions, net_salary, payslips(id, status)").eq("status", "finalized").order("payroll_month", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("v_attendance_monthly").select("*").order("month", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const slip = (latest?.payslips as unknown as { id: string; status: string }[] | null)?.[0];
  return (
    <>
      <PageHeader title={`Welcome, ${e?.full_name?.split(" ")[0] ?? ""}`} description="Your employment details, payslips and attendance." />
      {latest && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label={`Net salary · ${formatMonth(latest.payroll_month)}`} value={`LKR ${formatAmount(latest.net_salary)}`} tone="success"
            hint={slip?.status === "generated" ? <a className="text-primary hover:underline" href={`/api/payslips/${slip.id}`} target="_blank" rel="noreferrer">Download payslip</a> : "Payslip being prepared"} />
          <StatCard label="Total earnings" value={`LKR ${formatAmount(latest.total_earnings)}`} />
          <StatCard label="Total deductions" value={`LKR ${formatAmount(latest.total_deductions)}`} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="My details">
          <div className="divide-y divide-border px-5 py-2">
            <KV label="Employee ID" value={e?.employee_code} /><KV label="Name" value={e?.full_name} /><KV label="Designation" value={e?.designation} />
            <KV label="Department" value={e?.departments?.name} /><KV label="Branch" value={e?.branches?.name} /><KV label="EPF number" value={e?.epf_number} />
            <KV label="Start date" value={formatDate(e?.employment_start_date)} /><KV label="Employment type" value={titleCase(e?.employment_type)} />
            <KV label="Shift" value={e?.shifts ? `${e.shifts.name} · ${e.shifts.start_time.slice(0, 5)}–${e.shifts.end_time.slice(0, 5)}` : "—"} />
            <KV label="Email for payslips" value={e?.email} /><KV label="Contact number" value={e?.contact_number} />
          </div>
          <p className="px-5 pb-4 text-xs text-muted-foreground">If any detail is wrong, please contact HR.</p>
        </Section>
        <Section title={att ? `Attendance · ${formatMonth(att.month)}` : "Attendance"} actions={<Button size="sm" variant="outline" asChild><Link href="/portal/attendance">View all</Link></Button>}>
          {att ? (
            <div className="grid grid-cols-2 gap-x-6 px-5 py-2">
              <KV label="Present" value={att.present} /><KV label="Approved leave" value={att.approved_leave} /><KV label="Weekly off" value={att.weekly_off} />
              <KV label="Public holidays" value={att.public_holiday} /><KV label="Absent" value={att.absent} /><KV label="No-pay leave" value={att.no_pay_leave} /><KV label="Late arrivals" value={att.late_count} />
            </div>
          ) : <p className="px-5 py-6 text-sm text-muted-foreground">No attendance recorded yet.</p>}
        </Section>
      </div>
    </>
  );
}
