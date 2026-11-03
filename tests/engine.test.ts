import { describe, expect, it } from "vitest";
import {
  calculateAdditionalWorkingPay, calculateDailySalaryBasis, calculateDailySalaryRate, calculateEmployeeEPF,
  calculateEPFSalary, calculateLateDeduction, calculateNetSalary, calculateNoPayLeave, calculatePayroll,
  DEFAULT_SETTINGS, lateAmountForMinutes, type AttendanceInput, type EngineInput,
} from "@/lib/payroll/engine";

const salary = { id: "s1", basicSalary: "40000", bra2: "5000", bra1: "3000", performanceIncentive: "2000" };

function attendance(present: number, extra: Partial<Record<AttendanceInput["status"], number>> = {}, late: number[] = []): AttendanceInput[] {
  const rows: AttendanceInput[] = [];
  let day = 1;
  const push = (status: AttendanceInput["status"], lateMinutes = 0) =>
    rows.push({ id: `a${day}`, workDate: `2026-01-${String(day++).padStart(2, "0")}`, status, lateMinutes, lateWaived: false });
  for (let i = 0; i < present; i++) push("present", late[i] ?? 0);
  for (const [status, n] of Object.entries(extra)) for (let i = 0; i < (n ?? 0); i++) push(status as AttendanceInput["status"]);
  return rows;
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    payrollMonth: "2026-01-01", salary, allocatedWorkingDays: 25, attendance: attendance(25),
    performanceIncentiveRecords: [], commissions: [], commissionReleases: [], otherEarnings: [], manualDeductions: [],
    advances: [], loans: [], settings: DEFAULT_SETTINGS, ...overrides,
  };
}

describe("specification sample employee", () => {
  it("EPF Salary Basis = 48,000 and EPF 8% = 3,840 (Performance Incentive excluded)", () => {
    const epf = calculateEPFSalary(salary);
    expect(epf.toFixed(2)).toBe("48000.00");
    expect(calculateEmployeeEPF(epf).toFixed(2)).toBe("3840.00");
  });

  it("Daily Salary Basis = 48,000 (Performance Incentive excluded) and Daily Rate = 1,920 over 25 days", () => {
    const basis = calculateDailySalaryBasis(salary);
    expect(basis.toFixed(2)).toBe("48000.00");
    expect(calculateDailySalaryRate(basis, 25).toFixed(2)).toBe("1920.00");
  });

  it("27 actual days → LKR 3,840 additional working pay, no no-pay", () => {
    const r = calculatePayroll(input({ attendance: attendance(27) }));
    expect(r.additionalWorkingDays.toString()).toBe("2");
    expect(r.additionalOffDays.toString()).toBe("0");
    expect(r.additionalWorkingPay.toFixed(2)).toBe("3840.00");
    expect(r.noPayLeave.toFixed(2)).toBe("0.00");
  });

  it("23 actual days → LKR 3,840 no-pay leave, no additional pay", () => {
    const r = calculatePayroll(input({ attendance: attendance(23, { absent: 2 }) }));
    expect(r.additionalOffDays.toString()).toBe("2");
    expect(r.noPayLeave.toFixed(2)).toBe("3840.00");
    expect(r.additionalWorkingPay.toFixed(2)).toBe("0.00");
  });

  it("25 actual days → no adjustment", () => {
    const r = calculatePayroll(input());
    expect(r.additionalWorkingPay.toFixed(2)).toBe("0.00");
    expect(r.noPayLeave.toFixed(2)).toBe("0.00");
  });

  it("Performance Incentive is counted once in Total Earnings and the totals follow the specified formulas", () => {
    const r = calculatePayroll(input());
    expect(r.totalEarnings.toFixed(2)).toBe("50000.00"); // 40,000 + 5,000 + 3,000 + 2,000
    expect(r.earnings.filter((e) => e.category === "performance_incentive")).toHaveLength(1);
    expect(r.totalDeductions.toFixed(2)).toBe("3840.00");
    expect(r.netSalary.toFixed(2)).toBe("46160.00");
    expect(r.epfSalaryBasis.toFixed(2)).toBe("48000.00");
    expect(r.dailySalaryBasis.toFixed(2)).toBe("48000.00");
    expect(r.dailySalaryRate.toFixed(2)).toBe("1920.00");
  });

  it("changing the Performance Incentive never changes the daily rate", () => {
    const a = calculatePayroll(input());
    const b = calculatePayroll(input({ salary: { ...salary, performanceIncentive: "9000" } }));
    expect(b.dailySalaryRate.toFixed(4)).toBe(a.dailySalaryRate.toFixed(4));
    expect(b.totalEarnings.minus(a.totalEarnings).toFixed(2)).toBe("7000.00");
  });

  it("EPF never uses the daily basis, even when additional pay or no-pay apply", () => {
    for (const n of [23, 27]) {
      const r = calculatePayroll(input({ attendance: attendance(n, n < 25 ? { no_pay_leave: 25 - n } : {}) }));
      expect(r.employeeEpf.toFixed(2)).toBe("3840.00");
    }
  });
});

