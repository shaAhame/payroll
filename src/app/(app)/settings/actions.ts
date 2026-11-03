"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { companySchema, payrollSettingsSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalculateRecords } from "@/lib/payroll/service";

export async function savePayrollSettings(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const v = payrollSettingsSchema.parse(input);
    const supabase = await createClient();
    const before = check(await supabase.from("payroll_settings").select("*").limit(1).single());
    check(await supabase.from("payroll_settings").update(v).eq("singleton", true));
    const changed = Object.fromEntries(Object.entries(v).filter(([k, val]) => String((before as Record<string, unknown>)[k]) !== String(val)));
    await logAudit({ actorId: profile.id, action: "payroll_settings.updated", entityType: "payroll_settings", oldValues: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])), newValues: changed });
    // every open payroll record is now stale; recalculate them with the new settings
    const ids = ((check(await supabase.from("payroll_records").select("id").neq("status", "finalized").limit(5000))) as { id: string }[]).map((r) => r.id);
    const r = await recalculateRecords(supabase, ids);
    revalidatePath("/settings/payroll");
    return { ok: true as const, message: `Payroll settings saved${r.calculated ? ` · ${r.calculated} open payroll record(s) recalculated` : ""}` };
  });
}

export async function saveCompany(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const v = companySchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("company_settings").update(v).eq("singleton", true));
    await logAudit({ actorId: profile.id, action: "company_settings.updated", entityType: "company_settings", newValues: v });
    revalidatePath("/", "layout");
    return { ok: true as const, message: "Company settings saved" };
  });
}

export async function uploadLogo(form: FormData) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const file = form.get("logo");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a PNG or JPG file.");
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("The payslip PDF supports PNG or JPG logos.");
    if (file.size > 1024 * 1024) throw new Error("The logo must be 1 MB or smaller.");
    const path = `logo-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const admin = createAdminClient();
    const up = await admin.storage.from("company-assets").upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    check(await admin.from("company_settings").update({ logo_path: path }).eq("singleton", true));
    await logAudit({ actorId: profile.id, action: "company_settings.logo_updated", entityType: "company_settings" });
    revalidatePath("/settings/company");
    return { ok: true as const, message: "Logo updated" };
  });
}

export async function saveDepartment(id: string | null, input: unknown) {
  return runAction(async () => {
    await requireRole(["super_admin", "hr_manager"]);
    const v = z.object({ name: z.string().trim().min(2).max(80) }).parse(input);
    const supabase = await createClient();
    if (id) check(await supabase.from("departments").update(v).eq("id", id));
    else check(await supabase.from("departments").insert(v));
    revalidatePath("/settings/company");
    return { ok: true as const, message: "Department saved" };
  });
}
