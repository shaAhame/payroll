"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { advanceSchema, loanSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalcAfterChange } from "@/lib/recalc";

type Table = "salary_advances" | "employee_loans";

export async function createAdvance(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const v = advanceSchema.parse(input);
    const supabase = await createClient();
    const row = check(await supabase.from("salary_advances").insert({ ...v, outstanding_balance: v.amount, created_by: profile.id }).select("id").single());
    await logAudit({ actorId: profile.id, action: "advance.created", entityType: "salary_advance", entityId: row.id, summary: `${v.amount}, ${v.monthly_repayment}/month from ${v.repayment_start_month}` });
    await recalcAfterChange(profile, supabase, [v.employee_id]);
    revalidatePath("/advances");
    return { ok: true as const, message: "Salary advance recorded" };
  });
}

export async function createLoan(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const v = loanSchema.parse(input);
    const supabase = await createClient();
    const row = check(await supabase.from("employee_loans").insert({ ...v, outstanding_balance: v.original_amount, created_by: profile.id }).select("id").single());
    await logAudit({ actorId: profile.id, action: "loan.created", entityType: "employee_loan", entityId: row.id, summary: `${v.original_amount}, ${v.monthly_repayment}/month from ${v.repayment_start_month}` });
    await recalcAfterChange(profile, supabase, [v.employee_id]);
    revalidatePath("/loans");
    return { ok: true as const, message: "Loan recorded" };
  });
}

/** Hold/resume/cancel and instalment changes. Balances only ever change through finalized payroll. */
export async function updatePlan(table: Table, id: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    if (!["salary_advances", "employee_loans"].includes(table)) throw new Error("Invalid record type");
    const v = z.object({
      status: z.enum(["active", "on_hold", "cancelled"]).optional(),
      monthly_repayment: z.string().regex(/^\d+(\.\d{1,2})?$/).refine((x) => Number(x) > 0, "Must be greater than zero").optional(),
      remarks: z.string().max(500).optional(),
    }).parse(input);
    const supabase = await createClient();
    const before = check(await supabase.from(table).select("*").eq("id", id).single());
    if (before.status === "completed") throw new Error("This plan is fully repaid.");
    const row = check(await supabase.from(table).update(v).eq("id", id).select("employee_id").single());
    await logAudit({ actorId: profile.id, action: `${table === "employee_loans" ? "loan" : "advance"}.updated`, entityType: table, entityId: id, oldValues: { status: before.status, monthly_repayment: before.monthly_repayment }, newValues: v });
    await recalcAfterChange(profile, supabase, [row.employee_id]);
    revalidatePath(table === "employee_loans" ? "/loans" : "/advances");
    return { ok: true as const, message: "Updated" };
  });
}
