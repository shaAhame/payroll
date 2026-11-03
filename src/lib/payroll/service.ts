import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculatePayroll, type AttendanceInput, type CommissionInput, type EngineInput, type EngineResult,
  type PayrollSettings, type RepaymentPlanInput, type SourcedAmount,
} from "@/lib/payroll/engine";
import { toSavePayload } from "@/lib/payroll/persist";
import { monthEnd } from "@/lib/format";

type Client = SupabaseClient;

/* eslint-disable @typescript-eslint/no-explicit-any */
function rows<T = any>(res: { data: unknown; error: unknown }): T[] {
  if (res.error) throw res.error;
  return (res.data ?? []) as T[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function inChunks<T>(ids: string[], fn: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const c of chunk(ids, 150)) out.push(...(await fn(c)));
  return out;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }));
}

export function mapSettings(r: any): PayrollSettings {
  return {
    employeeEpfRate: r.employee_epf_rate,
    employerEpfRate: r.employer_epf_rate,
    employerEtfRate: r.employer_etf_rate,
    lateGraceMinutes: r.late_grace_minutes,
    lateTier1MaxMinutes: r.late_tier1_max_minutes,
    lateTier1Amount: r.late_tier1_amount,
    lateTier2Amount: r.late_tier2_amount,
    lateDeductionFrequency: r.late_deduction_frequency,
    lateMonthlyCap: r.late_monthly_cap,
    dailySalaryMethod: r.daily_salary_method,
    dailySalaryFixedDivisor: r.daily_salary_fixed_divisor,
    roundDailyRate: r.round_daily_rate,
    additionalDayMultiplier: r.additional_day_multiplier,
    noPayMultiplier: r.no_pay_multiplier,
    approvedLeaveTreatment: r.approved_leave_treatment,
    weeklyOffTreatment: r.weekly_off_treatment,
    publicHolidayTreatment: r.public_holiday_treatment,
    performanceIncentiveMode: r.performance_incentive_mode,
  };
}

export async function loadPayrollSettings(client: Client) {
  const res = await client.from("payroll_settings").select("*").limit(1).single();
  if (res.error) throw res.error;
  return { raw: res.data, settings: mapSettings(res.data) };
}

export interface PreparedInput {
  employee: any;
  branch: any;
  input: EngineInput;
  allocationSource: string;
}

/**
 * Loads every payroll input for a set of employees and one month using a
 * handful of set-based queries, then assembles one EngineInput per employee.
 */
