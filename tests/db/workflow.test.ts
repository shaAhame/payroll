/**
 * Database integration test: runs the real migrations on an in-memory
 * PostgreSQL (PGlite) and drives the payroll workflow end to end with the
 * real calculation engine — calculation persistence, stale detection,
 * approval rules, finalization side effects, immutability, email queue
 * idempotency and Row Level Security.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createDb } from "./harness";
import { calculatePayroll, DEFAULT_SETTINGS, type AttendanceInput } from "@/lib/payroll/engine";
import { toSavePayload } from "@/lib/payroll/persist";

const ids = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  hr: "00000000-0000-0000-0000-0000000000a2",
  bm: "00000000-0000-0000-0000-0000000000a3",
  empUser: "00000000-0000-0000-0000-0000000000a4",
};
let db: PGlite;
let branchId: string, otherBranchId: string, empId: string, emp2Id: string, structureId: string;
let loanId: string, advanceId: string, commissionId: string, periodId: string, recordId: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

async function calcAndSave(asId = ids.hr) {
  const rec = await one<{ id: string; employee_id: string; payroll_month: string; source_version: number }>(
    "select id, employee_id, payroll_month::text, source_version from payroll_records where id = $1", [recordId]);
  const att = (await db.query<{ id: string; work_date: string; status: AttendanceInput["status"]; late_minutes: number; late_waived: boolean }>(
    "select id, work_date::text, status, late_minutes, late_waived from attendance where employee_id = $1 and work_date between '2026-01-01' and '2026-01-31'", [empId])).rows;
  const s = await one<Record<string, string>>("select * from salary_structures where id = $1", [structureId]);
  const loan = await one<Record<string, string>>("select * from employee_loans where id = $1", [loanId]);
  const adv = await one<Record<string, string>>("select * from salary_advances where id = $1", [advanceId]);
  const comm = (await db.query<Record<string, string>>(
    "select * from commission_records where employee_id = $1 and status = 'approved' and payroll_month = '2026-01-01'", [empId])).rows;
  const result = calculatePayroll({
    payrollMonth: "2026-01-01",
    salary: { id: s.id, basicSalary: s.basic_salary, bra2: s.bra2, bra1: s.bra1, performanceIncentive: s.performance_incentive },
    allocatedWorkingDays: 25,
    attendance: att.map((a) => ({ id: a.id, workDate: a.work_date, status: a.status, lateMinutes: a.late_minutes, lateWaived: a.late_waived })),
    performanceIncentiveRecords: [], otherEarnings: [], manualDeductions: [], commissionReleases: [],
    commissions: comm.map((c) => ({ id: c.id, type: c.commission_type as "sales", amount: c.amount, transactionId: c.transaction_id })),
    advances: [{ id: adv.id, outstandingBalance: adv.outstanding_balance, monthlyRepayment: adv.monthly_repayment }],
    loans: [{ id: loan.id, outstandingBalance: loan.outstanding_balance, monthlyRepayment: loan.monthly_repayment }],
    settings: DEFAULT_SETTINGS,
  });
  const p = toSavePayload(result, {
    salaryStructureId: s.id, employeeCode: "EMP-00001", employeeName: "Test Employee", designation: "Sales Executive",
    epfNumber: "EPF-1", branchName: "Colombo", allocationSource: "test", hasEmail: true,
  });
  await asUser(db, asId, () => db.query("select save_payroll_calculation($1, $2, $3, $4, $5)",
    [rec.id, rec.source_version, JSON.stringify(p.values), JSON.stringify(p.earnings), JSON.stringify(p.deductions)]));
  return result;
}

beforeAll(async () => {
  db = await createDb();
  for (const [k, id] of Object.entries(ids)) await db.query("insert into auth.users(id, email) values ($1, $2)", [id, `${k}@example.test`]);
  branchId = (await one<{ id: string }>("insert into branches(name, code, allocated_working_days) values ('Colombo', 'CMB', 25) returning id")).id;
  otherBranchId = (await one<{ id: string }>("insert into branches(name, code) values ('Kandy', 'KDY') returning id")).id;
  empId = (await one<{ id: string }>(`insert into employees(full_name, email, designation, epf_number, branch_id, employment_start_date)
    values ('Test Employee', 'test.employee@example.test', 'Sales Executive', 'EPF-1', $1, '2025-01-01') returning id`, [branchId])).id;
  emp2Id = (await one<{ id: string }>(`insert into employees(full_name, designation, branch_id, employment_start_date)
    values ('Other Employee', 'Technician', $1, '2025-01-01') returning id`, [otherBranchId])).id;
  await db.query(`insert into profiles(id, full_name, email, role) values ($1, 'Admin', 'admin@x', 'super_admin'), ($2, 'HR', 'hr@x', 'hr_manager')`, [ids.admin, ids.hr]);
  await db.query(`insert into profiles(id, full_name, email, role, branch_id) values ($1, 'BM', 'bm@x', 'branch_manager', $2)`, [ids.bm, branchId]);
  await db.query(`insert into profiles(id, full_name, email, role, employee_id) values ($1, 'Emp', 'emp@x', 'employee', $2)`, [ids.empUser, empId]);
  structureId = (await one<{ id: string }>(`insert into salary_structures(employee_id, basic_salary, bra2, bra1, performance_incentive, effective_from)
    values ($1, 40000, 5000, 3000, 2000, '2025-01-01') returning id`, [empId])).id;
  // 27 present days (2 late: 10 and 20 minutes)
  for (let d = 1; d <= 27; d++) {
    const checkIn = d === 3 ? "09:10" : d === 4 ? "09:20" : "08:58";
    await db.query(`insert into attendance(employee_id, branch_id, work_date, shift_start_time, check_in_time, check_out_time, status)
      values ($1, $2, $3, '09:00', $4, '18:00', 'present')`, [empId, branchId, `2026-01-${String(d).padStart(2, "0")}`, checkIn]);
  }
  loanId = (await one<{ id: string }>(`insert into employee_loans(employee_id, original_amount, outstanding_balance, monthly_repayment, start_date, repayment_start_month)
    values ($1, 10000, 3000, 2500, '2025-12-01', '2026-01-01') returning id`, [empId])).id;
  advanceId = (await one<{ id: string }>(`insert into salary_advances(employee_id, amount, advance_date, outstanding_balance, monthly_repayment, repayment_start_month)
    values ($1, 5000, '2026-01-05', 5000, 5000, '2026-01-01') returning id`, [empId])).id;
  commissionId = (await one<{ id: string }>(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
    values ($1, $2, 'pre_owned', 'TX-1', 1500, '2026-01-10', '2026-01-01', 'approved') returning id`, [empId, branchId])).id;
  periodId = (await one<{ id: string }>("insert into payroll_periods(payroll_month, branch_id) values ('2026-01-01', $1) returning id", [branchId])).id;
  recordId = (await one<{ id: string }>(`insert into payroll_records(payroll_period_id, employee_id, payroll_month, employee_code, employee_name, designation, branch_id, branch_name)
    values ($1, $2, '2026-01-01', 'EMP-00001', 'Test Employee', 'Sales Executive', $3, 'Colombo') returning id`, [periodId, empId, branchId])).id;
});

describe("attendance derivations and duplicates", () => {
  it("derives late minutes and working hours from times", async () => {
    const r = await one<{ late_minutes: number; working_hours: string }>("select late_minutes, working_hours from attendance where employee_id = $1 and work_date = '2026-01-04'", [empId]);
    expect(r.late_minutes).toBe(20);
    expect(r.working_hours).toBe("8.67");
  });
  it("rejects duplicate attendance for the same employee and date", async () => {
    await expect(db.query(`insert into attendance(employee_id, branch_id, work_date, status) values ($1, $2, '2026-01-01', 'present')`, [empId, branchId]))
      .rejects.toThrow(/duplicate key/);
  });
  it("rejects a second payroll record for the same employee and month", async () => {
    const p2 = (await one<{ id: string }>("insert into payroll_periods(payroll_month) values ('2026-01-01') returning id")).id;
    await expect(db.query(`insert into payroll_records(payroll_period_id, employee_id, payroll_month, employee_code, employee_name, designation, branch_id, branch_name)
      values ($1, $2, '2026-01-01', 'X', 'X', 'X', $3, 'X')`, [p2, empId, branchId])).rejects.toThrow(/duplicate key/);
    await db.query("delete from payroll_periods where id = $1", [p2]);
  });
});

describe("calculation persistence and stale detection", () => {
  it("saves the engine result atomically", async () => {
    const r = await calcAndSave();
    const rec = await one<Record<string, string | boolean>>("select * from payroll_records where id = $1", [recordId]);
    expect(rec.epf_salary_basis).toBe("48000.00");
    expect(rec.daily_salary_basis).toBe("48000.00");
    expect(rec.daily_salary_rate).toBe("1920.0000");
    expect(rec.additional_working_pay).toBe("3840.00");
    expect(rec.no_pay_leave).toBe("0.00");
    expect(rec.late_deduction).toBe("750.00");
    expect(rec.employee_epf).toBe("3840.00");
    // 48,000 + 2,000 incentive + 3,840 additional working pay + 1,500 commission
    expect(rec.total_earnings).toBe("55340.00");
    // 3,840 EPF + 750 late + 5,000 advance + 2,500 loan
    expect(rec.total_deductions).toBe("12090.00");
    expect(rec.net_salary).toBe("43250.00");
    expect(rec.net_salary).toBe(r.netSalary.toFixed(2));
    expect(rec.needs_recalculation).toBe(false);
    const n = await one<{ e: number; d: number }>("select (select count(*)::int from payroll_earnings where payroll_record_id = $1) e, (select count(*)::int from payroll_deductions where payroll_record_id = $1) d", [recordId]);
    expect(n).toEqual({ e: 6, d: 4 });
  });

  it("re-saving is idempotent (no duplicate lines)", async () => {
    await calcAndSave();
    const n = await one<{ d: number }>("select count(*)::int d from payroll_deductions where payroll_record_id = $1 and category = 'late_arrivals'", [recordId]);
    expect(n.d).toBe(1);
  });

  it("an attendance edit flags the record stale and bumps its version", async () => {
    const before = await one<{ source_version: number }>("select source_version from payroll_records where id = $1", [recordId]);
    await db.query("update attendance set late_waived = true, late_waiver_reason = 'Traffic accident on route' where employee_id = $1 and work_date = '2026-01-04'", [empId]);
    const after = await one<{ source_version: number; needs_recalculation: boolean }>("select source_version, needs_recalculation from payroll_records where id = $1", [recordId]);
    expect(after.needs_recalculation).toBe(true);
    expect(Number(after.source_version)).toBeGreaterThan(Number(before.source_version));
  });

  it("a waiver without a reason is rejected", async () => {
    await expect(db.query("update attendance set late_waived = true, late_waiver_reason = null where employee_id = $1 and work_date = '2026-01-03'", [empId]))
      .rejects.toThrow(/check constraint/);
  });

  it("recalculation clears the flag and applies the waiver", async () => {
    await calcAndSave();
    const rec = await one<{ late_deduction: string; needs_recalculation: boolean }>("select late_deduction, needs_recalculation from payroll_records where id = $1", [recordId]);
    expect(rec.late_deduction).toBe("250.00");
    expect(rec.needs_recalculation).toBe(false);
  });

  it("branch managers cannot run calculations", async () => {
    await expect(asUser(db, ids.bm, () => db.query("select save_payroll_calculation($1, 0, '{}', '[]', '[]')", [recordId])))
      .rejects.toThrow(/Not authorized/);
  });
});

describe("approval workflow and finalization", () => {
  it("HR submits; HR cannot approve or finalize", async () => {
    await asUser(db, ids.hr, () => db.query("select submit_payroll_period($1)", [periodId]));
    await expect(asUser(db, ids.hr, () => db.query("select approve_payroll_period($1)", [periodId]))).rejects.toThrow(/Only a Super Admin/);
    await expect(asUser(db, ids.hr, () => db.query("select finalize_payroll_period($1)", [periodId]))).rejects.toThrow(/Only a Super Admin/);
  });

  it("cannot finalize before approval", async () => {
    await expect(asUser(db, ids.admin, () => db.query("select finalize_payroll_period($1)", [periodId]))).rejects.toThrow(/must be approved/);
  });

  it("a value-changing recalculation after submission returns the payroll to draft", async () => {
    await db.query("update attendance set late_waived = false, late_waiver_reason = null where employee_id = $1 and work_date = '2026-01-04'", [empId]);
    await calcAndSave();
    const p = await one<{ status: string }>("select status from payroll_periods where id = $1", [periodId]);
    expect(p.status).toBe("draft");
    await asUser(db, ids.hr, () => db.query("select submit_payroll_period($1)", [periodId]));
  });

  it("Super Admin approves and finalizes; side effects are applied in one transaction", async () => {
    await asUser(db, ids.admin, () => db.query("select approve_payroll_period($1)", [periodId]));
    const res = await asUser(db, ids.admin, () => one<{ r: { payslips_queued: number } }>("select finalize_payroll_period($1) r", [periodId]));
    expect(res.r.payslips_queued).toBe(1);

    const loan = await one<{ outstanding_balance: string; status: string }>("select outstanding_balance, status from employee_loans where id = $1", [loanId]);
    expect(loan).toEqual({ outstanding_balance: "500.00", status: "active" });
    const adv = await one<{ outstanding_balance: string; status: string }>("select outstanding_balance, status from salary_advances where id = $1", [advanceId]);
    expect(adv).toEqual({ outstanding_balance: "0.00", status: "completed" });
    const rep = await one<{ n: number }>("select count(*)::int n from loan_repayments where loan_id = $1", [loanId]);
    expect(rep.n).toBe(1);
    const c = await one<{ status: string; included_payroll_record_id: string }>("select status, included_payroll_record_id from commission_records where id = $1", [commissionId]);
    expect(c).toEqual({ status: "included_in_payroll", included_payroll_record_id: recordId });
    const rec = await one<{ status: string; is_locked: boolean; needs_recalculation: boolean }>("select status, is_locked, needs_recalculation from payroll_records where id = $1", [recordId]);
    expect(rec).toEqual({ status: "finalized", is_locked: true, needs_recalculation: false });
    const slip = await one<{ reference_number: string; status: string }>("select reference_number, status from payslips where payroll_record_id = $1", [recordId]);
    expect(slip.reference_number).toMatch(/^PS-202601-EMP-/);
    expect(slip.status).toBe("pending");
  });

  it("finalized payroll is immutable", async () => {
    await expect(db.query("update payroll_records set net_salary = 1 where id = $1", [recordId])).rejects.toThrow(/finalized and locked/);
    await expect(db.query("delete from payroll_deductions where payroll_record_id = $1", [recordId])).rejects.toThrow(/finalized/);
    await expect(db.query("update attendance set status = 'absent' where employee_id = $1 and work_date = '2026-01-05'", [empId])).rejects.toThrow(/finalized payroll/);
    await expect(db.query("update salary_structures set basic_salary = 45000 where id = $1", [structureId])).rejects.toThrow(/finalized payroll/);
    await expect(db.query("update payroll_periods set status = 'draft' where id = $1", [periodId])).rejects.toThrow(/finalized payroll period/);
    await expect(asUser(db, ids.admin, () => db.query("select finalize_payroll_period($1)", [periodId]))).rejects.toThrow(/already finalized/);
  });

  it("a new effective-dated salary structure leaves finalized payroll untouched", async () => {
    await db.query("insert into salary_structures(employee_id, basic_salary, bra2, bra1, performance_incentive, effective_from) values ($1, 45000, 5000, 3000, 2000, '2026-02-01')", [empId]);
    const old = await one<{ effective_to: string }>("select effective_to::text from salary_structures where id = $1", [structureId]);
    expect(old.effective_to).toBe("2026-01-31");
    const rec = await one<{ basic_salary: string }>("select basic_salary from payroll_records where id = $1", [recordId]);
    expect(rec.basic_salary).toBe("40000.00");
  });
});

describe("commission release recovery", () => {
  it("records a release for recovery in an open month, and blocks a second release", async () => {
    await db.query("update commission_records set status = 'released', released_date = '2026-02-10' where id = $1", [commissionId]);
    const c = await one<{ release_deduction_month: string }>("select release_deduction_month::text from commission_records where id = $1", [commissionId]);
    expect(c.release_deduction_month).toBe("2026-02-01");
    await expect(db.query("update commission_records set released_date = '2026-02-11' where id = $1", [commissionId])).rejects.toThrow(/already released/);
  });

  it("a release of a never-included commission produces no recovery month", async () => {
    const id = (await one<{ id: string }>(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
      values ($1, $2, 'sales', 'TX-2', 900, '2026-02-02', '2026-02-01', 'approved') returning id`, [empId, branchId])).id;
    await db.query("update commission_records set status = 'released', released_date = '2026-02-03' where id = $1", [id]);
    const c = await one<{ release_deduction_month: string | null }>("select release_deduction_month from commission_records where id = $1", [id]);
    expect(c.release_deduction_month).toBeNull();
  });

  it("rejects new inputs dated into a finalized month", async () => {
    await expect(db.query(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
      values ($1, $2, 'sales', 'TX-3', 100, '2026-01-20', '2026-01-01', 'approved')`, [empId, branchId])).rejects.toThrow(/already finalized/);
  });
});

describe("payslip email queue", () => {
  let slipId: string;
  it("refuses to email a payslip that has not been generated", async () => {
    slipId = (await one<{ id: string }>("select id from payslips where payroll_record_id = $1", [recordId])).id;
    await expect(db.query("select enqueue_payslip_email($1, false, null, 'Subject')", [slipId])).rejects.toThrow(/not been generated/);
  });

  it("creates exactly one automatic notification + queue job per payslip", async () => {
    await db.query("update payslips set status = 'generated', storage_path = 'x.pdf' where id = $1", [slipId]);
    const first = await one<{ id: string | null }>("select enqueue_payslip_email($1, false, null, 'Your Monthly Salary Payslip - January 2026') id", [slipId]);
    expect(first.id).toBeTruthy();
    const second = await one<{ id: string | null }>("select enqueue_payslip_email($1, false, null, 'dup') id", [slipId]);
    expect(second.id).toBeNull();
    const n = await one<{ n: number; q: number }>("select (select count(*)::int from email_notifications) n, (select count(*)::int from email_queue) q");
    expect(n).toEqual({ n: 1, q: 1 });
  });

  it("blocks a manual resend while the first email is still in flight", async () => {
    await expect(db.query("select enqueue_payslip_email($1, true, $2, 'resend')", [slipId, ids.hr])).rejects.toThrow(/already in progress/);
  });

  it("claims each job once (SKIP LOCKED + lock timestamp)", async () => {
    const a = await db.query("select * from claim_email_jobs(10, 'w1')");
    const b = await db.query("select * from claim_email_jobs(10, 'w2')");
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(0);
  });

  it("queue RPCs are not callable by signed-in users", async () => {
    await expect(asUser(db, ids.admin, () => db.query("select * from claim_email_jobs(10, 'x')"))).rejects.toThrow(/permission denied/);
  });
});

describe("row level security", () => {
  it("branch managers see their branch's employees but no salary data", async () => {
    const emps = await asUser(db, ids.bm, () => db.query<{ id: string }>("select id from employees"));
    expect(emps.rows.map((r) => r.id)).toEqual([empId]);
    const s = await asUser(db, ids.bm, () => db.query("select * from salary_structures"));
    expect(s.rows).toHaveLength(0);
    const p = await asUser(db, ids.bm, () => db.query("select * from payroll_records"));
    expect(p.rows).toHaveLength(0);
  });

  it("branch managers can submit only pending commissions for their own branch", async () => {
    await asUser(db, ids.bm, () => db.query(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
      values ($1, $2, 'repair', 'TX-BM-1', 300, '2026-02-02', '2026-02-01', 'pending')`, [empId, branchId]));
    await expect(asUser(db, ids.bm, () => db.query(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
      values ($1, $2, 'repair', 'TX-BM-2', 300, '2026-02-02', '2026-02-01', 'approved')`, [empId, branchId]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, ids.bm, () => db.query(`insert into commission_records(employee_id, branch_id, commission_type, transaction_id, amount, commission_date, payroll_month, status)
      values ($1, $2, 'repair', 'TX-BM-3', 300, '2026-02-02', '2026-02-01', 'pending')`, [emp2Id, otherBranchId]))).rejects.toThrow(/row-level security/);
  });

  it("employees see only their own finalized payroll and payslips", async () => {
    const recs = await asUser(db, ids.empUser, () => db.query<{ employee_id: string }>("select employee_id from payroll_records"));
    expect(recs.rows.every((r) => r.employee_id === empId)).toBe(true);
    expect(recs.rows).toHaveLength(1);
    const others = await asUser(db, ids.empUser, () => db.query("select * from employees where id = $1", [emp2Id]));
    expect(others.rows).toHaveLength(0);
    const slips = await asUser(db, ids.empUser, () => db.query("select * from payslips"));
    expect(slips.rows).toHaveLength(1);
    const emails = await asUser(db, ids.empUser, () => db.query("select * from email_notifications"));
    expect(emails.rows).toHaveLength(0);
  });

  it("nobody can write payroll results directly", async () => {
    await expect(asUser(db, ids.hr, () => db.query("insert into payroll_periods(payroll_month) values ('2026-03-01')"))).rejects.toThrow(/row-level security/);
    const upd = await asUser(db, ids.admin, () => db.query("update payroll_periods set notes = 'x' where id = $1", [periodId]));
    expect(upd.affectedRows ?? 0).toBe(0);
  });
});

describe("information exposure", () => {
  it("payroll issue lists are only visible to admins", async () => {
    const r = await asUser(db, ids.empUser, () => one<{ r: unknown[] }>("select payroll_blocking_issues($1) r", [periodId]));
    expect(r.r).toEqual([]);
  });
});
