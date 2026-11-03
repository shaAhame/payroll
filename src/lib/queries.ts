import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function listBranches(supabase: SupabaseClient, includeInactive = false) {
  let q = supabase.from("branches").select("id, name, code, is_active, allocated_working_days").order("name");
  if (!includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as { id: string; name: string; code: string; is_active: boolean; allocated_working_days: string | null }[];
}

export async function listEmployeesLite(supabase: SupabaseClient, opts: { branchId?: string | null; activeOnly?: boolean } = {}) {
  let q = supabase.from("employees").select("id, employee_code, full_name, branch_id, designation").order("full_name").limit(5000);
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  if (opts.activeOnly !== false) q = q.eq("employment_status", "active");
  const { data } = await q;
  return (data ?? []) as { id: string; employee_code: string; full_name: string; branch_id: string; designation: string }[];
}

export const sp = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function pageRange(page: number, size: number) {
  const p = Math.max(1, page || 1);
  return { page: p, from: (p - 1) * size, to: p * size - 1 };
}
