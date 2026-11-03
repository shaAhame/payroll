import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMonth } from "@/lib/format";
import type { PayslipData } from "@/lib/payslip/pdf";

const EARNING_ROWS: [string, string][] = [
  ["basic_salary", "Basic Salary"], ["bra2", "BRA 2"], ["bra1", "BRA 1"], ["performance_incentive", "Performance Incentive"],
  ["additional_working_pay", "Additional Working Pay"], ["sales_commission", "Sales Commission"], ["pre_owned_commission", "Pre-Owned Commission"],
  ["company_device_commission", "Company Device Commission"], ["repair_commission", "Repair Commission"], ["other", "Other Earnings"],
];
const DEDUCTION_ROWS: [string, string][] = [
  ["no_pay_leave", "No-Pay Leave"], ["sales_commission_released", "Sales Commission Released"], ["used_commission_released", "Used Commission Released"],
  ["repair_commission_released", "Repair Commission Released"], ["company_device_commission_released", "Company Device Commission Released"],
  ["employee_epf", "EPF 8%"], ["late_arrivals", "Late Arrivals"], ["salary_advance", "Salary Advances"], ["loan_repayment", "Loan Repayment"], ["other", "Other Deductions"],
];

function sumBy(lines: { category: string; amount: string }[]) {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.category, Math.round(((m.get(l.category) ?? 0) + Number(l.amount)) * 100) / 100);
  return m;
}

/** Loads everything a payslip shows, from the finalized (snapshotted) payroll record only. */
export async function loadPayslipData(admin: SupabaseClient, payrollRecordId: string, referenceNumber: string): Promise<PayslipData> {
  const [{ data: rec, error }, { data: earnings }, { data: deductions }, { data: company }, { data: settings }] = await Promise.all([
    admin.from("payroll_records").select("*").eq("id", payrollRecordId).single(),
    admin.from("payroll_earnings").select("category, amount").eq("payroll_record_id", payrollRecordId),
    admin.from("payroll_deductions").select("category, amount").eq("payroll_record_id", payrollRecordId),
    admin.from("company_settings").select("*").limit(1).maybeSingle(),
    admin.from("payroll_settings").select("employee_epf_rate").limit(1).maybeSingle(),
  ]);
  if (error || !rec) throw error ?? new Error("Payroll record not found");
  if (rec.status !== "finalized") throw new Error("Payslips are only generated for finalized payroll.");

  const e = sumBy(earnings ?? []);
  const dd = sumBy(deductions ?? []);
  const epfPct = settings ? `${Number(settings.employee_epf_rate) * 100}%` : "8%";

  let logo: PayslipData["logo"] = null;
  if (company?.logo_path) {
    const { data: blob } = await admin.storage.from("company-assets").download(company.logo_path);
    if (blob) logo = { bytes: new Uint8Array(await blob.arrayBuffer()), type: /\.png$/i.test(company.logo_path) ? "png" : "jpg" };
  }

  return {
    company: {
      name: company?.company_name ?? "Company", address: company?.company_address ?? null, phone: company?.company_phone ?? null,
      email: company?.company_email ?? null, employerEpfNumber: company?.employer_epf_number ?? null,
    },
    logo,
    referenceNumber,
    monthLabel: formatMonth(rec.payroll_month),
    employee: { code: rec.employee_code, name: rec.employee_name, designation: rec.designation, epfNumber: rec.epf_number, branch: rec.branch_name },
    earnings: EARNING_ROWS.map(([k, label]) => ({ label, amount: String(e.get(k) ?? 0) })),
    deductions: DEDUCTION_ROWS.map(([k, label]) => ({ label: k === "employee_epf" ? `EPF ${epfPct}` : label, amount: String(dd.get(k) ?? 0) })),
    totalEarnings: rec.total_earnings,
    totalDeductions: rec.total_deductions,
    netSalary: rec.net_salary,
    basis: {
      epfSalaryBasis: rec.epf_salary_basis, dailySalaryBasis: rec.daily_salary_basis, dailySalaryRate: Number(rec.daily_salary_rate).toFixed(2),
      allocatedDays: String(Number(rec.allocated_working_days)), actualDays: String(Number(rec.actual_working_days)),
      additionalDays: String(Number(rec.additional_working_days)), offDays: String(Number(rec.additional_off_days)),
    },
    employer: { epf: rec.employer_epf, etf: rec.employer_etf },
    generatedAt: new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }),
  };
}
