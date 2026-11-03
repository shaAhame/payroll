import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Append an audit entry. Values must not contain full payslip contents. */
export async function logAudit(entry: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  oldValues?: unknown;
  newValues?: unknown;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    summary: entry.summary ?? null,
    old_values: entry.oldValues ?? null,
    new_values: entry.newValues ?? null,
  });
  if (error) console.error("[audit] failed", error.message);
}