export async function prepareInputs(client: Client, employeeIds: string[], month: string): Promise<Map<string, PreparedInput>> {
  const end = monthEnd(month);
  const { raw: settingsRow, settings } = await loadPayrollSettings(client);

  const employees = await inChunks(employeeIds, async (ids) =>
    rows(await client.from("employees").select("id, employee_code, full_name, designation, epf_number, branch_id, email, employment_start_date").in("id", ids)));
  const branchIds = [...new Set(employees.map((e: any) => e.branch_id))];
  const branches = rows(await client.from("branches").select("id, name, allocated_working_days").in("id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"]));

  const [structures, attendance, earnings, commissions, releases, manual, advances, loans, allocations, advRepaid, loanRepaid] = await Promise.all([
    inChunks(employeeIds, async (ids) => rows(await client.from("salary_structures").select("*").in("employee_id", ids)
      .lte("effective_from", end).or(`effective_to.is.null,effective_to.gte.${end}`))),
    inChunks(employeeIds, async (ids) => rows(await client.from("attendance").select("id, employee_id, work_date, status, late_minutes, late_waived")
      .in("employee_id", ids).gte("work_date", month).lte("work_date", end))),
    inChunks(employeeIds, async (ids) => rows(await client.from("additional_earnings").select("id, employee_id, category, amount, description, transaction_reference")
      .in("employee_id", ids).eq("payroll_month", month).eq("approval_status", "approved").is("processed_payroll_record_id", null))),
    inChunks(employeeIds, async (ids) => rows(await client.from("commission_records").select("id, employee_id, commission_type, amount, transaction_id")
      .in("employee_id", ids).eq("payroll_month", month).eq("status", "approved").is("included_payroll_record_id", null))),
    inChunks(employeeIds, async (ids) => rows(await client.from("commission_records").select("id, employee_id, commission_type, amount, transaction_id")
      .in("employee_id", ids).eq("release_deduction_month", month).eq("status", "released")
      .not("included_payroll_record_id", "is", null).is("release_deducted_payroll_record_id", null))),
    inChunks(employeeIds, async (ids) => rows(await client.from("manual_deductions").select("id, employee_id, amount, reason")
      .in("employee_id", ids).eq("payroll_month", month).eq("status", "approved").is("processed_payroll_record_id", null))),
    inChunks(employeeIds, async (ids) => rows(await client.from("salary_advances").select("id, employee_id, outstanding_balance, monthly_repayment")
      .in("employee_id", ids).eq("status", "active").lte("repayment_start_month", month).gt("outstanding_balance", 0))),
    inChunks(employeeIds, async (ids) => rows(await client.from("employee_loans").select("id, employee_id, outstanding_balance, monthly_repayment")
      .in("employee_id", ids).eq("status", "active").lte("repayment_start_month", month).gt("outstanding_balance", 0))),
    rows(await client.from("working_day_allocations").select("employee_id, branch_id, allocated_days").eq("payroll_month", month)),
    rows(await client.from("advance_repayments").select("advance_id").eq("payroll_month", month)),
    rows(await client.from("loan_repayments").select("loan_id").eq("payroll_month", month)),
  ]);

  const repaidAdv = new Set(advRepaid.map((r: any) => r.advance_id));
  const repaidLoan = new Set(loanRepaid.map((r: any) => r.loan_id));
  const by = <T extends { employee_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
    return m;
  };
  const sMap = by(structures), aMap = by(attendance), eMap = by(earnings), cMap = by(commissions), rMap = by(releases),
    mMap = by(manual), advMap = by(advances), loanMap = by(loans);
  const branchMap = new Map(branches.map((b: any) => [b.id, b]));
  const empAlloc = new Map(allocations.filter((a: any) => a.employee_id).map((a: any) => [a.employee_id, a.allocated_days]));
  const branchAlloc = new Map(allocations.filter((a: any) => !a.employee_id).map((a: any) => [a.branch_id, a.allocated_days]));

  const out = new Map<string, PreparedInput>();
  for (const emp of employees as any[]) {
    const branch = branchMap.get(emp.branch_id);
    // Effective structure: the one in force on the last day of the payroll month
    const structure = (sMap.get(emp.id) ?? []).sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

    let allocated: string | null = null;
    let allocationSource = "";
    if (empAlloc.has(emp.id)) { allocated = empAlloc.get(emp.id); allocationSource = "employee allocation for the month"; }
    else if (branchAlloc.has(emp.branch_id)) { allocated = branchAlloc.get(emp.branch_id); allocationSource = "branch allocation for the month"; }
    else if (branch?.allocated_working_days) { allocated = branch.allocated_working_days; allocationSource = "branch default"; }
    else { allocated = settingsRow.default_working_days; allocationSource = "company default"; }

    const att: AttendanceInput[] = (aMap.get(emp.id) ?? []).map((a: any) => ({
      id: a.id, workDate: a.work_date, status: a.status, lateMinutes: a.late_minutes, lateWaived: a.late_waived,
    }));
    const empEarnings = eMap.get(emp.id) ?? [];
    const pi: SourcedAmount[] = empEarnings.filter((e: any) => e.category === "performance_incentive")
      .map((e: any) => ({ id: e.id, amount: e.amount, label: e.description ? `Performance Incentive — ${e.description}` : "Performance Incentive" }));
    const other: SourcedAmount[] = empEarnings.filter((e: any) => e.category === "other")
      .map((e: any) => ({ id: e.id, amount: e.amount, label: e.description || "Other Earnings" }));
    const toCommission = (c: any): CommissionInput => ({ id: c.id, type: c.commission_type, amount: c.amount, transactionId: c.transaction_id });
    const plan = (p: any): RepaymentPlanInput => ({ id: p.id, outstandingBalance: p.outstanding_balance, monthlyRepayment: p.monthly_repayment });

    out.set(emp.id, {
      employee: emp,
      branch,
      allocationSource,
      input: {
        payrollMonth: month,
        salary: structure ? {
          id: structure.id, basicSalary: structure.basic_salary, bra2: structure.bra2, bra1: structure.bra1,
          performanceIncentive: structure.performance_incentive,
        } : null,
        allocatedWorkingDays: allocated,
        attendance: att,
        performanceIncentiveRecords: pi,
        commissions: (cMap.get(emp.id) ?? []).map(toCommission),
        commissionReleases: (rMap.get(emp.id) ?? []).map(toCommission),
        otherEarnings: other,
        manualDeductions: (mMap.get(emp.id) ?? []).map((m: any) => ({ id: m.id, amount: m.amount, label: `Other Deduction — ${m.reason}` })),
        advances: (advMap.get(emp.id) ?? []).filter((a: any) => !repaidAdv.has(a.id)).map(plan),
        loans: (loanMap.get(emp.id) ?? []).filter((l: any) => !repaidLoan.has(l.id)).map(plan),
        settings,
      },
    });
  }
  return out;
}

export interface RecalcSummary {
  calculated: number;
  failed: { recordId: string; error: string }[];
}

/**
 * Recalculates the given non-finalized payroll records with the central engine
 * and persists each atomically via `save_payroll_calculation`.
 */