describe("working-day rules", () => {
  it("weekly offs and public holidays are not absences; approved leave is paid by default", () => {
    const r = calculatePayroll(input({ attendance: attendance(23, { approved_leave: 2, weekly_off: 4, public_holiday: 1 }) }));
    expect(r.actualWorkingDays.toString()).toBe("25");
    expect(r.noPayLeave.toFixed(2)).toBe("0.00");
  });

  it("no-pay leave status and the monthly shortfall are one adjustment, not two", () => {
    const r = calculatePayroll(input({ attendance: attendance(24, { no_pay_leave: 1 }) }));
    expect(r.deductions.filter((d) => d.category === "no_pay_leave")).toHaveLength(1);
    expect(r.noPayLeave.toFixed(2)).toBe("1920.00");
  });

  it("supports unpaid approved leave when configured", () => {
    const r = calculatePayroll(input({ attendance: attendance(24, { approved_leave: 1 }), settings: { ...DEFAULT_SETTINGS, approvedLeaveTreatment: "unpaid" } }));
    expect(r.noPayLeave.toFixed(2)).toBe("1920.00");
  });

  it("rounds only the final amount (non-integer daily rate)", () => {
    expect(calculateAdditionalWorkingPay(2, calculateDailySalaryRate(50000, 26)).toFixed(2)).toBe("3846.15");
    expect(calculateNoPayLeave(1, calculateDailySalaryRate(50000, 26, true)).toFixed(2)).toBe("1923.08");
  });

  it("blocks when there is no attendance or no allocation", () => {
    expect(calculatePayroll(input({ attendance: [] })).warnings.some((w) => w.code === "no_attendance" && w.blocking)).toBe(true);
    expect(calculatePayroll(input({ allocatedWorkingDays: 0 })).warnings.some((w) => w.code === "no_allocated_days")).toBe(true);
  });
});

describe("late arrivals", () => {
  it.each([[0, "0"], [5, "250"], [10, "250"], [15, "250"], [16, "500"], [30, "500"]])("%i minutes → LKR %s", (m, amt) => {
    expect(lateAmountForMinutes(m, DEFAULT_SETTINGS).toString()).toBe(amt);
  });

  it("sums per incident and skips waived incidents", () => {
    const rows = attendance(25, {}, [5, 20, 16]);
    rows[2].lateWaived = true;
    const late = calculateLateDeduction(rows, DEFAULT_SETTINGS);
    expect(late.total.toFixed(2)).toBe("750.00");
    expect(late.incidents).toHaveLength(3);
  });

  it("once-per-month frequency charges only the highest incident", () => {
    const late = calculateLateDeduction(attendance(25, {}, [5, 20]), { ...DEFAULT_SETTINGS, lateDeductionFrequency: "once_per_month" });
    expect(late.total.toFixed(2)).toBe("500.00");
  });

  it("recalculation is idempotent (no duplicate late deductions)", () => {
    const i = input({ attendance: attendance(25, {}, [5, 20]) });
    const a = calculatePayroll(i);
    const b = calculatePayroll(i);
    expect(a.deductions.filter((d) => d.category === "late_arrivals")).toHaveLength(1);
    expect(b.lateDeduction.toFixed(2)).toBe(a.lateDeduction.toFixed(2));
    expect(a.lateDeduction.toFixed(2)).toBe("750.00");
  });
});

