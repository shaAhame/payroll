import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recalculateForEmployee, recalculateStaleForEmployees } from "@/lib/payroll/service";
import type { Profile } from "@/lib/types";

/**
 * Inputs changed → recalculate the affected open payroll right away.
 * Admins recalculate with their own session; for Branch Manager edits (already
 * authorized by RLS) the deterministic engine runs with the service role.
 */
export async function recalcAfterChange(profile: Profile, userClient: SupabaseClient, employeeIds: string[], months?: string[]) {
  const client = profile.role === "super_admin" || profile.role === "hr_manager" ? userClient : createAdminClient();
  try {
    if (employeeIds.length === 1 && months) return await recalculateForEmployee(client, employeeIds[0], months);
    return await recalculateStaleForEmployees(client, employeeIds);
  } catch (e) {
    console.error("[recalc]", (e as Error).message);
    return { calculated: 0, failed: [{ recordId: "", error: (e as Error).message }] };
  }
}

export const recalcNote = (r: { calculated: number }) => (r.calculated ? ` · payroll recalculated` : "");
