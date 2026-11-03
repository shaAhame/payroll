import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use only after an explicit permission
 * check in server code (or in trusted background jobs/webhooks). Never import
 * from client components.
 */
export function createAdminClient() {
  return createClient(serverEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
