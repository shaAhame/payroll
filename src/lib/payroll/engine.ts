/**
 * Centralized payroll calculation engine.
 *
 * Pure and deterministic: it receives validated database values and returns
 * every figure, line item and breakdown. It never reads or writes the database,
 * so the same code path is used for first calculation, recalculation and tests.
 *
 * Two calculation bases are kept strictly separate:
 *   EPF Salary Basis   = Basic + BRA 2 + BRA 1                       (EPF only)
 *   Daily Salary Basis = Basic + BRA 2 + BRA 1 + Performance Incentive (daily rate only)
 * Performance Incentive appears once in Total Earnings.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;
export type Numeric = Decimal.Value;

export const D = (v: Numeric | null | undefined): Decimal => new Decimal(v ?? 0);
export const round2 = (v: Decimal): Decimal => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AttendanceStatus = "present" | "absent" | "no_pay_leave" | "approved_leave" | "weekly_off" | "public_holiday";
export type CommissionType = "sales" | "pre_owned" | "company_device" | "repair";

export interface PayrollSettings {
  employeeEpfRate: Numeric; // 0.08
  employerEpfRate: Numeric; // 0.12
  employerEtfRate: Numeric; // 0.03
  lateGraceMinutes: number; // 0
  lateTier1MaxMinutes: number; // 15
  lateTier1Amount: Numeric; // 250
  lateTier2Amount: Numeric; // 500
  lateDeductionFrequency: "per_incident" | "once_per_month";
  lateMonthlyCap: Numeric | null;
  dailySalaryMethod: "allocated_days" | "calendar_days" | "fixed_divisor";
  dailySalaryFixedDivisor: Numeric | null;
  roundDailyRate: boolean;
  additionalDayMultiplier: Numeric; // 1
  noPayMultiplier: Numeric; // 1
  approvedLeaveTreatment: "paid" | "unpaid";
  weeklyOffTreatment: "neutral" | "counts_as_worked";
  publicHolidayTreatment: "neutral" | "paid";
  performanceIncentiveMode: "add" | "override";
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  employeeEpfRate: "0.08",
  employerEpfRate: "0.12",
  employerEtfRate: "0.03",
  lateGraceMinutes: 0,
  lateTier1MaxMinutes: 15,
  lateTier1Amount: "250",
  lateTier2Amount: "500",
  lateDeductionFrequency: "per_incident",
  lateMonthlyCap: null,
  dailySalaryMethod: "allocated_days",
  dailySalaryFixedDivisor: null,
  roundDailyRate: false,
  additionalDayMultiplier: "1",
  noPayMultiplier: "1",
  approvedLeaveTreatment: "paid",
  weeklyOffTreatment: "neutral",
  publicHolidayTreatment: "neutral",
  performanceIncentiveMode: "add",
};

export interface SalaryStructureInput {
  id: string;
  basicSalary: Numeric;
  bra2: Numeric;
  bra1: Numeric;
  performanceIncentive: Numeric;
}

export interface AttendanceInput {
  id: string;
  workDate: string;
  status: AttendanceStatus;
  lateMinutes: number;
  lateWaived: boolean;
}

export interface SourcedAmount {
  id: string;
  amount: Numeric;
  label?: string;
}

export interface CommissionInput extends SourcedAmount {
  type: CommissionType;
  transactionId: string;
}

export interface RepaymentPlanInput {
  id: string;
  outstandingBalance: Numeric;
  monthlyRepayment: Numeric;
}

export interface EngineInput {
  /** First day of the payroll month, YYYY-MM-01 */
  payrollMonth: string;
  salary: SalaryStructureInput | null;
  allocatedWorkingDays: Numeric | null;
  attendance: AttendanceInput[];
  performanceIncentiveRecords: SourcedAmount[];
  commissions: CommissionInput[];
  commissionReleases: CommissionInput[];
  otherEarnings: SourcedAmount[];
  manualDeductions: SourcedAmount[];
  advances: RepaymentPlanInput[];
  loans: RepaymentPlanInput[];
  settings: PayrollSettings;
}

