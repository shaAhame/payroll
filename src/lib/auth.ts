import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  hr_manager: "HR / Payroll Manager",
  branch_manager: "Branch Manager",
  employee: "Employee",
};

export const ADMIN_ROLES: AppRole[] = ["super_admin", "hr_manager"];
export const STAFF_ROLES: AppRole[] = ["super_admin", "hr_manager", "branch_manager"];

export class AuthorizationError extends Error {}

/** The signed-in user's active profile, or null. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data || !data.is_active) return null;
  return data as Profile;
});

/** For pages: redirect when signed out or not permitted. */
export async function requirePageRole(roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login?error=no_profile");
  if (!roles.includes(profile.role)) redirect(profile.role === "employee" ? "/portal" : "/dashboard?denied=1");
  return profile;
}

/** For server actions and route handlers: throw when not permitted. */
export async function requireRole(roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) throw new AuthorizationError("You are not signed in.");
  if (!roles.includes(profile.role)) throw new AuthorizationError("You do not have permission to perform this action.");
  return profile;
}

export function can(profile: Profile | null, roles: AppRole[]): boolean {
  return !!profile && roles.includes(profile.role);
}
