"use client";
import { useState } from "react";
import { History, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { formatDateTime, formatMonth } from "@/lib/format";
import { resendPayslips, retryNotifications } from "./actions";

export interface NotificationRow {
  id: string; employee_name: string; employee_code: string; recipient_email: string; payroll_month: string; payslip_id: string; payslip_status: string;
  email_status: string; sent_at: string | null; delivered_at: string | null; brevo_message_id: string | null; failure_reason: string | null;
  attempt_count: number; is_manual_resend: boolean; created_at: string;
  attempts: { attempt_number: number; status: string; error_message: string | null; brevo_message_id: string | null; attempted_at: string }[];
}

export function NotificationTable({ rows }: { rows: NotificationRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const failed = rows.filter((r) => r.email_status === "failed" && !r.brevo_message_id).map((r) => r.id);
  const sel = [...selected];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <ActionButton size="sm" variant="outline" disabled={!sel.some((id) => failed.includes(id))} action={() => retryNotifications(sel)}
          confirm={{ title: "Retry selected failed emails?", description: "Each is retried as a new attempt of the same notification." }} onDone={() => setSelected(new Set())}>
          <RotateCcw /> Retry selected
        </ActionButton>
        <ActionButton size="sm" variant="outline" disabled={!sel.length} action={() => resendPayslips([...new Set(rows.filter((r) => selected.has(r.id)).map((r) => r.payslip_id))])}
          confirm={{ title: `Resend ${sel.length} payslip email(s)?`, description: "A new email is created for each selected payslip. Duplicates in progress or sent in the last 10 minutes are skipped." }} onDone={() => setSelected(new Set())}>
          <Send /> Resend selected
        </ActionButton>
        <span className="text-xs text-muted-foreground">{sel.length ? `${sel.length} selected` : ""}</span>
      </div>
      <Table className="text-[13px]">
        <THead>
          <TR>
            <TH className="w-8"><Checkbox aria-label="Select all" checked={rows.length > 0 && selected.size === rows.length} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} /></TH>
            <TH>Employee</TH><TH>Recipient</TH><TH>Month</TH><TH>Payslip</TH><TH>Status</TH><TH>Sent</TH><TH>Delivered</TH><TH>Brevo message ID</TH><TH>Error</TH><TH className="text-right">Attempts</TH><TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD><Checkbox aria-label="Select" checked={selected.has(r.id)} onCheckedChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></TD>
              <TD><div className="font-medium">{r.employee_name}</div><div className="font-mono text-[11px] text-muted-foreground">{r.employee_code}{r.is_manual_resend && " · resend"}</div></TD>
              <TD>{r.recipient_email}</TD><TD>{formatMonth(r.payroll_month)}</TD>
              <TD><StatusBadge status={r.payslip_status} /></TD>
              <TD><StatusBadge status={r.email_status} /></TD>
              <TD className="text-xs">{formatDateTime(r.sent_at)}</TD><TD className="text-xs">{formatDateTime(r.delivered_at)}</TD>
              <TD className="max-w-[160px] truncate font-mono text-[11px]" title={r.brevo_message_id ?? ""}>{r.brevo_message_id ?? "—"}</TD>
              <TD className="max-w-[220px] truncate text-xs text-destructive" title={r.failure_reason ?? ""}>{r.failure_reason ?? ""}</TD>
              <TD className="num">{r.attempt_count}</TD>
              <TD className="text-right">
                <Dialog>
                  <DialogTrigger asChild><Button size="icon" variant="ghost" aria-label="Attempt history"><History /></Button></DialogTrigger>
                  <DialogContent wide>
                    <DialogHeader><DialogTitle>Delivery attempts · {r.employee_name}</DialogTitle></DialogHeader>
                    {!r.attempts.length ? <p className="text-sm text-muted-foreground">No attempts yet — the email is waiting in the queue.</p> : (
                      <Table>
                        <THead><TR><TH>#</TH><TH>When</TH><TH>Result</TH><TH>Message ID</TH><TH>Error</TH></TR></THead>
                        <TBody>
                          {r.attempts.sort((a, b) => a.attempt_number - b.attempt_number).map((a) => (
                            <TR key={a.attempt_number}><TD>{a.attempt_number}</TD><TD>{formatDateTime(a.attempted_at)}</TD><TD>{a.status}</TD>
                              <TD className="font-mono text-[11px]">{a.brevo_message_id ?? "—"}</TD><TD className="whitespace-normal text-xs text-destructive">{a.error_message}</TD></TR>
                          ))}
                        </TBody>
                      </Table>
                    )}
                    <p className="text-xs text-muted-foreground">“Accepted” means Brevo accepted the request; “Delivered” is set only when Brevo’s webhook reports delivery.</p>
                  </DialogContent>
                </Dialog>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