export async function recalculateRecords(client: Client, recordIds: string[]): Promise<RecalcSummary> {
  const summary: RecalcSummary = { calculated: 0, failed: [] };
  if (!recordIds.length) return summary;
  const records = await inChunks(recordIds, async (ids) =>
    rows(await client.from("payroll_records").select("id, employee_id, payroll_month, source_version, status").in("id", ids)));
  const open = records.filter((r: any) => r.status !== "finalized");

  const byMonth = new Map<string, any[]>();
  for (const r of open) byMonth.set(r.payroll_month, [...(byMonth.get(r.payroll_month) ?? []), r]);

  for (const [month, recs] of byMonth) {
    const prepared = await prepareInputs(client, recs.map((r) => r.employee_id), month);
    await pool(recs, 8, async (rec) => {
      try {
        const p = prepared.get(rec.employee_id);
        if (!p) throw new Error("Employee not found");
        const result: EngineResult = calculatePayroll(p.input);
        const payload = toSavePayload(result, {
          salaryStructureId: p.input.salary?.id ?? null,
          employeeCode: p.employee.employee_code,
          employeeName: p.employee.full_name,
          designation: p.employee.designation,
          epfNumber: p.employee.epf_number,
          branchName: p.branch?.name ?? "",
          allocationSource: p.allocationSource,
          hasEmail: !!p.employee.email,
        });
        const { error } = await client.rpc("save_payroll_calculation", {
          p_record_id: rec.id, p_expected_version: rec.source_version,
          p_values: payload.values, p_earnings: payload.earnings, p_deductions: payload.deductions,
        });
        if (error) throw error;
        summary.calculated++;
      } catch (e) {
        summary.failed.push({ recordId: rec.id, error: (e as Error).message });
      }
    });
  }
  return summary;
}

/** Recalculate every stale (or every) record of a period. */
export async function recalculatePeriod(client: Client, periodId: string, onlyStale = true) {
  let q = client.from("payroll_records").select("id").eq("payroll_period_id", periodId).neq("status", "finalized");
  if (onlyStale) q = q.eq("needs_recalculation", true);
  const ids = rows<{ id: string }>(await q).map((r) => r.id);
  return recalculateRecords(client, ids);
}

/** After any input change: recalc the employee's open payroll records for the affected months. */
export async function recalculateForEmployee(client: Client, employeeId: string, months?: string[]) {
  let q = client.from("payroll_records").select("id").eq("employee_id", employeeId).neq("status", "finalized");
  if (months?.length) q = q.in("payroll_month", months);
  const ids = rows<{ id: string }>(await q).map((r) => r.id);
  return recalculateRecords(client, ids);
}

/** Recalc stale records for the given employees (used after bulk imports). */
export async function recalculateStaleForEmployees(client: Client, employeeIds: string[]) {
  if (!employeeIds.length) return { calculated: 0, failed: [] } as RecalcSummary;
  const recs = await inChunks(employeeIds, async (ids) => rows(await client.from("payroll_records").select("id")
    .in("employee_id", ids).eq("needs_recalculation", true).neq("status", "finalized")));
  return recalculateRecords(client, recs.map((r: any) => r.id));
}

/**
 * Creates a payroll period for a month (one branch or all) and one record per
 * active employee who doesn't already have payroll for that month.
 * Uses the service-role client because payroll tables are not client-writable;
 * callers must have checked the user's role.
 */
export async function createPayrollPeriod(admin: Client, opts: { month: string; branchId: string | null; userId: string }) {
  const end = monthEnd(opts.month);
  let empQ = admin.from("employees").select("id, employee_code, full_name, designation, epf_number, branch_id, branches(name)")
    .eq("employment_status", "active").lte("employment_start_date", end);
  if (opts.branchId) empQ = empQ.eq("branch_id", opts.branchId);
  const employees = rows(await empQ);
  if (!employees.length) throw new Error("There are no active employees for this selection.");

  const existing = new Set(rows(await admin.from("payroll_records").select("employee_id").eq("payroll_month", opts.month))
    .map((r: any) => r.employee_id));

  const { data: period, error } = await admin.from("payroll_periods")
    .insert({ payroll_month: opts.month, branch_id: opts.branchId, status: "draft", created_by: opts.userId })
    .select().single();
  if (error) {
    if ((error as any).code === "23505") throw new Error("A payroll for this month and branch selection already exists.");
    throw error;
  }

  const toInsert = employees.filter((e: any) => !existing.has(e.id)).map((e: any) => ({
    payroll_period_id: period.id, employee_id: e.id, payroll_month: opts.month,
    employee_code: e.employee_code, employee_name: e.full_name, designation: e.designation, epf_number: e.epf_number,
    branch_id: e.branch_id, branch_name: e.branches?.name ?? "", status: "draft", needs_recalculation: true,
  }));
  for (const c of chunk(toInsert, 500)) {
    const r = await admin.from("payroll_records").insert(c);
    if (r.error) throw r.error;
  }
  return { period, created: toInsert.length, skipped: employees.length - toInsert.length };
}
