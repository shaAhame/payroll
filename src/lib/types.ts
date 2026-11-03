export type AppRole = "super_admin" | "hr_manager" | "branch_manager" | "employee";
export type PayrollStatus = "draft" | "processing" | "pending_approval" | "approved" | "finalized";
export type EmailStatus = "pending" | "queued" | "sent" | "delivered" | "failed" | "bounced";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  branch_id: string | null;
  employee_id: string | null;
  is_active: boolean;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  manager_profile_id: string | null;
  allocated_working_days: string | null;
  default_shift_id: string | null;
  is_active: boolean;
}

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  contact_number: string | null;
  email: string | null;
  address: string | null;
  designation: string;
  department_id: string | null;
  epf_number: string | null;
  branch_id: string;
  employment_start_date: string;
  employment_status: "active" | "inactive" | "resigned" | "terminated";
  employment_type: string;
  shift_id: string | null;
  photo_path: string | null;
  email_notifications_enabled: boolean;
  email_verification_status: "unverified" | "verified" | "invalid";
  last_payslip_email_sent_at: string | null;
  created_at: string;
}

export interface SalaryStructure {
  id: string;
  employee_id: string;
  basic_salary: string;
  bra2: string;
  bra1: string;
  performance_incentive: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
}

export interface PayrollPeriod {
  id: string;
  payroll_month: string;
  branch_id: string | null;
  status: PayrollStatus;
  notes: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  finalized_at: string | null;
}

export interface PayrollRecord {
  id: string;
  payroll_period_id: string;
  employee_id: string;
  payroll_month: string;
  employee_code: string;
  employee_name: string;
  designation: string;
  epf_number: string | null;
  branch_id: string;
  branch_name: string;
  salary_structure_id: string | null;
  basic_salary: string;
  bra2: string;
  bra1: string;
  performance_incentive: string;
  epf_salary_basis: string;
  daily_salary_basis: string;
  daily_salary_rate: string;
  allocated_working_days: string;
  actual_working_days: string;
  additional_working_days: string;
  additional_off_days: string;
  additional_working_pay: string;
  no_pay_leave: string;
  late_deduction: string;
  employee_epf: string;
  employer_epf: string;
  employer_etf: string;
  total_earnings: string;
  total_deductions: string;
  net_salary: string;
  status: PayrollStatus;
  needs_recalculation: boolean;
  source_version: number;
  calculation_breakdown: Record<string, unknown>;
  warnings: { code: string; message: string; blocking: boolean }[];
  calculated_at: string | null;
}

export interface PayrollLine {
  id: string;
  payroll_record_id: string;
  category: string;
  label: string;
  amount: string;
  source_type: string;
  source_id: string | null;
  calculation: Record<string, unknown>;
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
