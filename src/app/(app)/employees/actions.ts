"use server";
import { revalidatePath } from "next/cache";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { employeeSchema, newEmployeeSchema, salarySchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalculateForEmployee } from "@/lib/payroll/service";

export async function createEmployee(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const { salary, ...emp } = newEmployeeSchema.parse(input);
    const supabase = await createClient();
    const created = check(await supabase.from("employees").insert({ ...emp, created_by: profile.id }).select("id, employee_code").single());
    const s = await supabase.from("salary_structures").insert({ ...salary, employee_id: created.id, created_by: profile.id });
    if (s.error) {
      // keep data consistent: an employee is only registered together with a salary structure
      await createAdminClient().from("employees").delete().eq("id", created.id);
      throw s.error;
    }
    await logAudit({ actorId: profile.id, action: "employee.created", entityType: "employee", entityId: created.id, summary: `Registered ${created.employee_code} ${emp.full_name}` });
    revalidatePath("/employees");
    return { ok: true as const, data: created, message: `Employee ${created.employee_code} registered` };
  });
}

export async function updateEmployee(id: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const values = employeeSchema.parse(input);
    const supabase = await createClient();
    const before = check(await supabase.from("employees").select("*").eq("id", id).single());
    check(await supabase.from("employees").update(values).eq("id", id));
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v));
    await logAudit({
      actorId: profile.id, action: "employee.updated", entityType: "employee", entityId: id, summary: `Updated ${Object.keys(changed).join(", ") || "no fields"}`,
      oldValues: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])), newValues: changed,
    });
    // designation/branch/EPF snapshot changes flow into open payroll on recalculation
    await recalculateForEmployee(supabase, id);
    revalidatePath(`/employees/${id}`);
    return { ok: true as const, message: "Employee updated" };
  });
}

export async function setEmployeeStatus(id: string, status: "active" | "inactive", reason?: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    check(await supabase.from("employees").update({ employment_status: status }).eq("id", id));
    await logAudit({ actorId: profile.id, action: `employee.${status === "active" ? "activated" : "deactivated"}`, entityType: "employee", entityId: id, summary: reason });
    revalidatePath(`/employees/${id}`);
    return { ok: true as const, message: status === "active" ? "Employee activated" : "Employee deactivated" };
  });
}

/** Adds a new effective-dated salary structure; earlier structures are closed automatically and finalized payroll is untouched. */
export async function addSalaryStructure(employeeId: string, input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const values = salarySchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("salary_structures").insert({ ...values, employee_id: employeeId, created_by: profile.id }));
    await logAudit({ actorId: profile.id, action: "salary_structure.created", entityType: "employee", entityId: employeeId, summary: `New salary structure effective ${values.effective_from}` });
    const r = await recalculateForEmployee(supabase, employeeId);
    revalidatePath(`/employees/${employeeId}`);
    return { ok: true as const, message: `Salary structure saved${r.calculated ? ` · ${r.calculated} open payroll record(s) recalculated` : ""}` };
  });
}

export async function uploadEmployeePhoto(employeeId: string, form: FormData) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
    if (file.size > 2 * 1024 * 1024) throw new Error("The image must be 2 MB or smaller.");
    const admin = createAdminClient();
    const ext = file.type.split("/")[1];
    const path = `${employeeId}/photo-${Date.now()}.${ext}`;
    const up = await admin.storage.from("employee-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;
    const supabase = await createClient();
    check(await supabase.from("employees").update({ photo_path: path }).eq("id", employeeId));
    await logAudit({ actorId: profile.id, action: "employee.photo_updated", entityType: "employee", entityId: employeeId });
    revalidatePath(`/employees/${employeeId}`);
    return { ok: true as const, message: "Photo updated" };
  });
}