export type EarningCategory =
  | "basic_salary" | "bra2" | "bra1" | "performance_incentive" | "additional_working_pay"
  | "sales_commission" | "pre_owned_commission" | "company_device_commission" | "repair_commission" | "other";

export type DeductionCategory =
  | "no_pay_leave" | "sales_commission_released" | "used_commission_released" | "repair_commission_released"
  | "company_device_commission_released" | "employee_epf" | "late_arrivals" | "salary_advance" | "loan_repayment" | "other";

export interface EarningLine {
  category: EarningCategory;
  label: string;
  amount: Decimal;
  sourceType: "salary_structure" | "attendance" | "commission" | "additional_earning";
  sourceId: string | null;
  calculation: Record<string, unknown>;
}

export interface DeductionLine {
  category: DeductionCategory;
  label: string;
  amount: Decimal;
  sourceType: "attendance" | "epf" | "commission_release" | "salary_advance" | "loan" | "manual_deduction";
  sourceId: string | null;
  calculation: Record<string, unknown>;
}

export interface PayrollWarning {
  code: string;
  message: string;
  blocking: boolean;
}

export interface LateIncident {
  attendanceId: string;
  workDate: string;
  lateMinutes: number;
  amount: Decimal;
  waived: boolean;
}

export interface WorkingDayBreakdown {
  present: number;
  approvedLeave: number;
  publicHoliday: number;
  weeklyOff: number;
  absent: number;
  noPayLeave: number;
  countedAsWorked: number;
  recordedDays: number;
}

export interface EngineResult {
  basicSalary: Decimal;
  bra2: Decimal;
  bra1: Decimal;
  performanceIncentive: Decimal;
  epfSalaryBasis: Decimal;
  dailySalaryBasis: Decimal;
  dailyRateDivisor: Decimal;
  dailySalaryRate: Decimal;
  allocatedWorkingDays: Decimal;
  actualWorkingDays: Decimal;
  additionalWorkingDays: Decimal;
  additionalOffDays: Decimal;
  additionalWorkingPay: Decimal;
  noPayLeave: Decimal;
  lateDeduction: Decimal;
  employeeEpf: Decimal;
  employerEpf: Decimal;
  employerEtf: Decimal;
  totalEarnings: Decimal;
  totalDeductions: Decimal;
  netSalary: Decimal;
  earnings: EarningLine[];
  deductions: DeductionLine[];
  workingDays: WorkingDayBreakdown;
  lateIncidents: LateIncident[];
  warnings: PayrollWarning[];
}

// ---------------------------------------------------------------------------
// Individual, reusable calculation functions
// ---------------------------------------------------------------------------

/** EPF Salary Basis = Basic Salary + BRA 2 + BRA 1. Performance Incentive is never included. */
export function calculateEPFSalary(c: { basicSalary: Numeric; bra2: Numeric; bra1: Numeric }): Decimal {
  return round2(D(c.basicSalary).plus(D(c.bra2)).plus(D(c.bra1)));
}

/** Employee EPF = EPF Salary Basis × employee EPF rate (default 8%). */
export function calculateEmployeeEPF(epfSalaryBasis: Numeric, rate: Numeric = "0.08"): Decimal {
  return round2(D(epfSalaryBasis).times(D(rate)));
}

/** Employer contributions are reported separately and never deducted from the employee. */
export function calculateEmployerContributions(epfSalaryBasis: Numeric, epfRate: Numeric, etfRate: Numeric) {
  return { employerEpf: round2(D(epfSalaryBasis).times(D(epfRate))), employerEtf: round2(D(epfSalaryBasis).times(D(etfRate))) };
}

/** Daily Salary Basis = Basic Salary + BRA 2 + BRA 1 + Performance Incentive. */
export function calculateDailySalaryBasis(c: { basicSalary: Numeric; bra2: Numeric; bra1: Numeric; performanceIncentive: Numeric }): Decimal {
  return round2(D(c.basicSalary).plus(D(c.bra2)).plus(D(c.bra1)).plus(D(c.performanceIncentive)));
}

