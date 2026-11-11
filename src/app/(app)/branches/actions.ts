"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { branchSchema, shiftSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";

export async function saveBranch(id: string | null, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const v = branchSchema.parse(input);
    const supabase = await createClient();
    if (id) check(await supabase.from("branches").update(v).eq("id", id));
    else check(await supabase.from("branches").insert(v));
    await logAudit({ actorId: profile.id, action: id ? "branch.updated" : "branch.created", entityType: "branch", entityId: id ?? undefined, newValues: v });
    revalidatePath("/branches");
    return { ok: true as const, message: id ? "Branch updated" : "Branch created" };
  });
}

export async function setBranchActive(id: string, active: boolean) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const supabase = await createClient();
    if (!active) {
      const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("branch_id", id).eq("employment_status", "active");
      if (count) throw new Error(`Move or deactivate the branch's ${count} active employee(s) first.`);
    }
    check(await supabase.from("branches").update({ is_active: active }).eq("id", id));
    await logAudit({ actorId: profile.id, action: active ? "branch.activated" : "branch.deactivated", entityType: "branch", entityId: id });
    revalidatePath("/branches");
    return { ok: true as const, message: active ? "Branch activated" : "Branch deactivated" };
  });
}

export async function saveShift(id: string | null, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin", "hr_manager"]);
    const v = shiftSchema.parse(input);
    const supabase = await createClient();
    if (id) check(await supabase.from("shifts").update(v).eq("id", id));
    else check(await supabase.from("shifts").insert(v));
    await logAudit({ actorId: profile.id, action: id ? "shift.updated" : "shift.created", entityType: "shift", entityId: id ?? undefined, newValues: v });
    revalidatePath("/branches");
    return { ok: true as const, message: "Shift saved" };
  });
}

export async function deleteShift(id: string) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin", "hr_manager"]);
    const supabase = await createClient();
    const before = check(await supabase.from("shifts").select("*").eq("id", id).single());
    check(await supabase.from("shifts").delete().eq("id", id));
    await logAudit({ actorId: profile.id, action: "shift.deleted", entityType: "shift", entityId: id, oldValues: before });
    revalidatePath("/branches");
    return { ok: true as const, message: "Shift deleted" };
  });
}