describe("commissions, other earnings, advances and loans", () => {
  it("adds commissions as earnings, recovers releases as deductions, caps repayments at the balance", () => {
    const r = calculatePayroll(input({
      commissions: [
        { id: "c1", type: "sales", amount: "1500", transactionId: "T1" },
        { id: "c2", type: "repair", amount: "500", transactionId: "T2" },
      ],
      commissionReleases: [{ id: "c0", type: "pre_owned", amount: "700", transactionId: "T0" }],
      otherEarnings: [{ id: "o1", amount: "1000", label: "Festival bonus" }],
      manualDeductions: [{ id: "m1", amount: "300", label: "Uniform" }],
      advances: [{ id: "adv", outstandingBalance: "2000", monthlyRepayment: "5000" }],
      loans: [{ id: "ln", outstandingBalance: "10000", monthlyRepayment: "2500" }],
    }));
    expect(r.totalEarnings.toFixed(2)).toBe("53000.00"); // 50,000 + 1,500 + 500 + 1,000
    expect(r.deductions.find((d) => d.category === "used_commission_released")?.amount.toFixed(2)).toBe("700.00");
    expect(r.deductions.find((d) => d.category === "salary_advance")?.amount.toFixed(2)).toBe("2000.00");
    expect(r.deductions.find((d) => d.category === "loan_repayment")?.amount.toFixed(2)).toBe("2500.00");
    expect(r.totalDeductions.toFixed(2)).toBe("9340.00"); // 3,840 + 700 + 2,000 + 2,500 + 300
    expect(r.netSalary.toFixed(2)).toBe(calculateNetSalary(r.totalEarnings, r.totalDeductions).toFixed(2));
    expect(r.netSalary.toFixed(2)).toBe("43660.00");
  });

  it("monthly incentive records are paid once and change neither basis", () => {
    const r = calculatePayroll(input({ performanceIncentiveRecords: [{ id: "p1", amount: "500" }], attendance: attendance(26) }));
    expect(r.performanceIncentive.toFixed(2)).toBe("2500.00");
    expect(r.dailySalaryBasis.toFixed(2)).toBe("48000.00");
    expect(r.epfSalaryBasis.toFixed(2)).toBe("48000.00");
    expect(r.additionalWorkingPay.toFixed(2)).toBe("1920.00");
    expect(r.totalEarnings.toFixed(2)).toBe("52420.00"); // 48,000 + 2,500 + 1,920
  });

  it("override mode replaces the structure incentive with the monthly record", () => {
    const r = calculatePayroll(input({
      performanceIncentiveRecords: [{ id: "p1", amount: "3000" }],
      settings: { ...DEFAULT_SETTINGS, performanceIncentiveMode: "override" },
    }));
    expect(r.performanceIncentive.toFixed(2)).toBe("3000.00");
    expect(r.totalEarnings.toFixed(2)).toBe("51000.00");
  });

  it("employer contributions are not employee deductions", () => {
    const r = calculatePayroll(input());
    expect(r.employerEpf.toFixed(2)).toBe("5760.00");
    expect(r.employerEtf.toFixed(2)).toBe("1440.00");
    expect(r.deductions.some((d) => d.label.toLowerCase().includes("employer"))).toBe(false);
  });

  it("flags negative net salary as blocking", () => {
    const r = calculatePayroll(input({ manualDeductions: [{ id: "m", amount: "60000" }] }));
    expect(r.warnings.some((w) => w.code === "negative_net" && w.blocking)).toBe(true);
  });
});