export function daysInMonth(payrollMonth: string): number {
  const [y, m] = payrollMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Divisor used for the daily rate, per the configured method (default: allocated working days). */
export function resolveDailyRateDivisor(settings: PayrollSettings, allocatedWorkingDays: Numeric, payrollMonth: string): Decimal {
  switch (settings.dailySalaryMethod) {
    case "calendar_days":
      return D(daysInMonth(payrollMonth));
    case "fixed_divisor":
      return D(settings.dailySalaryFixedDivisor ?? allocatedWorkingDays);
    default:
      return D(allocatedWorkingDays);
  }
}

/** Daily Salary Rate = Daily Salary Basis / divisor. Kept at full precision unless rounding is configured. */
export function calculateDailySalaryRate(dailySalaryBasis: Numeric, divisor: Numeric, roundRate = false): Decimal {
  const d = D(divisor);
  if (d.lte(0)) return ZERO;
  const rate = D(dailySalaryBasis).div(d);
  return roundRate ? round2(rate) : rate;
}

/** Counts eligible worked days from attendance according to the configured leave/holiday treatment. */
export function calculateActualWorkingDays(attendance: AttendanceInput[], settings: PayrollSettings): WorkingDayBreakdown {
  const b: WorkingDayBreakdown = {
    present: 0, approvedLeave: 0, publicHoliday: 0, weeklyOff: 0, absent: 0, noPayLeave: 0, countedAsWorked: 0,
    recordedDays: attendance.length,
  };
  for (const a of attendance) {
    switch (a.status) {
      case "present":
        b.present++;
        b.countedAsWorked++;
        break;
      case "approved_leave":
        b.approvedLeave++;
        if (settings.approvedLeaveTreatment === "paid") b.countedAsWorked++;
        break;
      case "public_holiday":
        b.publicHoliday++;
        if (settings.publicHolidayTreatment === "paid") b.countedAsWorked++;
        break;
      case "weekly_off":
        b.weeklyOff++;
        if (settings.weeklyOffTreatment === "counts_as_worked") b.countedAsWorked++;
        break;
      case "absent":
        b.absent++;
        break;
      case "no_pay_leave":
        b.noPayLeave++;
        break;
    }
  }
  return b;
}

/**
 * The monthly difference between actual and allocated days is ONE adjustment:
 * either additional working days or additional off days (= no-pay leave), never both.
 */
export function calculateDayAdjustment(allocated: Numeric, actual: Numeric) {
  const diff = D(actual).minus(D(allocated));
  return {
    additionalWorkingDays: diff.gt(0) ? diff : ZERO,
    additionalOffDays: diff.lt(0) ? diff.abs() : ZERO,
  };
}

/** Additional Working Pay = Additional Working Days × Daily Salary Rate (× configured multiplier, default 1). */
export function calculateAdditionalWorkingPay(additionalWorkingDays: Numeric, dailySalaryRate: Numeric, multiplier: Numeric = 1): Decimal {
  if (D(additionalWorkingDays).lte(0)) return ZERO;
  return round2(D(additionalWorkingDays).times(D(dailySalaryRate)).times(D(multiplier)));
}

/** No-Pay Leave = Additional Off Days × Daily Salary Rate (× configured multiplier, default 1). */
export function calculateNoPayLeave(additionalOffDays: Numeric, dailySalaryRate: Numeric, multiplier: Numeric = 1): Decimal {
  if (D(additionalOffDays).lte(0)) return ZERO;
  return round2(D(additionalOffDays).times(D(dailySalaryRate)).times(D(multiplier)));
}

/** Deduction for a single late arrival: 1–15 min → tier 1 (LKR 250), >15 min → tier 2 (LKR 500). */
export function lateAmountForMinutes(minutes: number, settings: PayrollSettings): Decimal {
  const effective = minutes - settings.lateGraceMinutes;
  if (effective <= 0) return ZERO;
  return minutes <= settings.lateTier1MaxMinutes ? D(settings.lateTier1Amount) : D(settings.lateTier2Amount);
}

/** Monthly late deduction from attendance; waived incidents are listed but not charged. */
export function calculateLateDeduction(attendance: AttendanceInput[], settings: PayrollSettings) {
  const incidents: LateIncident[] = attendance
    .filter((a) => a.status === "present" && a.lateMinutes > 0)
    .map((a) => ({
      attendanceId: a.id,
      workDate: a.workDate,
      lateMinutes: a.lateMinutes,
      amount: lateAmountForMinutes(a.lateMinutes, settings),
      waived: a.lateWaived,
    }))
    .filter((i) => i.amount.gt(0) || i.waived)
    .sort((x, y) => x.workDate.localeCompare(y.workDate));

  const chargeable = incidents.filter((i) => !i.waived && i.amount.gt(0));
  let total =
    settings.lateDeductionFrequency === "once_per_month"
      ? chargeable.reduce((m, i) => Decimal.max(m, i.amount), ZERO)
      : chargeable.reduce((s, i) => s.plus(i.amount), ZERO);
  if (settings.lateMonthlyCap != null && total.gt(D(settings.lateMonthlyCap))) total = D(settings.lateMonthlyCap);
  return { total: round2(total), incidents, chargeableCount: chargeable.length };
}

export function calculateTotalEarnings(lines: { amount: Decimal }[]): Decimal {
  return round2(lines.reduce((s, l) => s.plus(l.amount), ZERO));
}

export function calculateTotalDeductions(lines: { amount: Decimal }[]): Decimal {
  return round2(lines.reduce((s, l) => s.plus(l.amount), ZERO));
}

/** Net Salary = Total Earnings − Total Deductions. */
export function calculateNetSalary(totalEarnings: Numeric, totalDeductions: Numeric): Decimal {
  return round2(D(totalEarnings).minus(D(totalDeductions)));
}

/** Instalment for a loan/advance this month: the monthly amount, never more than what is outstanding. */
export function calculateRepayment(plan: RepaymentPlanInput): Decimal {
  const outstanding = D(plan.outstandingBalance);
  if (outstanding.lte(0)) return ZERO;
  return round2(Decimal.min(D(plan.monthlyRepayment), outstanding));
}

const COMMISSION_EARNING: Record<CommissionType, { category: EarningCategory; label: string }> = {
  sales: { category: "sales_commission", label: "Sales Commission" },
  pre_owned: { category: "pre_owned_commission", label: "Pre-Owned Commission" },
  company_device: { category: "company_device_commission", label: "Company Device Commission" },
  repair: { category: "repair_commission", label: "Repair Commission" },
};

const COMMISSION_RELEASE: Record<CommissionType, { category: DeductionCategory; label: string }> = {
  sales: { category: "sales_commission_released", label: "Sales Commission Released" },
  pre_owned: { category: "used_commission_released", label: "Used Commission Released" },
  company_device: { category: "company_device_commission_released", label: "Company Device Commission Released" },
  repair: { category: "repair_commission_released", label: "Repair Commission Released" },
};

// ---------------------------------------------------------------------------
// Full calculation for one employee-month
// ---------------------------------------------------------------------------
export function calculatePayroll(input: EngineInput): EngineResult {
  const s = input.settings;
  const warnings: PayrollWarning[] = [];
  const earnings: EarningLine[] = [];
  const deductions: DeductionLine[] = [];

  if (!input.salary) {
    warnings.push({ code: "no_salary_structure", message: "No salary structure is effective for this month", blocking: true });
  }
  const basic = round2(D(input.salary?.basicSalary));
  const bra2 = round2(D(input.salary?.bra2));
  const bra1 = round2(D(input.salary?.bra1));

  // Performance incentive for the month (structure amount + approved monthly records, or records override)
  const structurePI = round2(D(input.salary?.performanceIncentive));
  const recordsPI = input.performanceIncentiveRecords.reduce((t, r) => t.plus(D(r.amount)), ZERO);
  const useStructurePI = s.performanceIncentiveMode === "add" || input.performanceIncentiveRecords.length === 0;
  const performanceIncentive = round2((useStructurePI ? structurePI : ZERO).plus(recordsPI));

  // Separate calculation bases
  const epfSalaryBasis = calculateEPFSalary({ basicSalary: basic, bra2, bra1 });
  const dailySalaryBasis = calculateDailySalaryBasis({ basicSalary: basic, bra2, bra1, performanceIncentive });

  const allocated = D(input.allocatedWorkingDays);
  if (allocated.lte(0)) {
    warnings.push({ code: "no_allocated_days", message: "Allocated working days must be greater than zero", blocking: true });
  }
  const divisor = resolveDailyRateDivisor(s, allocated, input.payrollMonth);
  const dailySalaryRate = calculateDailySalaryRate(dailySalaryBasis, divisor, s.roundDailyRate);

  // Working days
  const workingDays = calculateActualWorkingDays(input.attendance, s);
  if (workingDays.recordedDays === 0) {
    warnings.push({ code: "no_attendance", message: "No attendance has been recorded for this month", blocking: true });
  }
  const actual = D(workingDays.countedAsWorked);
  const adj = allocated.gt(0) ? calculateDayAdjustment(allocated, actual) : { additionalWorkingDays: ZERO, additionalOffDays: ZERO };
  const additionalWorkingPay = calculateAdditionalWorkingPay(adj.additionalWorkingDays, dailySalaryRate, s.additionalDayMultiplier);
  const noPayLeave = calculateNoPayLeave(adj.additionalOffDays, dailySalaryRate, s.noPayMultiplier);

  // ---- Earnings ----
  const structureId = input.salary?.id ?? null;
  earnings.push({ category: "basic_salary", label: "Basic Salary", amount: basic, sourceType: "salary_structure", sourceId: structureId, calculation: {} });
  earnings.push({ category: "bra2", label: "BRA 2", amount: bra2, sourceType: "salary_structure", sourceId: structureId, calculation: {} });
  earnings.push({ category: "bra1", label: "BRA 1", amount: bra1, sourceType: "salary_structure", sourceId: structureId, calculation: {} });
  if (useStructurePI && structurePI.gt(0)) {
    earnings.push({
      category: "performance_incentive", label: "Performance Incentive", amount: structurePI,
      sourceType: "salary_structure", sourceId: structureId, calculation: { source: "salary structure" },
    });
  }
  for (const r of input.performanceIncentiveRecords) {
    earnings.push({
      category: "performance_incentive", label: r.label || "Performance Incentive", amount: round2(D(r.amount)),
      sourceType: "additional_earning", sourceId: r.id, calculation: { source: "monthly incentive record", mode: s.performanceIncentiveMode },
    });
  }
  if (additionalWorkingPay.gt(0)) {
    earnings.push({
      category: "additional_working_pay", label: "Additional Working Pay", amount: additionalWorkingPay,
      sourceType: "attendance", sourceId: null,
      calculation: {
        formula: "Additional Working Days × Daily Salary Rate" + (D(s.additionalDayMultiplier).eq(1) ? "" : " × multiplier"),
        additionalWorkingDays: adj.additionalWorkingDays.toString(), dailySalaryRate: dailySalaryRate.toFixed(4),
        multiplier: D(s.additionalDayMultiplier).toString(),
      },
    });
  }
  for (const c of input.commissions) {
    const m = COMMISSION_EARNING[c.type];
    earnings.push({
      category: m.category, label: m.label, amount: round2(D(c.amount)), sourceType: "commission", sourceId: c.id,
      calculation: { transactionId: c.transactionId },
    });
  }
  for (const e of input.otherEarnings) {
    earnings.push({
      category: "other", label: e.label || "Other Earnings", amount: round2(D(e.amount)), sourceType: "additional_earning", sourceId: e.id,
      calculation: {},
    });
  }

  // ---- Deductions ----
  if (noPayLeave.gt(0)) {
    deductions.push({
      category: "no_pay_leave", label: "No-Pay Leave", amount: noPayLeave, sourceType: "attendance", sourceId: null,
      calculation: {
        formula: "Additional Off Days × Daily Salary Rate" + (D(s.noPayMultiplier).eq(1) ? "" : " × multiplier"),
        additionalOffDays: adj.additionalOffDays.toString(), dailySalaryRate: dailySalaryRate.toFixed(4),
        multiplier: D(s.noPayMultiplier).toString(),
      },
    });
  }
  for (const c of input.commissionReleases) {
    const m = COMMISSION_RELEASE[c.type];
    deductions.push({
      category: m.category, label: m.label, amount: round2(D(c.amount)), sourceType: "commission_release", sourceId: c.id,
      calculation: { transactionId: c.transactionId, reason: "Paid in an earlier payroll and released separately" },
    });
  }
  const employeeEpf = calculateEmployeeEPF(epfSalaryBasis, s.employeeEpfRate);
  deductions.push({
    category: "employee_epf", label: `EPF ${D(s.employeeEpfRate).times(100).toString()}%`, amount: employeeEpf,
    sourceType: "epf", sourceId: null,
    calculation: { formula: "EPF Salary Basis × rate", epfSalaryBasis: epfSalaryBasis.toFixed(2), rate: D(s.employeeEpfRate).toString() },
  });
  const late = calculateLateDeduction(input.attendance, s);
  if (late.total.gt(0)) {
    deductions.push({
      category: "late_arrivals", label: "Late Arrivals", amount: late.total, sourceType: "attendance", sourceId: null,
      calculation: {
        frequency: s.lateDeductionFrequency,
        incidents: late.incidents.map((i) => ({ date: i.workDate, minutes: i.lateMinutes, amount: i.amount.toFixed(2), waived: i.waived })),
      },
    });
  }
  for (const a of input.advances) {
    const amt = calculateRepayment(a);
    if (amt.gt(0)) {
      deductions.push({
        category: "salary_advance", label: "Salary Advance", amount: amt, sourceType: "salary_advance", sourceId: a.id,
        calculation: { outstandingBefore: D(a.outstandingBalance).toFixed(2), monthlyRepayment: D(a.monthlyRepayment).toFixed(2) },
      });
    }
  }
  for (const l of input.loans) {
    const amt = calculateRepayment(l);
    if (amt.gt(0)) {
      deductions.push({
        category: "loan_repayment", label: "Loan Repayment", amount: amt, sourceType: "loan", sourceId: l.id,
        calculation: { outstandingBefore: D(l.outstandingBalance).toFixed(2), monthlyRepayment: D(l.monthlyRepayment).toFixed(2) },
      });
    }
  }
  for (const m of input.manualDeductions) {
    deductions.push({
      category: "other", label: m.label || "Other Authorized Deduction", amount: round2(D(m.amount)), sourceType: "manual_deduction",
      sourceId: m.id, calculation: {},
    });
  }

  const totalEarnings = calculateTotalEarnings(earnings);
  const totalDeductions = calculateTotalDeductions(deductions);
  const netSalary = calculateNetSalary(totalEarnings, totalDeductions);
  if (netSalary.lt(0)) {
    warnings.push({ code: "negative_net", message: "Deductions exceed earnings (negative net salary)", blocking: true });
  }
  const { employerEpf, employerEtf } = calculateEmployerContributions(epfSalaryBasis, s.employerEpfRate, s.employerEtfRate);

  return {
    basicSalary: basic, bra2, bra1, performanceIncentive,
    epfSalaryBasis, dailySalaryBasis, dailyRateDivisor: divisor, dailySalaryRate,
    allocatedWorkingDays: allocated, actualWorkingDays: actual,
    additionalWorkingDays: adj.additionalWorkingDays, additionalOffDays: adj.additionalOffDays,
    additionalWorkingPay, noPayLeave, lateDeduction: late.total,
    employeeEpf, employerEpf, employerEtf,
    totalEarnings, totalDeductions, netSalary,
    earnings, deductions, workingDays, lateIncidents: late.incidents, warnings,
  };
}
