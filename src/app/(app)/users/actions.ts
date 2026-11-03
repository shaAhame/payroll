"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { userSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { serverEnv } from "@/lib/env";

/** Super Admin invites a user: Supabase emails a link to set their password; the role lives in profiles. */
export async function inviteUser(input: unknown) {
  return runAction(async () => {
    const actor = await requireRole(["super_admin"]);
    const v = userSchema.parse(input);
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, {
      redirectTo: `${serverEnv.appUrl()}/auth/callback?next=/account`, data: { full_name: v.full_name },
    });
    if (error) throw new Error(error.message.includes("already been registered") ? "A user with this email already exists." : error.message);
    const p = await admin.from("profiles").insert({
      id: data.user.id, full_name: v.full_name, email: v.email, role: v.role,
      branch_id: v.role === "branch_manager" ? v.branch_id : null, employee_id: v.role === "employee" ? v.employee_id : null,
    });
    if (p.error) { await admin.auth.admin.deleteUser(data.user.id); throw p.error; }
    await logAudit({ actorId: actor.id, action: "user.invited", entityType: "profile", entityId: data.user.id, summary: `${v.email} as ${v.role}` });
    revalidatePath("/users");
    return { ok: true as const, message: `Invitation sent to ${v.email}` };
  });
}

export async function updateUser(id: string, input: unknown) {
  return runAction(async () => {
    const actor = await requireRole(["super_admin"]);
    const v = userSchema.parse(input);
    if (id === actor.id && v.role !== "super_admin") throw new Error("You cannot remove your own Super Admin role.");
    const admin = createAdminClient();
    check(await admin.from("profiles").update({
      full_name: v.full_name, role: v.role, branch_id: v.role === "branch_manager" ? v.branch_id : null, employee_id: v.role === "employee" ? v.employee_id : null,
    }).eq("id", id));
    await logAudit({ actorId: actor.id, action: "user.updated", entityType: "profile", entityId: id, newValues: { role: v.role, branch_id: v.branch_id, employee_id: v.employee_id } });
    revalidatePath("/users");
    return { ok: true as const, message: "User updated" };
  });
}

export async function setUserActive(id: string, active: boolean) {
  return runAction(async () => {
    const actor = await requireRole(["super_admin"]);
    if (id === actor.id) throw new Error("You cannot deactivate your own account.");
    const admin = createAdminClient();
    check(await admin.from("profiles").update({ is_active: active }).eq("id", id));
    // also block sign-in at the auth layer
    await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    await logAudit({ actorId: actor.id, action: active ? "user.activated" : "user.deactivated", entityType: "profile", entityId: id });
    revalidatePath("/users");
    return { ok: true as const, message: active ? "User activated" : "User deactivated" };
  });
}

export async function sendPasswordReset(email: string) {
  return runAction(async () => {
    const actor = await requireRole(["super_admin"]);
    const admin = createAdminClient();
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${serverEnv.appUrl()}/auth/callback?next=/account` });
    if (error) throw error;
    await logAudit({ actorId: actor.id, action: "user.password_reset_sent", entityType: "profile", summary: email });
    return { ok: true as const, message: `Password reset email sent to ${email}` };
  });
}
