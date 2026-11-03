import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { EmptyState, KV, PageHeader, Section, StatCard } from "@/components/app/page-header";
import { FilterBar, Pagination } from "@/components/app/filter-bar";
import { LinkTabs } from "@/components/app/link-tabs";
import { ActionButton } from "@/components/app/action-button";
import { SchemaForm } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkBrevoConnection } from "@/lib/email/brevo";
import { payslipEmailHtml, payslipSubject } from "@/lib/email/template";
import { serverEnv } from "@/lib/env";
import { pageRange, sp } from "@/lib/queries";
import { formatMonth } from "@/lib/format";
import { retryAllFailed, saveEmailSettings } from "./actions";
import { TestEmailForm } from "./client";
import { NotificationTable, type NotificationRow } from "./table";

export const metadata = { title: "Email Notifications" };
export const maxDuration = 120;
const PAGE = 50;

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requirePageRole(ADMIN_ROLES);
  const params = await searchParams;
  const tab = sp(params.tab) || "notifications";
  const supabase = await createClient();
  const isSuper = profile.role === "super_admin";

  return (
    <>
      <PageHeader title="Email Notifications" description="Payslip emails are sent through Brevo by a background worker after payroll finalization. “Sent” means accepted by Brevo; “Delivered” comes from Brevo webhooks." />
      <LinkTabs tabs={[{ key: "notifications", label: "Delivery dashboard" }, { key: "settings", label: "Email settings" }]} active={tab} base="/emails" />
      {tab === "notifications" ? <Notifications params={params} /> : <Settings isSuper={isSuper} />}
    </>
  );

  async function Notifications({ params }: { params: Record<string, string | string[] | undefined> }) {
    const { page, from, to } = pageRange(Number(sp(params.page)), PAGE);
    let q = supabase.from("email_notifications")
      .select("*, payslips(status, payroll_month), employees(full_name, employee_code), email_delivery_attempts(attempt_number, status, error_message, brevo_message_id, attempted_at)", { count: "exact" })
      .order("created_at", { ascending: false });
    const status = sp(params.status);
    if (status === "failed") q = q.in("email_status", ["failed", "bounced"]); else if (status) q = q.eq("email_status", status);
    if (sp(params.month)) q = q.eq("payslips.payroll_month", `${sp(params.month).slice(0, 7)}-01`).not("payslips", "is", null);
    if (sp(params.q)) q = q.ilike("recipient_email", `%${sp(params.q).replace(/[%,]/g, "")}%`);
    const [{ data, count }, statusCounts] = await Promise.all([
      q.range(from, to),
      Promise.all(["queued", "sent", "delivered", "failed", "bounced"].map(async (s) => [s, (await supabase.from("email_notifications").select("id", { count: "exact", head: true }).eq("email_status", s)).count ?? 0] as const)),
    ]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rows: NotificationRow[] = ((data ?? []) as any[]).filter((n) => n.payslips).map((n) => ({
      id: n.id, employee_name: n.employees?.full_name, employee_code: n.employees?.employee_code, recipient_email: n.recipient_email, payroll_month: n.payslips.payroll_month,
      payslip_id: n.payslip_id, payslip_status: n.payslips.status, email_status: n.email_status, sent_at: n.sent_at, delivered_at: n.delivered_at, brevo_message_id: n.brevo_message_id,
      failure_reason: n.failure_reason, attempt_count: n.attempt_count, is_manual_resend: n.is_manual_resend, created_at: n.created_at, attempts: n.email_delivery_attempts ?? [],
    }));
    const c = Object.fromEntries(statusCounts);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Queued" value={c.queued} />
          <StatCard label="Sent (accepted)" value={c.sent} />
          <StatCard label="Delivered" value={c.delivered} tone="success" />
          <StatCard label="Failed" value={c.failed} tone={c.failed ? "danger" : "default"} />
          <StatCard label="Bounced" value={c.bounced} tone={c.bounced ? "danger" : "default"} hint="email marked invalid" />
        </div>
        <Section title="Payslip emails" actions={<>
          <FilterBar filters={[
            { name: "status", label: "Status", type: "select", options: ["pending", "queued", "sent", "delivered", "failed", "bounced"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
            { name: "month", label: "Payroll month", type: "month" },
            { name: "q", label: "Recipient", type: "text", placeholder: "email address" },
          ]} />
          {c.failed > 0 && <ActionButton className="self-end" size="sm" variant="outline" action={retryAllFailed} confirm={{ title: `Retry ${c.failed} failed email(s)?`, description: "Failed emails that Brevo never accepted are re-queued as new attempts." }}><RotateCcw /> Retry all failed</ActionButton>}
        </>}>
          {!rows.length ? <EmptyState title="No payslip emails yet" description="Emails are queued automatically when payroll is finalized and the payslip PDF is generated." /> : <NotificationTable rows={rows} />}
          <Pagination page={page} pageSize={PAGE} total={count ?? 0} />
        </Section>
      </div>
    );
  }

  async function Settings({ isSuper }: { isSuper: boolean }) {
    const [{ data: s }, brevo, { data: company }] = await Promise.all([
      supabase.from("email_settings").select("*").limit(1).single(),
      checkBrevoConnection(),
      supabase.from("company_settings").select("company_name").limit(1).single(),
    ]);
    const month = formatMonth(new Date().toISOString().slice(0, 7) + "-01");
    const preview = payslipEmailHtml({ employeeName: "Sample Employee", employeeCode: "EMP-00001", monthLabel: month, totalEarnings: "54000", totalDeductions: "3840", netSalary: "50160", companyName: company?.company_name ?? "Company" });
    const webhook = `${serverEnv.appUrl()}/api/webhooks/brevo?token=•••`;
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Section title="Brevo connection">
            <div className="divide-y divide-border px-5 py-2">
              <KV label="API status" value={<span className={`flex items-center gap-1.5 ${brevo.ok ? "text-success" : "text-destructive"}`}>{brevo.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{brevo.message}</span>} />
              <KV label="Sender (environment)" value={serverEnv.brevoSenderEmail() || "BREVO_SENDER_EMAIL not set"} />
              <KV label="Webhook URL" value={<code className="text-xs">{webhook}</code>} />
              <KV label="Webhook secret" value={serverEnv.brevoWebhookSecret() ? "Configured" : <span className="text-destructive">BREVO_WEBHOOK_SECRET not set</span>} />
              <KV label="Background worker" value={serverEnv.cronSecret() ? "Vercel Cron every 5 minutes" : <span className="text-destructive">CRON_SECRET not set</span>} />
            </div>
            {isSuper && <div className="border-t border-border px-5 py-4"><TestEmailForm /></div>}
          </Section>
          <Section title="Sending settings" description={isSuper ? "Disabling automatic emails does not affect payroll processing or payslip generation." : "Only a Super Admin can change these settings."}>
            <div className="p-5">
              <SchemaForm schema="emailSettings" action={saveEmailSettings} submitLabel="Save email settings"
                fields={[
                  { name: "email_enabled", label: "Payslip emails enabled", type: "switch", disabled: !isSuper },
                  { name: "auto_send_payslips", label: "Auto-send after payroll finalization", type: "switch", disabled: !isSuper },
                  { name: "sender_name", label: "Sender name", type: "text", required: true, disabled: !isSuper },
                  { name: "sender_email", label: "Sender email (verified in Brevo)", type: "email", disabled: !isSuper, hint: "Blank = BREVO_SENDER_EMAIL" },
                  { name: "batch_size", label: "Batch size per worker run", type: "number", disabled: !isSuper, hint: "Keep within your Brevo plan's rate limits" },
                  { name: "max_attempts", label: "Max attempts per email", type: "number", disabled: !isSuper },
                ]}
                defaultValues={{ ...s, sender_email: s?.sender_email ?? "" }} />
            </div>
          </Section>
        </div>
        <Section title="Email template preview" description={`Subject: ${payslipSubject(month)}`}>
          <iframe title="Email preview" srcDoc={preview} className="h-[720px] w-full rounded-b-xl bg-white" sandbox="" />
        </Section>
      </div>
    );
  }
}
