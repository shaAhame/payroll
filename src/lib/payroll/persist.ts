import type { EngineResult } from "@/lib/payroll/engine";

export interface Snapshot {
  salaryStructureId: string | null;
  employeeCode: string;
  employeeName: string;
  designation: string;
  epfNumber: string | null;
  branchName: string;
  allocationSource: string;
  hasEmail: boolean;
}

/** Converts an engine result into the JSON payload accepted by save_payroll_calculation(). */
export function toSavePayload(r: EngineResult, snap: Snapshot) {
  const warnings = [...r.warnings];
  if (!snap.hasEmail) {
    warnings.push({ code: "no_email", message: "No email address — the payslip will not be emailed", blocking: false });
  }
  const values = {
    salary_structure_id: snap.salaryStructureId ?? "",
    employee_code: snap.employeeCode,
    employee_name: snap.employeeName,
    designation: snap.designation,
    epf_number: snap.epfNumber,
    branch_name: snap.branchName,
    basic_salary: r.basicSalary.toFixed(2),
    bra2: r.bra2.toFixed(2),
    bra1: r.bra1.toFixed(2),
    performance_incentive: r.performanceIncentive.toFixed(2),
    epf_salary_basis: r.epfSalaryBasis.toFixed(2),
    daily_salary_basis: r.dailySalaryBasis.toFixed(2),
    daily_salary_rate: r.dailySalaryRate.toFixed(4),
    allocated_working_days: r.allocatedWorkingDays.toFixed(2),
    actual_working_days: r.actualWorkingDays.toFixed(2),
    additional_working_days: r.additionalWorkingDays.toFixed(2),
    additional_off_days: r.additionalOffDays.toFixed(2),
    additional_working_pay: r.additionalWorkingPay.toFixed(2),
    no_pay_leave: r.noPayLeave.toFixed(2),
    late_deduction: r.lateDeduction.toFixed(2),
    employee_epf: r.employeeEpf.toFixed(2),
    employer_epf: r.employerEpf.toFixed(2),
    employer_etf: r.employerEtf.toFixed(2),
    total_earnings: r.totalEarnings.toFixed(2),
    total_deductions: r.totalDeductions.toFixed(2),
    net_salary: r.netSalary.toFixed(2),
    calculation_breakdown: {
      allocationSource: snap.allocationSource,
      dailyRateDivisor: r.dailyRateDivisor.toString(),
      workingDays: r.workingDays,
      lateIncidents: r.lateIncidents.map((i) => ({
        date: i.workDate, minutes: i.lateMinutes, amount: i.amount.toFixed(2), waived: i.waived,
      })),
      formulas: {
        epfSalaryBasis: "Basic Salary + BRA 2 + BRA 1",
        dailySalaryBasis: "Basic Salary + BRA 2 + BRA 1",
        dailySalaryRate: "Daily Salary Basis ÷ " + (r.dailyRateDivisor.toString()),
        netSalary: "Total Earnings − Total Deductions",
      },
    },
    warnings,
  };
  const earnings = r.earnings.map((e) => ({
    category: e.category, label: e.label, amount: e.amount.toFixed(2), source_type: e.sourceType, source_id: e.sourceId,
    calculation: e.calculation,
  }));
  const deductions = r.deductions.map((d) => ({
    category: d.category, label: d.label, amount: d.amount.toFixed(2), source_type: d.sourceType, source_id: d.sourceId,
    calculation: d.calculation,
  }));
  return { values, earnings, deductions };
}
