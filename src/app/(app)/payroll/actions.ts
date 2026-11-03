"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { createPayrollPeriod, recalculatePeriod, recalculateRecords } from "@/lib/payroll/service";
import { processJobs } from "@/lib/jobs/runner";
import { formatMonth, monthEnd } from "@/lib/format";

const runSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Select a month"),
  branch_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
});

export async function runPayroll(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const { month, branch_id } = runSchema.parse(input);
    const monthStart = `${month}-01`;
    const { period, created, skipped } = await createPayrollPeriod(createAdminClient(), { month: monthStart, branchId: branch_id, userId: profile.id });
    const supabase = await createClient();
    const r = await recalculatePeriod(supabase, period.id, false);
    await logAudit({ actorId: profile.id, action: "payroll.created", entityType: "payroll_period", entityId: period.id, summary: `${formatMonth(monthStart)}: ${created} employees` });
    revalidatePath("/payroll");
    return {
      ok: true as const, data: { id: period.id },
      message: `Payroll created for ${created} employee(s)${skipped ? `, ${skipped} skipped (already in another payroll for this month)` : ""}. ${r.calculated} calculated${r.failed.length ? `, ${r.failed.length} failed` : ""}.`,
    };
  });
}

export async function recalcPeriod(periodId: string, all = false) {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const r = await recalculatePeriod(supabase, periodId, !all);
    revalidatePath(`/payroll/${periodId}`);
    if (r.failed.length) return { ok: false as const, error: `${r.failed.length} record(s) failed: ${r.failed[0].error}` };
    return { ok: true as const, message: r.calculated ? `${r.calculated} record(s) recalculated` : "Everything is up to date" };
  });
}

export async function addMissingEmployees(periodId: string) {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const admin = createAdminClient();
    const period = check(await admin.from("payroll_periods").select("*").eq("id", periodId).single());
    if (period.status === "finalized") throw new Error("This payroll is finalized.");
    let q = admin.from("employees").select("id, employee_code, full_name, designation, epf_number, branch_id, branches(name)")
      .eq("employment_status", "active").lte("employment_start_date", monthEnd(period.payroll_month));
    if (period.branch_id) q = q.eq("branch_id", period.branch_id);
    const emps = check(await q) as unknown as { id: string; employee_code: string; full_name: string; designation: string; epf_number: string | null; branch_id: string; branches: { name: string } | null }[];
    const existing = new Set((check(await admin.from("payroll_records").select("employee_id").eq("payroll_month", period.payroll_month)) as { employee_id: string }[]).map((r) => r.employee_id));
    const rows = emps.filter((e) => !existing.has(e.id)).map((e) => ({
      payroll_period_id: periodId, employee_id: e.id, payroll_month: period.payroll_month, employee_code: e.employee_code, employee_name: e.full_name,
      designation: e.designation, epf_number: e.epf_number, branch_id: e.branch_id, branch_name: e.branches?.name ?? "", status: period.status === "draft" ? "draft" : period.status,
    }));
    if (!rows.length) return { ok: true as const, message: "No missing employees" };
    if (period.status !== "draft" && period.status !== "processing") throw new Error("Return the payroll to draft before adding employees.");
    check(await admin.from("payroll_records").insert(rows));
    await recalculatePeriod(await createClient(), periodId, true);
    revalidatePath(`/payroll/${periodId}`);
    return { ok: true as const, message: `${rows.length} employee(s) added` };
  });
}

export async function deleteDraftPeriod(periodId: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const admin = createAdminClient();
    const period = check(await admin.from("payroll_periods").select("status, payroll_month").eq("id", periodId).single());
    if (period.status !== "draft") throw new Error("Only draft payroll can be deleted.");
    check(await admin.from("payroll_periods").delete().eq("id", periodId));
    await logAudit({ actorId: profile.id, action: "payroll.deleted", entityType: "payroll_period", entityId: periodId, summary: `Draft ${formatMonth(period.payroll_month)} deleted` });
    revalidatePath("/payroll");
    return { ok: true as const, message: "Draft payroll deleted" };
  });
}

export async function submitPeriod(periodId: string) {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    await recalculatePeriod(supabase, periodId, true); // always recalculate stale records first
    check(await supabase.rpc("submit_payroll_period", { p_period_id: periodId }));
    revalidatePath(`/payroll/${periodId}`);
    return { ok: true as const, message: "Submitted for approval" };
  });
}

export async function approvePeriod(periodId: string) {
  return runAction(async () => {
    await requireRole(["super_admin"]);
    const supabase = await createClient();
    check(await supabase.rpc("approve_payroll_period", { p_period_id: periodId }));
    revalidatePath(`/payroll/${periodId}`);
    return { ok: true as const, message: "Payroll approved" };
  });
}

export async function returnToDraft(periodId: string, reason?: string) {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    check(await supabase.rpc("return_payroll_to_draft", { p_period_id: periodId, p_reason: reason ?? "" }));
    revalidatePath(`/payroll/${periodId}`);
    return { ok: true as const, message: "Returned to draft" };
  });
}

