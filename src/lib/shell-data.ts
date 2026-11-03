import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TopbarNotification } from "@/components/app/topbar";

export async function loadShellData() {
  const supabase = await createClient();
  const [company, notes] = await Promise.all([
    supabase.from("company_settings").select("company_name").limit(1).maybeSingle(),
    supabase.from("app_notifications").select("id, title, body, link, is_read, created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  return {
    companyName: (company.data?.company_name as string) ?? "Payroll",
    notifications: (notes.data ?? []) as TopbarNotification[],
  };
}
