import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { formatMonth } from "@/lib/format";
import { loadPayslipData } from "@/lib/payslip/data";
import { renderPayslipPdf } from "@/lib/payslip/pdf";
import { sendBrevoEmail } from "@/lib/email/brevo";
import { payslipEmailHtml, payslipEmailText, payslipSubject } from "@/lib/email/template";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = ReturnType<typeof createAdminClient>;

export interface JobSummary {
  payslipsGenerated: number;
  payslipsFailed: number;
  emailsSent: number;
  emailsFailed: number;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];

async function emailSettings(admin: Admin) {
  const { data } = await admin.from("email_settings").select("*").limit(1).single();
  return data as { email_enabled: boolean; auto_send_payslips: boolean; sender_email: string | null; sender_name: string; batch_size: number; max_attempts: number };
}

/** Generates pending payslip PDFs into private storage and, if enabled, queues their emails. */
async function processPayslips(admin: Admin, deadline: number, summary: JobSummary) {
  const settings = await emailSettings(admin);
  while (Date.now() < deadline) {
    const { data: jobs, error } = await admin.rpc("claim_payslip_jobs", { p_limit: 10 });
    if (error) throw error;
    if (!jobs?.length) return;
    for (const slip of jobs as any[]) {
      try {
        const data = await loadPayslipData(admin, slip.payroll_record_id, slip.reference_number);
        const pdf = await renderPayslipPdf(data);
        const path = `${slip.payroll_month.slice(0, 7)}/${slip.employee_id}/${slip.reference_number}.pdf`;
        const up = await admin.storage.from("payslips").upload(path, pdf, { contentType: "application/pdf", upsert: true });
        if (up.error) throw up.error;
        const done = await admin.from("payslips").update({ status: "generated", storage_path: path, generated_at: new Date().toISOString(), error_message: null, locked_at: null }).eq("id", slip.id);
        if (done.error) throw done.error;
        summary.payslipsGenerated++;
        if (settings?.email_enabled && settings.auto_send_payslips) {
          const r = await admin.rpc("enqueue_payslip_email", { p_payslip_id: slip.id, p_manual: false, p_requested_by: null, p_subject: payslipSubject(data.monthLabel) });
          if (r.error && !/valid email/i.test(r.error.message)) console.error("[jobs] enqueue failed", slip.id, r.error.message);
        }
      } catch (e) {
        summary.payslipsFailed++;
        await admin.from("payslips").update({ status: "failed", error_message: (e as Error).message.slice(0, 500), locked_at: null }).eq("id", slip.id);
      }
    }
  }
}

