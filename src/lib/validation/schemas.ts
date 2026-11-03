import { z } from "zod";

const money = (label: string, opts: { positive?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/,/g, "").trim())
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), `${label} must be a valid amount with up to 2 decimals`)
    .refine((v) => (opts.positive ? Number(v) > 0 : Number(v) >= 0), opts.positive ? `${label} must be greater than zero` : `${label} cannot be negative`);

const uuid = z.string().uuid("Select a value");
const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => v || null);
const optionalText = z.string().trim().max(500).optional().transform((v) => v || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const month = z.string().regex(/^\d{4}-\d{2}(-01)?$/, "Select a month").transform((v) => `${v.slice(0, 7)}-01`);
const time = z.union([z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM"), z.literal("")]).optional().transform((v) => v || null);

export const salarySchema = z.object({
  basic_salary: money("Basic salary"),
  bra2: money("BRA 2"),
  bra1: money("BRA 1"),
  performance_incentive: money("Performance incentive"),
  effective_from: date,
  notes: optionalText,
});

export const employeeSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(150),
  contact_number: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "Use digits, spaces, +, - or ()").optional().transform((v) => v || null),
  email: z.union([z.string().trim().toLowerCase().email("Enter a valid email address"), z.literal("")]).optional().transform((v) => v || null),
  address: optionalText,
  designation: z.string().trim().min(2, "Enter the designation").max(100),
  department_id: optionalUuid,
  epf_number: z.string().trim().max(30).optional().transform((v) => v || null),
  branch_id: uuid,
  employment_start_date: date,
  employment_status: z.enum(["active", "inactive", "resigned", "terminated"]),
  employment_type: z.enum(["permanent", "contract", "probation", "temporary", "part_time"]),
  shift_id: optionalUuid,
  email_notifications_enabled: z.coerce.boolean(),
  email_verification_status: z.enum(["unverified", "verified", "invalid"]).default("unverified"),
});

export const newEmployeeSchema = employeeSchema.extend({ salary: salarySchema });

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,16}$/, "2–16 letters, digits, - or _"),
  address: optionalText,
  manager_profile_id: optionalUuid,
  allocated_working_days: z.union([z.literal(""), z.coerce.number().gt(0, "Must be greater than zero").max(31)]).optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  default_shift_id: optionalUuid,
});

export const shiftSchema = z.object({
  name: z.string().trim().min(2).max(60),
  branch_id: optionalUuid,
  start_time: z.string().regex(/^\d{2}:\d{2}/, "Use HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}/, "Use HH:MM"),
});

export const attendanceSchema = z.object({
  employee_id: uuid,
  work_date: date,
  status: z.enum(["present", "absent", "no_pay_leave", "approved_leave", "weekly_off", "public_holiday"]),
  shift_start_time: time,
  check_in_time: time,
  check_out_time: time,
  is_additional_working_day: z.coerce.boolean().default(false),
  remarks: optionalText,
}).refine((v) => v.status !== "present" || !!v.check_in_time, { message: "Check-in time is required for Present", path: ["check_in_time"] });

export const allocationSchema = z.object({
  payroll_month: month,
  scope: z.enum(["branch", "employee"]),
  branch_id: optionalUuid,
  employee_id: optionalUuid,
  allocated_days: z.coerce.number().gt(0, "Must be greater than zero").max(31),
  notes: optionalText,
}).refine((v) => (v.scope === "branch" ? !!v.branch_id : !!v.employee_id), { message: "Select who this allocation applies to", path: ["branch_id"] });

export const earningSchema = z.object({
  employee_id: uuid,
  category: z.enum(["performance_incentive", "other", "sales_commission", "pre_owned_commission", "company_device_commission", "repair_commission"]),
  amount: money("Amount", { positive: true }),
  transaction_reference: z.string().trim().max(80).optional().transform((v) => v || null),
  earning_date: date,
  payroll_month: month,
  description: optionalText,
});

export const commissionSchema = z.object({
  employee_id: uuid,
  commission_type: z.enum(["sales", "pre_owned", "company_device", "repair"]),
  transaction_id: z.string().trim().min(1, "Transaction ID is required").max(80),
  amount: money("Commission amount", { positive: true }),
  commission_date: date,
  payroll_month: month,
  notes: optionalText,
});

export const advanceSchema = z.object({
  employee_id: uuid,
  amount: money("Advance amount", { positive: true }),
  advance_date: date,
  monthly_repayment: money("Monthly repayment", { positive: true }),
  repayment_start_month: month,
  remarks: optionalText,
});

export const loanSchema = z.object({
  employee_id: uuid,
  original_amount: money("Loan amount", { positive: true }),
  monthly_repayment: money("Monthly repayment", { positive: true }),
  start_date: date,
  repayment_start_month: month,
  remarks: optionalText,
});

export const manualDeductionSchema = z.object({
  employee_id: uuid,
  payroll_month: month,
  amount: money("Amount", { positive: true }),
  reason: z.string().trim().min(3, "A reason is required").max(300),
  reference: z.string().trim().max(80).optional().transform((v) => v || null),
});

export const userSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["super_admin", "hr_manager", "branch_manager", "employee"]),
  branch_id: optionalUuid,
  employee_id: optionalUuid,
}).refine((v) => v.role !== "branch_manager" || !!v.branch_id, { message: "Branch managers need a branch", path: ["branch_id"] })
  .refine((v) => v.role !== "employee" || !!v.employee_id, { message: "Link the employee record", path: ["employee_id"] });

