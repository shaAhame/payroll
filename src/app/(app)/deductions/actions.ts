"use server";
import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { manualDeductionSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalcAfterChange, recalcNote } from "@/lib/recalc";

/** Other authorized deductions: admin-only, always with a reason and the authorizing user recorded. */
export async function createManualDeduction(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const v = manualDeductionSchema.parse(input);
    const supabase = await createClient();
    const row = check(await supabase.from("manual_deductions").insert({ ...v, authorized_by: profile.id, status: "approved" }).select("id").single());
    await logAudit({ actorId: profile.id, action: "deduction.created", entityType: "manual_deduction", entityId: row.id, summary: `${v.amount} for ${v.payroll_month}: ${v.reason}` });
    const r = await recalcAfterChange(profile, supabase, [v.employee_id], [v.payroll_month]);
    revalidatePath("/deductions");
    revalidatePath("/payroll", "layout");
    return { ok: true as const, message: `Deduction recorded${recalcNote(r)}` };
  });
}

export async function cancelManualDeduction(id: string, reason?: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const row = check(await supabase.from("manual_deductions").update({ status: "cancelled" }).eq("id", id).is("processed_payroll_record_id", null)
      .select("employee_id, payroll_month").maybeSingle());
    if (!row) throw new Error("This deduction was already applied in a finalized payroll.");
    await logAudit({ actorId: profile.id, action: "deduction.cancelled", entityType: "manual_deduction", entityId: id, summary: reason });
    await recalcAfterChange(profile, supabase, [row.employee_id], [row.payroll_month]);
    revalidatePath("/deductions");
    return { ok: true as const, message: "Deduction cancelled" };
  });
}
