"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSettingsSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { processJobs } from "@/lib/jobs/runner";
import { payslipEmailHtml, payslipEmailText, payslipSubject } from "@/lib/email/template";
import { sendBrevoEmail } from "@/lib/email/brevo";
import { renderPayslipPdf } from "@/lib/payslip/pdf";
import { serverEnv } from "@/lib/env";
import { formatMonth } from "@/lib/format";

/** Manual resend of individual payslips (confirmation happens in the UI). Never touches payroll or money. */
export async function resendPayslips(payslipIds: string[]) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    if (!payslipIds.length) throw new Error("Select at least one payslip.");
    if (payslipIds.length > 500) throw new Error("Resend at most 500 at a time.");
    const supabase = await createClient(); // RLS confirms the user can see these payslips
    const slips = check(await supabase.from("payslips").select("id, payroll_month").in("id", payslipIds)) as { id: string; payroll_month: string }[];
    const admin = createAdminClient();
    let queued = 0;
    const errors: string[] = [];
    for (const s of slips) {
      const r = await admin.rpc("enqueue_payslip_email", { p_payslip_id: s.id, p_manual: true, p_requested_by: profile.id, p_subject: payslipSubject(formatMonth(s.payroll_month)) });
      if (r.error) errors.push(r.error.message); else queued++;
    }
    await logAudit({ actorId: profile.id, action: "payslip_email.resend", entityType: "payslip", summary: `${queued} queued, ${errors.length} rejected` });
    const run = queued ? await processJobs({ timeBudgetMs: 20_000 }) : null;
    revalidatePath("/emails"); revalidatePath("/payslips");
    if (!queued) return { ok: false as const, error: errors[0] ?? "Nothing was queued" };
    return { ok: true as const, message: `${queued} email(s) queued${run ? `, ${run.emailsSent} sent now` : ""}${errors.length ? `; ${errors.length} skipped: ${errors[0]}` : ""}` };
  });
}

/** Retry failed/bounced notifications by re-arming their queue jobs (same notification, new attempt). */
export async function retryNotifications(notificationIds: string[]) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const admin = createAdminClient();
    const supabase = await createClient();
    const rows = check(await supabase.from("email_notifications").select("id, email_status, brevo_message_id").in("id", notificationIds)) as { id: string; email_status: string; brevo_message_id: string | null }[];
    const retryable = rows.filter((r) => r.email_status === "failed" && !r.brevo_message_id).map((r) => r.id);
    if (!retryable.length) throw new Error("Only failed emails that were never accepted by Brevo can be retried. Use Resend for bounced or delivered emails.");
    check(await admin.from("email_queue").update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), locked_at: null, completed_at: null }).in("email_notification_id", retryable));
    check(await admin.from("email_notifications").update({ email_status: "queued", failure_reason: null }).in("id", retryable));
    await logAudit({ actorId: profile.id, action: "payslip_email.retry", entityType: "email_notification", summary: `${retryable.length} retried` });
    const run = await processJobs({ timeBudgetMs: 20_000 });
    revalidatePath("/emails");
    return { ok: true as const, message: `${retryable.length} email(s) re-queued, ${run.emailsSent} sent now` };
  });
}

export async function retryAllFailed() {
  return runAction(async () => {
    await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const ids = (check(await supabase.from("email_notifications").select("id").eq("email_status", "failed").is("brevo_message_id", null).limit(500)) as { id: string }[]).map((r) => r.id);
    if (!ids.length) return { ok: true as const, message: "No failed emails to retry" };
    return retryNotifications(ids);
  });
}

export async function saveEmailSettings(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const v = emailSettingsSchema.parse(input);
    const supabase = await createClient();
    check(await supabase.from("email_settings").update(v).eq("singleton", true));
    await logAudit({ actorId: profile.id, action: "email_settings.updated", entityType: "email_settings", newValues: v });
    revalidatePath("/emails");
    return { ok: true as const, message: "Email settings saved" };
  });
}

/** Sends a sample payslip email with a clearly marked SAMPLE PDF (fictional figures) to the given address. */
export async function sendTestEmail(to: string) {
  return runAction(async () => {
    const profile = await requireRole(["super_admin"]);
    const email = z.string().email("Enter a valid email address").parse(to.trim());
    const admin = createAdminClient();
    const [{ data: s }, { data: c }] = await Promise.all([
      admin.from("email_settings").select("*").limit(1).single(),
      admin.from("company_settings").select("company_name").limit(1).single(),
    ]);
    const senderEmail = s?.sender_email || serverEnv.brevoSenderEmail();
    if (!senderEmail) throw new Error("Set a verified sender email first.");
    const month = formatMonth(new Date().toISOString().slice(0, 7) + "-01");
    const tpl = { employeeName: "Sample Employee", employeeCode: "EMP-SAMPLE", monthLabel: month, totalEarnings: "50000", totalDeductions: "3840", netSalary: "46160", companyName: c?.company_name ?? "" };
    const pdf = await renderPayslipPdf({
      company: { name: c?.company_name ?? "Company", address: "SAMPLE — NOT A REAL PAYSLIP", phone: null, email: null, employerEpfNumber: null },
      referenceNumber: "PS-SAMPLE", monthLabel: month,
      employee: { code: "EMP-SAMPLE", name: "Sample Employee", designation: "Sample", epfNumber: null, branch: "Sample" },
      earnings: [{ label: "Basic Salary", amount: "40000" }, { label: "BRA 2", amount: "5000" }, { label: "BRA 1", amount: "3000" }, { label: "Performance Incentive", amount: "2000" }],
      deductions: [{ label: "EPF 8%", amount: "3840" }], totalEarnings: "50000", totalDeductions: "3840", netSalary: "46160",
      basis: { epfSalaryBasis: "48000", dailySalaryBasis: "50000", dailySalaryRate: "2000", allocatedDays: "25", actualDays: "25", additionalDays: "0", offDays: "0" },
      employer: { epf: "5760", etf: "1440" }, generatedAt: new Date().toLocaleString("en-GB"),
    });
    const r = await sendBrevoEmail({
      to: { email }, sender: { email: senderEmail, name: s?.sender_name || serverEnv.brevoSenderName() || "HR & Payroll" },
      subject: `[TEST] ${payslipSubject(month)}`, htmlContent: payslipEmailHtml(tpl), textContent: payslipEmailText(tpl),
      attachment: [{ name: "Payslip-SAMPLE.pdf", content: Buffer.from(pdf).toString("base64") }], tags: ["payslip-test"],
    });
    await logAudit({ actorId: profile.id, action: "email.test_sent", entityType: "email_settings", summary: `${email}: ${r.ok ? "accepted" : r.error}` });
    if (!r.ok) throw new Error(`Brevo rejected the test email: ${r.error}`);
    return { ok: true as const, message: `Test email accepted by Brevo (message ${r.messageId}). Delivery status arrives via webhook.` };
  });
}