export async function finalizePeriod(periodId: string) {
  return runAction(async () => {
    await requireRole(["super_admin"]);
    const supabase = await createClient();
    const stale = await recalculatePeriod(supabase, periodId, true);
    if (stale.calculated > 0) {
      throw new Error(`${stale.calculated} record(s) changed and were recalculated just now. Review and approve again before finalizing.`);
    }
    const res = check(await supabase.rpc("finalize_payroll_period", { p_period_id: periodId })) as { payslips_queued: number };
    // Generate the first payslips immediately; the scheduled worker finishes the rest.
    const jobs = await processJobs({ timeBudgetMs: 25_000 });
    revalidatePath(`/payroll/${periodId}`);
    return {
      ok: true as const,
      message: `Payroll finalized. ${jobs.payslipsGenerated} of ${res.payslips_queued} payslip(s) generated so far, ${jobs.emailsSent} email(s) sent; the background worker continues automatically.`,
    };
  });
}

export async function runJobsNow() {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const r = await processJobs({ timeBudgetMs: 40_000 });
    return { ok: true as const, message: `Generated ${r.payslipsGenerated} payslip(s); sent ${r.emailsSent} email(s); ${r.emailsFailed} failed attempt(s).` };
  });
}

export async function recalcRecord(recordId: string) {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const r = await recalculateRecords(supabase, [recordId]);
    if (r.failed.length) throw new Error(r.failed[0].error);
    revalidatePath("/payroll", "layout");
    return { ok: true as const, message: "Recalculated" };
  });
}

/** Employee-specific working-day allocation for the record's month (an input change, so the record is recalculated). */
export async function setRecordAllocation(recordId: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const { allocated_days, notes } = z.object({ allocated_days: z.coerce.number().gt(0).max(31), notes: z.string().optional() }).parse(input);
    const supabase = await createClient();
    const rec = check(await supabase.from("payroll_records").select("employee_id, payroll_month, status").eq("id", recordId).single());
    if (rec.status === "finalized") throw new Error("This payroll is finalized.");
    const existing = (await supabase.from("working_day_allocations").select("id").eq("employee_id", rec.employee_id).eq("payroll_month", rec.payroll_month).maybeSingle()).data;
    if (existing) check(await supabase.from("working_day_allocations").update({ allocated_days, notes: notes || null }).eq("id", existing.id));
    else check(await supabase.from("working_day_allocations").insert({ employee_id: rec.employee_id, payroll_month: rec.payroll_month, allocated_days, notes: notes || null, created_by: profile.id }));
    await recalculateRecords(supabase, [recordId]);
    await logAudit({ actorId: profile.id, action: "allocation.employee_set", entityType: "payroll_record", entityId: recordId, summary: `Allocated days set to ${allocated_days}` });
    revalidatePath("/payroll", "layout");
    return { ok: true as const, message: "Allocated working days updated" };
  });
}

const adjustmentSchema = z.object({
  kind: z.enum(["earning", "deduction"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount").refine((v) => Number(v) > 0, "Must be greater than zero"),
  reason: z.string().trim().min(5, "Explain the correction"),
  target_month: z.string().regex(/^\d{4}-\d{2}$/, "Select the month to apply it in"),
});

/**
 * Authorized correction of a finalized payroll: never edits the locked record;
 * records an arrears earning or a recovery deduction in an open month, linked to the original.
 */
export async function createAdjustment(recordId: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const v = adjustmentSchema.parse(input);
    const supabase = await createClient();
    const rec = check(await supabase.from("payroll_records").select("employee_id, branch_id, payroll_month, employee_code, status").eq("id", recordId).single());
    if (rec.status !== "finalized") throw new Error("Adjustments apply to finalized payroll. Edit the inputs of open payroll instead.");
    const target = `${v.target_month}-01`;
    if (target <= rec.payroll_month) throw new Error("The adjustment must be applied in a later month.");
    const label = `Adjustment for ${formatMonth(rec.payroll_month)}: ${v.reason}`;
    if (v.kind === "earning") {
      check(await supabase.from("additional_earnings").insert({
        employee_id: rec.employee_id, branch_id: rec.branch_id, category: "other", amount: v.amount, earning_date: new Date().toISOString().slice(0, 10),
        payroll_month: target, description: label, approval_status: "approved", approved_by: profile.id, approved_at: new Date().toISOString(),
        adjusts_payroll_record_id: recordId, created_by: profile.id,
      }));
    } else {
      check(await supabase.from("manual_deductions").insert({
        employee_id: rec.employee_id, payroll_month: target, amount: v.amount, reason: label, authorized_by: profile.id, adjusts_payroll_record_id: recordId,
      }));
    }
    await logAudit({ actorId: profile.id, action: "payroll.adjustment", entityType: "payroll_record", entityId: recordId, summary: `${v.kind} ${v.amount} in ${formatMonth(target)}: ${v.reason}` });
    return { ok: true as const, message: `Adjustment recorded for ${formatMonth(target)}. It will be included when that payroll is calculated.` };
  });
}