/** Sends queued payslip emails in controlled batches; each job is claimed once and is idempotent. */
async function processEmails(admin: Admin, deadline: number, summary: JobSummary) {
  const settings = await emailSettings(admin);
  if (!settings?.email_enabled) return;
  const senderEmail = settings.sender_email || serverEnv.brevoSenderEmail();
  const senderName = settings.sender_name || serverEnv.brevoSenderName() || "HR & Payroll";
  if (!senderEmail || !serverEnv.brevoApiKey()) return; // not configured — jobs stay pending and are retried later
  const { data: company } = await admin.from("company_settings").select("company_name").limit(1).single();
  const worker = `w-${Math.random().toString(36).slice(2, 10)}`;

  while (Date.now() < deadline) {
    const { data: jobs, error } = await admin.rpc("claim_email_jobs", { p_limit: settings.batch_size ?? 20, p_worker: worker });
    if (error) throw error;
    if (!jobs?.length) return;
    for (const job of jobs as any[]) {
      const { data: n } = await admin.from("email_notifications")
        .select("*, payslips(storage_path, payroll_month), payroll_records(employee_name, employee_code, total_earnings, total_deductions, net_salary, payroll_month, status)")
        .eq("id", job.email_notification_id).single();
      // Idempotency: never send twice for a notification that already has a provider message id.
      if (!n || n.brevo_message_id || ["sent", "delivered"].includes(n.email_status)) {
        await admin.from("email_queue").update({ status: "completed", completed_at: new Date().toISOString(), locked_at: null }).eq("id", job.id);
        continue;
      }
      const attempt = n.attempt_count + 1;
      const finish = async (ok: boolean, patch: Record<string, unknown>, attemptRow: Record<string, unknown>, retryable = false) => {
        await admin.from("email_delivery_attempts").insert({ email_notification_id: n.id, attempt_number: attempt, ...attemptRow });
        const giveUp = !ok && (!retryable || job.attempts >= (settings.max_attempts ?? 5));
        await admin.from("email_notifications").update({ attempt_count: attempt, ...patch, ...(giveUp ? { email_status: "failed" } : {}) }).eq("id", n.id);
        await admin.from("email_queue").update(
          ok || giveUp
            ? { status: ok ? "completed" : "failed", completed_at: new Date().toISOString(), locked_at: null, last_error: ok ? null : String(attemptRow.error_message ?? "") }
            : { status: "pending", locked_at: null, last_error: String(attemptRow.error_message ?? ""),
                next_attempt_at: new Date(Date.now() + BACKOFF_MINUTES[Math.min(job.attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000).toISOString() },
        ).eq("id", job.id);
      };
      try {
        if (n.payroll_records?.status !== "finalized") throw Object.assign(new Error("Payroll is not finalized"), { permanent: true });
        if (!n.payslips?.storage_path) throw Object.assign(new Error("Payslip PDF missing"), { permanent: true });
        const file = await admin.storage.from("payslips").download(n.payslips.storage_path);
        if (file.error || !file.data) throw new Error(file.error?.message ?? "Could not read payslip PDF");
        const content = Buffer.from(await file.data.arrayBuffer()).toString("base64");
        const pr = n.payroll_records;
        const monthLabel = formatMonth(pr.payroll_month);
        const tpl = {
          employeeName: pr.employee_name, employeeCode: pr.employee_code, monthLabel,
          totalEarnings: pr.total_earnings, totalDeductions: pr.total_deductions, netSalary: pr.net_salary, companyName: company?.company_name ?? "",
        };
        const res = await sendBrevoEmail({
          to: { email: n.recipient_email, name: pr.employee_name },
          sender: { email: senderEmail, name: senderName },
          subject: n.email_subject,
          htmlContent: payslipEmailHtml(tpl),
          textContent: payslipEmailText(tpl),
          attachment: [{ name: `Payslip-${pr.employee_code}-${pr.payroll_month.slice(0, 7)}.pdf`, content }],
          reference: `notification:${n.id}`,
          tags: ["payslip"],
        });
        if (res.ok) {
          summary.emailsSent++;
          // "sent" = accepted by Brevo. Only the webhook may mark it "delivered".
          await finish(true, { email_status: "sent", brevo_message_id: res.messageId, sent_at: new Date().toISOString(), failure_reason: null },
            { brevo_message_id: res.messageId, status: "accepted" });
          await admin.from("employees").update({ last_payslip_email_sent_at: new Date().toISOString() }).eq("id", n.employee_id);
        } else {
          summary.emailsFailed++;
          await finish(false, { failure_reason: res.error, email_status: res.retryable ? "queued" : "failed" }, { status: `error_${res.status}`, error_message: res.error }, res.retryable);
        }
      } catch (e) {
        summary.emailsFailed++;
        const permanent = (e as { permanent?: boolean }).permanent === true;
        await finish(false, { failure_reason: (e as Error).message, email_status: permanent ? "failed" : "queued" }, { status: "error", error_message: (e as Error).message }, !permanent);
      }
    }
  }
}

/**
 * One worker invocation. Safe to run concurrently and repeatedly (Vercel Cron,
 * manual trigger, post-finalization): jobs are claimed with SKIP LOCKED and
 * stale locks are recovered after 10 minutes.
 */
export async function processJobs({ timeBudgetMs = 50_000 }: { timeBudgetMs?: number } = {}): Promise<JobSummary> {
  const admin = createAdminClient();
  const summary: JobSummary = { payslipsGenerated: 0, payslipsFailed: 0, emailsSent: 0, emailsFailed: 0 };
  const start = Date.now();
  await processPayslips(admin, start + timeBudgetMs * 0.6, summary);
  await processEmails(admin, start + timeBudgetMs, summary);
  return summary;
}
