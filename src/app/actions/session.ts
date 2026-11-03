"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MONTH_COOKIE } from "@/lib/month";
import { getProfile } from "@/lib/auth";

export async function setSelectedMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  (await cookies()).set(MONTH_COOKIE, `${month}-01`, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 90 });
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function markNotificationsRead() {
  const profile = await getProfile();
  if (!profile) return;
  const supabase = await createClient();
  // RLS limits this to notifications addressed to the user or their role
  await supabase.from("app_notifications").update({ is_read: true }).eq("is_read", false);
  revalidatePath("/", "layout");
}

export async function changePassword(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10) return { ok: false, message: "Use at least 10 characters." };
  if (password !== confirm) return { ok: false, message: "Passwords do not match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Password updated." };
}
