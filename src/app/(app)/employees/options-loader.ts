import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBranches } from "@/lib/queries";
import { branchOptions } from "@/lib/options";

export async function loadEmployeeFormOptions(supabase: SupabaseClient) {
  const [branches, departments, shifts] = await Promise.all([
    listBranches(supabase),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("shifts").select("id, name, start_time, end_time, branch_id, branches!shifts_branch_id_fkey(name)").eq("is_active", true).order("name"),
  ]);
  return {
    branches: branchOptions(branches),
    departments: (departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    shifts: ((shifts.data ?? []) as unknown as { id: string; name: string; start_time: string; end_time: string; branches: { name: string } | null }[])
      .map((s) => ({ value: s.id, label: `${s.name} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`, group: s.branches?.name ?? "All branches" })),
  };
}
