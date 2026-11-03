import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/types";
import { formatMonth, monthEnd, titleCase } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ReportFilters {
  month?: string; // YYYY-MM-01
  year?: string;
  employee?: string;
  branch?: string;
  designation?: string;
  payrollStatus?: string;
  emailStatus?: string;
  period?: string;
}

export interface Column {
  key: string;
  label: string;
  type?: "money" | "number" | "text" | "date";
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  roles: AppRole[];
  filters: (keyof ReportFilters)[];
  columns: Column[];
  load: (db: SupabaseClient, f: ReportFilters) => Promise<Record<string, unknown>[]>;
}

const ADMIN: AppRole[] = ["super_admin", "hr_manager"];
const STAFF: AppRole[] = ["super_admin", "hr_manager", "branch_manager"];
const money = (key: string, label: string): Column => ({ key, label, type: "money" });
const num = (key: string, label: string): Column => ({ key, label, type: "number" });
const txt = (key: string, label: string): Column => ({ key, label });

async function all(q: any): Promise<any[]> {
  // page through PostgREST's row limit
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function records(db: SupabaseClient, f: ReportFilters, select = "*") {
  let q = db.from("payroll_records").select(select).order("employee_code");
  if (f.period) q = q.eq("payroll_period_id", f.period);
  else if (f.month) q = q.eq("payroll_month", f.month);
  else if (f.year) q = q.gte("payroll_month", `${f.year}-01-01`).lte("payroll_month", `${f.year}-12-01`);
  if (f.branch) q = q.eq("branch_id", f.branch);
  if (f.employee) q = q.eq("employee_id", f.employee);
  if (f.designation) q = q.ilike("designation", f.designation);
  if (f.payrollStatus) q = q.eq("status", f.payrollStatus);
  return q;
}

const recordCols: Column[] = [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("designation", "Designation"), txt("branch_name", "Branch")];
const withMonth = (rows: any[]) => rows.map((r) => ({ ...r, month: formatMonth(r.payroll_month) }));

export const REPORTS: ReportDef[] = [
  {
    key: "monthly_payroll_summary", title: "Monthly Payroll Summary", description: "Totals per branch for the month.", roles: ADMIN,
    filters: ["month", "branch", "payrollStatus"],
    columns: [txt("branch_name", "Branch"), num("employees", "Employees"), money("basic_salary", "Basic"), money("bra2", "BRA 2"), money("bra1", "BRA 1"),
      money("performance_incentive", "Perf. Incentive"), money("additional_working_pay", "Additional Working Pay"), money("total_earnings", "Total Earnings"),
      money("no_pay_leave", "No-Pay Leave"), money("late_deduction", "Late Deductions"), money("employee_epf", "Employee EPF"), money("total_deductions", "Total Deductions"), money("net_salary", "Net Salary")],
    load: async (db, f) => {
      let q = db.from("v_payroll_monthly_branch").select("*").eq("payroll_month", f.month!);
      if (f.branch) q = q.eq("branch_id", f.branch);
      return (await q).data ?? [];
    },
  },
  {
    key: "payroll_register", title: "Payroll Register", description: "Every column of the payroll table for each employee.", roles: ADMIN,
    filters: ["month", "branch", "employee", "designation", "payrollStatus"],
    columns: [...recordCols, money("basic_salary", "Basic Salary"), money("bra2", "BRA 2"), money("bra1", "BRA 1"), money("performance_incentive", "Performance Incentive"),
      money("epf_salary_basis", "EPF Salary Basis"), money("daily_salary_basis", "Daily Salary Basis"), money("daily_salary_rate", "Daily Salary Rate"),
      num("allocated_working_days", "Allocated Days"), num("actual_working_days", "Actual Days"), num("additional_working_days", "Additional Days"), num("additional_off_days", "Additional Off Days"),
      money("additional_working_pay", "Additional Working Pay"), money("no_pay_leave", "No-Pay Leave"), money("late_deduction", "Late Arrivals"),
      money("total_earnings", "Total Earnings"), money("total_deductions", "Total Deductions"), money("employee_epf", "EPF 8%"), money("net_salary", "Net Salary"), txt("status", "Status")],
    load: async (db, f) => (await all(records(db, f))).map((r) => ({ ...r, status: titleCase(r.status) })),
  },
  {
    key: "employee_salary", title: "Employee Salary Report", description: "Salary components and both calculation bases per employee.", roles: ADMIN,
    filters: ["month", "branch", "employee", "designation"],
    columns: [...recordCols, money("basic_salary", "Basic"), money("bra2", "BRA 2"), money("bra1", "BRA 1"), money("performance_incentive", "Perf. Incentive"),
      money("epf_salary_basis", "EPF Basis"), money("daily_salary_basis", "Daily Basis"), money("total_earnings", "Total Earnings"), money("net_salary", "Net Salary")],
    load: async (db, f) => all(records(db, f)),
  },
  {
    key: "branch_payroll", title: "Branch-wise Payroll Report", description: "Monthly totals per branch for a year.", roles: ADMIN, filters: ["year", "branch"],
    columns: [txt("month", "Month"), txt("branch_name", "Branch"), num("employees", "Employees"), money("total_earnings", "Total Earnings"), money("total_deductions", "Total Deductions"),
      money("employee_epf", "Employee EPF"), money("employer_epf", "Employer EPF"), money("employer_etf", "Employer ETF"), money("net_salary", "Net Salary")],
    load: async (db, f) => {
      const y = f.year ?? String(new Date().getFullYear());
      let q = db.from("v_payroll_monthly_branch").select("*").gte("payroll_month", `${y}-01-01`).lte("payroll_month", `${y}-12-01`).order("payroll_month").order("branch_name");
      if (f.branch) q = q.eq("branch_id", f.branch);
      return withMonth((await q).data ?? []);
    },
  },
  {
    key: "epf_contribution", title: "EPF Contribution Report", description: "EPF basis = Basic + BRA 2 + BRA 1. Employer contributions shown separately.", roles: ADMIN,
    filters: ["month", "branch", "employee"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("epf_number", "EPF Number"), txt("branch_name", "Branch"),
      money("epf_salary_basis", "EPF Salary Basis"), money("employee_epf", "Employee 8%"), money("employer_epf", "Employer EPF"), money("employer_etf", "Employer ETF"), money("total_epf", "Total EPF (Emp + Employer)")],
    load: async (db, f) => (await all(records(db, f))).map((r) => ({ ...r, total_epf: (Number(r.employee_epf) + Number(r.employer_epf)).toFixed(2) })),
  },
  {
    key: "commission", title: "Commission Report", description: "Commissions by payroll month with status and release information.", roles: STAFF,
    filters: ["month", "branch", "employee"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("branch", "Branch"), txt("type", "Type"), txt("transaction_id", "Transaction ID"),
      { key: "commission_date", label: "Date", type: "date" }, money("amount", "Amount"), txt("status", "Status"), { key: "released_date", label: "Released", type: "date" }, txt("recovery", "Recovery Month")],
    load: async (db, f) => {
      let q = db.from("commission_records").select("*, employees(employee_code, full_name), branches(name)").eq("payroll_month", f.month!).order("commission_date");
      if (f.branch) q = q.eq("branch_id", f.branch);
      if (f.employee) q = q.eq("employee_id", f.employee);
      return (await all(q)).map((c) => ({ ...c, employee_code: c.employees?.employee_code, employee_name: c.employees?.full_name, branch: c.branches?.name, type: titleCase(c.commission_type), status: titleCase(c.status), recovery: c.release_deduction_month ? formatMonth(c.release_deduction_month) : "" }));
    },
  },
  {
    key: "attendance", title: "Attendance Report", description: "Monthly attendance counts per employee.", roles: STAFF, filters: ["month", "branch", "employee"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("branch", "Branch"), num("present", "Present"), num("approved_leave", "Approved Leave"),
      num("weekly_off", "Weekly Off"), num("public_holiday", "Public Holiday"), num("absent", "Absent"), num("no_pay_leave", "No-Pay Leave"), num("late_count", "Late Arrivals"), num("recorded_days", "Days Recorded")],
    load: async (db, f) => {
      let q = db.from("v_attendance_monthly").select("*").eq("month", f.month!);
      if (f.branch) q = q.eq("branch_id", f.branch);
      if (f.employee) q = q.eq("employee_id", f.employee);
      const rows = await all(q);
      const emps = await all(db.from("employees").select("id, employee_code, full_name, branches(name)"));
      const m = new Map(emps.map((e) => [e.id, e]));
      return rows.map((r) => ({ ...r, employee_code: m.get(r.employee_id)?.employee_code, employee_name: m.get(r.employee_id)?.full_name, branch: m.get(r.employee_id)?.branches?.name }))
        .sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)));
    },
  },
  {
    key: "late_arrival", title: "Late Arrival Report", description: "Every late check-in with the deduction tier.", roles: STAFF, filters: ["month", "branch", "employee"],
    columns: [{ key: "work_date", label: "Date", type: "date" }, txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("branch", "Branch"),
      txt("shift_start", "Shift Start"), txt("check_in", "Check-in"), num("late_minutes", "Minutes Late"), txt("tier", "Tier"), txt("waived", "Waived"), txt("waiver_reason", "Waiver Reason")],
    load: async (db, f) => {
      let q = db.from("attendance").select("*, employees(employee_code, full_name), branches(name)").eq("status", "present").gt("late_minutes", 0)
        .gte("work_date", f.month!).lte("work_date", monthEnd(f.month!)).order("work_date");
      if (f.branch) q = q.eq("branch_id", f.branch);
      if (f.employee) q = q.eq("employee_id", f.employee);
      return (await all(q)).map((a) => ({
        ...a, employee_code: a.employees?.employee_code, employee_name: a.employees?.full_name, branch: a.branches?.name, shift_start: a.shift_start_time?.slice(0, 5), check_in: a.check_in_time?.slice(0, 5),
        tier: a.late_minutes <= 15 ? "1–15 min" : "> 15 min", waived: a.late_waived ? "Yes" : "", waiver_reason: a.late_waiver_reason ?? "",
      }));
    },
  },
  {
    key: "no_pay_leave", title: "No-Pay Leave Report", description: "Employees with additional off days and the no-pay deduction.", roles: ADMIN, filters: ["month", "branch", "employee"],
    columns: [...recordCols, num("allocated_working_days", "Allocated"), num("actual_working_days", "Actual"), num("additional_off_days", "Off Days"), money("daily_salary_rate", "Daily Rate"), money("no_pay_leave", "No-Pay Deduction")],
    load: async (db, f) => all(records(db, f).gt("no_pay_leave", 0)),
  },
  {
    key: "additional_working_days", title: "Additional Working Days Report", description: "Employees who worked more than their allocation.", roles: ADMIN, filters: ["month", "branch", "employee"],
    columns: [...recordCols, num("allocated_working_days", "Allocated"), num("actual_working_days", "Actual"), num("additional_working_days", "Additional Days"), money("daily_salary_rate", "Daily Rate"), money("additional_working_pay", "Additional Working Pay")],
    load: async (db, f) => all(records(db, f).gt("additional_working_pay", 0)),
  },
  {
    key: "salary_advance", title: "Salary Advance Report", description: "Advances, repayments and outstanding balances.", roles: ADMIN, filters: ["employee"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), { key: "advance_date", label: "Date", type: "date" }, money("amount", "Amount"), money("monthly_repayment", "Monthly"),
      money("repaid", "Repaid"), money("outstanding_balance", "Outstanding"), txt("status", "Status")],
    load: async (db, f) => {
      let q = db.from("salary_advances").select("*, employees(employee_code, full_name)").order("advance_date");
      if (f.employee) q = q.eq("employee_id", f.employee);
      return (await all(q)).map((a) => ({ ...a, employee_code: a.employees?.employee_code, employee_name: a.employees?.full_name, repaid: (Number(a.amount) - Number(a.outstanding_balance)).toFixed(2), status: titleCase(a.status) }));
    },
  },
  {
    key: "loan_repayment", title: "Loan Repayment Report", description: "Loan repayments deducted through finalized payroll.", roles: ADMIN, filters: ["month", "year", "employee"],
    columns: [txt("month", "Payroll Month"), txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), money("original_amount", "Loan Amount"), money("amount", "Repayment"), money("balance_after", "Balance After")],
    load: async (db, f) => {
      let q = db.from("loan_repayments").select("*, employee_loans!inner(employee_id, original_amount, employees(employee_code, full_name))").order("payroll_month");
      if (f.month) q = q.eq("payroll_month", f.month);
      else if (f.year) q = q.gte("payroll_month", `${f.year}-01-01`).lte("payroll_month", `${f.year}-12-01`);
      if (f.employee) q = q.eq("employee_loans.employee_id", f.employee);
      return (await all(q)).map((r) => ({ ...r, month: formatMonth(r.payroll_month), employee_code: r.employee_loans.employees?.employee_code, employee_name: r.employee_loans.employees?.full_name, original_amount: r.employee_loans.original_amount }));
    },
  },
  {
    key: "employee_earnings", title: "Employee Earnings Report", description: "Earnings by category per employee.", roles: ADMIN, filters: ["month", "branch", "employee"],
    columns: [...recordCols, money("basic_salary", "Basic"), money("bra2", "BRA 2"), money("bra1", "BRA 1"), money("performance_incentive", "Perf. Incentive"), money("additional_working_pay", "Additional Working Pay"),
      money("sales_commission", "Sales Comm."), money("pre_owned_commission", "Pre-Owned Comm."), money("company_device_commission", "Company Device Comm."), money("repair_commission", "Repair Comm."), money("other", "Other"), money("total_earnings", "Total")],
    load: async (db, f) => {
      const recs = await all(records(db, f, "*, payroll_earnings(category, amount)"));
      return recs.map((r) => {
        const by: Record<string, number> = {};
        for (const l of r.payroll_earnings ?? []) by[l.category] = (by[l.category] ?? 0) + Number(l.amount);
        return { ...r, ...Object.fromEntries(["sales_commission", "pre_owned_commission", "company_device_commission", "repair_commission", "other"].map((k) => [k, (by[k] ?? 0).toFixed(2)])) };
      });
    },
  },
  {
    key: "net_salary", title: "Net Salary Report", description: "Net salary payable per employee.", roles: ADMIN, filters: ["month", "branch", "employee", "designation", "payrollStatus"],
    columns: [...recordCols, txt("epf_number", "EPF Number"), money("total_earnings", "Total Earnings"), money("total_deductions", "Total Deductions"), money("net_salary", "Net Salary"), txt("status", "Status")],
    load: async (db, f) => (await all(records(db, f))).map((r) => ({ ...r, status: titleCase(r.status) })),
  },
  {
    key: "payslip_email_delivery", title: "Payslip Email Delivery Report", description: "Every payslip email with its delivery status.", roles: ADMIN, filters: ["month", "emailStatus"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("recipient_email", "Recipient"), txt("month", "Payroll Month"), txt("status", "Status"),
      { key: "sent_at", label: "Sent", type: "date" }, { key: "delivered_at", label: "Delivered", type: "date" }, txt("brevo_message_id", "Brevo Message ID"), num("attempt_count", "Attempts"), txt("failure_reason", "Error")],
    load: async (db, f) => emailRows(db, f),
  },
  {
    key: "failed_email", title: "Failed Email Report", description: "Failed and bounced payslip emails.", roles: ADMIN, filters: ["month"],
    columns: [txt("employee_code", "Employee ID"), txt("employee_name", "Employee Name"), txt("recipient_email", "Recipient"), txt("month", "Payroll Month"), txt("status", "Status"), num("attempt_count", "Attempts"), txt("failure_reason", "Error")],
    load: async (db, f) => emailRows(db, { ...f, emailStatus: "failed_or_bounced" }),
  },
];

async function emailRows(db: SupabaseClient, f: ReportFilters) {
  let q = db.from("email_notifications").select("*, employees(employee_code, full_name), payslips!inner(payroll_month)").order("created_at");
  if (f.month) q = q.eq("payslips.payroll_month", f.month);
  if (f.emailStatus === "failed_or_bounced") q = q.in("email_status", ["failed", "bounced"]);
  else if (f.emailStatus) q = q.eq("email_status", f.emailStatus);
  return (await all(q)).map((n) => ({ ...n, employee_code: n.employees?.employee_code, employee_name: n.employees?.full_name, month: formatMonth(n.payslips.payroll_month), status: titleCase(n.email_status) }));
}

export const getReport = (key: string) => REPORTS.find((r) => r.key === key);
