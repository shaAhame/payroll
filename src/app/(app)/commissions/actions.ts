"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireRole, STAFF_ROLES } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { commissionSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalcAfterChange, recalcNote } from "@/lib/recalc";

export async function createCommission(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    const v = commissionSchema.parse(input);
    const approve = (input as { approve?: boolean })?.approve === true && ADMIN_ROLES.includes(profile.role);
    const supabase = await createClient();
    const emp = check(await supabase.from("employees").select("branch_id").eq("id", v.employee_id).single());
    check(await supabase.from("commission_records").insert({
      ...v, branch_id: emp.branch_id, status: approve ? "approved" : "pending", created_by: profile.id,
      ...(approve ? { approved_by: profile.id, approved_at: new Date().toISOString() } : {}),
    }));
    await logAudit({ actorId: profile.id, action: "commission.created", entityType: "employee", entityId: v.employee_id, summary: `${v.commission_type} ${v.transaction_id} ${v.amount}` });
    const r = approve ? await recalcAfterChange(profile, supabase, [v.employee_id], [v.payroll_month]) : { calculated: 0 };
    revalidatePath("/commissions");
    return { ok: true as const, message: `Commission recorded${approve ? "" : " — awaiting approval"}${recalcNote(r)}` };
  });
}

export async function setCommissionStatus(id: string, status: "approved" | "pending" | "cancelled", reason?: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const row = check(await supabase.from("commission_records").update({
      status, approved_by: status === "approved" ? profile.id : null, approved_at: status === "approved" ? new Date().toISOString() : null,
      ...(reason ? { notes: reason } : {}),
    }).eq("id", id).in("status", ["pending", "approved"]).select("employee_id, payroll_month").maybeSingle());
    if (!row) throw new Error("Only pending or approved commissions can be changed this way.");
    await logAudit({ actorId: profile.id, action: `commission.${status}`, entityType: "commission", entityId: id, summary: reason });
    const r = await recalcAfterChange(profile, supabase, [row.employee_id], [row.payroll_month]);
    revalidatePath("/commissions");
    return { ok: true as const, message: `Commission ${status}${recalcNote(r)}` };
  });
}

export async function approveAllPending(month: string, branchId?: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    let q = supabase.from("commission_records").update({ status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() })
      .eq("status", "pending").eq("payroll_month", month);
    if (branchId) q = q.eq("branch_id", branchId);
    const rows = check(await q.select("employee_id")) as { employee_id: string }[];
    await logAudit({ actorId: profile.id, action: "commission.bulk_approved", entityType: "commission", summary: `${rows.length} for ${month}` });
    await recalcAfterChange(profile, supabase, [...new Set(rows.map((r) => r.employee_id))]);
    revalidatePath("/commissions");
    return { ok: true as const, message: `${rows.length} commission(s) approved` };
  });
}

const releaseSchema = z.object({
  released_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was paid"),
  release_deduction_month: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal("")]).optional(),
});

/**
 * Records that a commission was paid out separately. A recovery deduction is
 * created only if the commission was already paid as a payroll earning;
 * otherwise nothing is deducted (it was simply paid outside payroll).
 */
export async function releaseCommission(id: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const v = releaseSchema.parse(input);
    const supabase = await createClient();
    const c = check(await supabase.from("commission_records").select("*").eq("id", id).single());
    if (c.status === "released") throw new Error("This commission has already been released.");
    if (!["approved", "included_in_payroll"].includes(c.status)) throw new Error("Only approved or paid commissions can be released.");
    const row = check(await supabase.from("commission_records").update({
      status: "released", released_date: v.released_date,
      release_deduction_month: c.included_payroll_record_id && v.release_deduction_month ? `${v.release_deduction_month}-01` : null,
    }).eq("id", id).select("employee_id, release_deduction_month, payroll_month").single());
    await logAudit({ actorId: profile.id, action: "commission.released", entityType: "commission", entityId: id,
      summary: row.release_deduction_month ? `Released ${v.released_date}; recovered in ${row.release_deduction_month}` : `Released ${v.released_date}; not paid via payroll, no deduction` });
    const r = await recalcAfterChange(profile, supabase, [row.employee_id]);
    revalidatePath("/commissions");
    return {
      ok: true as const,
      message: row.release_deduction_month ? `Release recorded. It will be recovered as a deduction in that month's payroll${recalcNote(r)}` : "Release recorded. It was never paid in payroll, so nothing will be deducted.",
    };
  });
}

export async function undoRelease(id: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const c = check(await supabase.from("commission_records").select("*").eq("id", id).single());
    if (c.status !== "released" || c.release_deducted_payroll_record_id) throw new Error("This release has already been recovered in a finalized payroll.");
    check(await supabase.from("commission_records").update({
      status: c.included_payroll_record_id ? "included_in_payroll" : "approved", released_date: null, release_deduction_month: null,
    }).eq("id", id));
    await logAudit({ actorId: profile.id, action: "commission.release_undone", entityType: "commission", entityId: id });
    await recalcAfterChange(profile, supabase, [c.employee_id]);
    revalidatePath("/commissions");
    return { ok: true as const, message: "Release undone" };
  });
}

export async function deleteCommission(id: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const c = check(await supabase.from("commission_records").select("*").eq("id", id).single());
    if (!["pending", "cancelled"].includes(c.status)) throw new Error("Only pending or cancelled commissions can be deleted. Cancel an approved commission instead.");
    check(await supabase.from("commission_records").delete().eq("id", id));
    await logAudit({ actorId: profile.id, action: "commission.deleted", entityType: "commission", entityId: id, oldValues: c });
    revalidatePath("/commissions");
    return { ok: true as const, message: "Commission deleted" };
  });
}
