import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BOUNCED = new Set(["hard_bounce", "invalid_email", "blocked"]);

function authorized(request: NextRequest) {
  const expected = serverEnv.brevoWebhookSecret();
  const given = request.nextUrl.searchParams.get("token") ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Brevo transactional webhook. Updates delivery status by message id
 * (falls back to our X-Mailin-custom reference). Never downgrades "delivered".
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const events: Record<string, unknown>[] = Array.isArray(body) ? body : body ? [body] : [];
  const admin = createAdminClient();

  for (const ev of events) {
    const event = String(ev.event ?? "");
    const messageId = (ev["message-id"] as string | undefined) ?? null;
    const custom = String(ev["X-Mailin-custom"] ?? "");
    await admin.from("email_webhook_events").insert({ brevo_message_id: messageId, event, payload: { event, date: ev.date, reason: ev.reason, ts_event: ev.ts_event, tags: ev.tags } });

    let q = admin.from("email_notifications").select("id, email_status, employee_id, attempt_count");
    if (messageId) q = q.eq("brevo_message_id", messageId);
    else if (custom.startsWith("notification:")) q = q.eq("id", custom.slice("notification:".length));
    else continue;
    const { data: n } = await q.maybeSingle();
    if (!n) continue;

    const when = typeof ev.ts_event === "number" ? new Date(ev.ts_event * 1000).toISOString() : new Date().toISOString();
    if (event === "delivered") {
      await admin.from("email_notifications").update({ email_status: "delivered", delivered_at: when, failure_reason: null }).eq("id", n.id);
    } else if (BOUNCED.has(event)) {
      await admin.from("email_notifications").update({ email_status: "bounced", failure_reason: String(ev.reason ?? event) }).eq("id", n.id);
      if (event !== "blocked") await admin.from("employees").update({ email_verification_status: "invalid" }).eq("id", n.employee_id);
    } else if (event === "error") {
      if (n.email_status !== "delivered") await admin.from("email_notifications").update({ email_status: "failed", failure_reason: String(ev.reason ?? "Provider error") }).eq("id", n.id);
    } else if (event === "soft_bounce" || event === "deferred") {
      if (n.email_status !== "delivered") await admin.from("email_notifications").update({ failure_reason: `${event}: ${String(ev.reason ?? "")}`.trim() }).eq("id", n.id);
    }
    // request/opened/click etc. are recorded in email_webhook_events only
  }
  return NextResponse.json({ ok: true });
}