const rate = z.coerce.number().min(0).max(100).transform((v) => Number((v / 100).toFixed(4)));

export const payrollSettingsSchema = z.object({
  default_working_days: z.coerce.number().gt(0).max(31),
  employee_epf_rate: rate,
  employer_epf_rate: rate,
  employer_etf_rate: rate,
  late_grace_minutes: z.coerce.number().int().min(0).max(120),
  late_tier1_max_minutes: z.coerce.number().int().min(1).max(240),
  late_tier1_amount: money("Late deduction"),
  late_tier2_amount: money("Late deduction (after threshold)"),
  late_deduction_frequency: z.enum(["per_incident", "once_per_month"]),
  late_monthly_cap: z.union([z.literal(""), money("Monthly cap")]).optional().transform((v) => v || null),
  daily_salary_method: z.enum(["allocated_days", "calendar_days", "fixed_divisor"]),
  daily_salary_fixed_divisor: z.union([z.literal(""), z.coerce.number().gt(0).max(31)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  round_daily_rate: z.coerce.boolean(),
  additional_day_multiplier: z.coerce.number().min(0).max(5),
  no_pay_multiplier: z.coerce.number().min(0).max(5),
  approved_leave_treatment: z.enum(["paid", "unpaid"]),
  weekly_off_treatment: z.enum(["neutral", "counts_as_worked"]),
  public_holiday_treatment: z.enum(["neutral", "paid"]),
  performance_incentive_mode: z.enum(["add", "override"]),
  require_approval: z.coerce.boolean(),
  require_separate_approver: z.coerce.boolean(),
}).refine((v) => v.daily_salary_method !== "fixed_divisor" || !!v.daily_salary_fixed_divisor, {
  message: "Enter the fixed divisor", path: ["daily_salary_fixed_divisor"],
});

export const emailSettingsSchema = z.object({
  sender_name: z.string().trim().min(2).max(80),
  sender_email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).optional().transform((v) => v || null),
  email_enabled: z.coerce.boolean(),
  auto_send_payslips: z.coerce.boolean(),
  batch_size: z.coerce.number().int().min(1).max(200),
  max_attempts: z.coerce.number().int().min(1).max(20),
});

export const companySchema = z.object({
  company_name: z.string().trim().min(2).max(150),
  company_address: optionalText,
  company_email: z.union([z.string().trim().email(), z.literal("")]).optional().transform((v) => v || null),
  company_phone: optionalText,
  registration_number: optionalText,
  employer_epf_number: optionalText,
});

export const departmentSchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(80) });

export const SCHEMAS = {
  department: departmentSchema,
  employee: employeeSchema,
  newEmployee: newEmployeeSchema,
  salary: salarySchema,
  branch: branchSchema,
  shift: shiftSchema,
  attendance: attendanceSchema,
  allocation: allocationSchema,
  earning: earningSchema,
  commission: commissionSchema,
  advance: advanceSchema,
  loan: loanSchema,
  manualDeduction: manualDeductionSchema,
  user: userSchema,
  payrollSettings: payrollSettingsSchema,
  emailSettings: emailSettingsSchema,
  company: companySchema,
} as const;

export type SchemaKey = keyof typeof SCHEMAS;
