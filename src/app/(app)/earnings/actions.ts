"use server";
import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, requireRole, STAFF_ROLES } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { earningSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalcAfterChange, recalcNote } from "@/lib/recalc";

const COMMISSION_CATEGORY: Record<string, string> = {
  sales_commission: "sales", pre_owned_commission: "pre_owned", company_device_commission: "company_device", repair_commission: "repair",
};

/**
 * Performance incentives and other earnings are stored as additional earnings;
 * commission categories are routed to the commission register (single source
 * of truth, so a commission can never be entered twice). Additional working
 * pay is never entered manually — it comes from attendance.
 */
export async function createEarning(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    const v = earningSchema.parse(input);
    const approve = (input as { approve?: boolean })?.approve === true && ADMIN_ROLES.includes(profile.role);
    const supabase = await createClient();
    const emp = check(await supabase.from("employees").select("branch_id").eq("id", v.employee_id).single());
    const approval = approve ? { approved_by: profile.id, approved_at: new Date().toISOString() } : {};
    if (COMMISSION_CATEGORY[v.category]) {
      if (!v.transaction_reference) throw new Error("A transaction reference is required for commissions.");
      check(await supabase.from("commission_records").insert({
        employee_id: v.employee_id, branch_id: emp.branch_id, commission_type: COMMISSION_CATEGORY[v.category], transaction_id: v.transaction_reference,
        amount: v.amount, commission_date: v.earning_date, payroll_month: v.payroll_month, notes: v.description, status: approve ? "approved" : "pending",
        created_by: profile.id, ...approval,
      }));
    } else {
      check(await supabase.from("additional_earnings").insert({
        employee_id: v.employee_id, branch_id: emp.branch_id, category: v.category, amount: v.amount, transaction_reference: v.transaction_reference,
        earning_date: v.earning_date, payroll_month: v.payroll_month, description: v.description, approval_status: approve ? "approved" : "pending",
        created_by: profile.id, ...approval,
      }));
    }
    await logAudit({ actorId: profile.id, action: "earning.created", entityType: "employee", entityId: v.employee_id, summary: `${v.category} ${v.amount} for ${v.payroll_month}${approve ? " (approved)" : ""}` });
    const r = approve ? await recalcAfterChange(profile, supabase, [v.employee_id], [v.payroll_month]) : { calculated: 0 };
    revalidatePath("/earnings");
    revalidatePath("/payroll", "layout");
    return { ok: true as const, message: `Earning recorded${approve ? "" : " — awaiting approval"}${recalcNote(r)}` };
  });
}

export async function setEarningStatus(id: string, status: "approved" | "rejected" | "cancelled") {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const row = check(await supabase.from("additional_earnings").update({
      approval_status: status, approved_by: status === "approved" ? profile.id : null, approved_at: status === "approved" ? new Date().toISOString() : null,
    }).eq("id", id).select("employee_id, payroll_month").single());
    await logAudit({ actorId: profile.id, action: `earning.${status}`, entityType: "additional_earning", entityId: id });
    const r = await recalcAfterChange(profile, supabase, [row.employee_id], [row.payroll_month]);
    revalidatePath("/earnings");
    return { ok: true as const, message: `Earning ${status}${recalcNote(r)}` };
  });
}

export async function deleteEarning(id: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const row = check(await supabase.from("additional_earnings").select("*").eq("id", id).single());
    check(await supabase.from("additional_earnings").delete().eq("id", id));
    await logAudit({ actorId: profile.id, action: "earning.deleted", entityType: "additional_earning", entityId: id, oldValues: row });
    await recalcAfterChange(profile, supabase, [row.employee_id], [row.payroll_month]);
    revalidatePath("/earnings");
    return { ok: true as const, message: "Earning deleted" };
  });
}
