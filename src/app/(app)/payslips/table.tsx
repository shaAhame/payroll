"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/components/app/action-button";
import { ResendSelected } from "../emails/client";
import { resendPayslips } from "../emails/actions";
import { formatAmount, formatDateTime, formatMonth } from "@/lib/format";

export interface PayslipRow {
  id: string; reference_number: string; payroll_month: string; status: string; generated_at: string | null; error_message: string | null;
  employee_id: string; employee_name: string; employee_code: string; branch_name: string; net_salary: string; email: string | null;
  email_status: string | null; email_at: string | null; record_id: string; period_id: string;
}

export function PayslipTable({ rows }: { rows: PayslipRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = rows.filter((r) => r.status === "generated").map((r) => r.id);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <ResendSelected ids={[...selected]} onDone={() => setSelected(new Set())} />
        <span className="text-xs text-muted-foreground">{selected.size ? `${selected.size} selected` : "Select payslips to resend"}</span>
      </div>
      <Table>
        <THead>
          <TR>
            <TH className="w-8"><Checkbox aria-label="Select all" checked={selectable.length > 0 && selected.size === selectable.length} onCheckedChange={(v) => setSelected(v ? new Set(selectable) : new Set())} /></TH>
            <TH>Employee</TH><TH>Branch</TH><TH>Month</TH><TH>Reference</TH><TH className="text-right">Net salary</TH><TH>Payslip</TH><TH>Email</TH><TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>{r.status === "generated" && <Checkbox aria-label="Select" checked={selected.has(r.id)} onCheckedChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />}</TD>
              <TD><Link href={`/employees/${r.employee_id}?tab=payslips`} className="font-medium text-primary hover:underline">{r.employee_name}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.employee_code}</div></TD>
              <TD>{r.branch_name}</TD><TD>{formatMonth(r.payroll_month)}</TD>
              <TD><Link className="font-mono text-xs hover:underline" href={`/payroll/${r.period_id}/records/${r.record_id}`}>{r.reference_number}</Link></TD>
              <TD className="num">{formatAmount(r.net_salary)}</TD>
              <TD><StatusBadge status={r.status} />{r.error_message && <div className="max-w-[200px] truncate text-[11px] text-destructive" title={r.error_message}>{r.error_message}</div>}{r.generated_at && <div className="text-[11px] text-muted-foreground">{formatDateTime(r.generated_at)}</div>}</TD>
              <TD>{r.email_status ? <StatusBadge status={r.email_status} /> : <span className="text-xs text-muted-foreground">{r.email ? "Not sent" : "No email address"}</span>}{r.email_at && <div className="text-[11px] text-muted-foreground">{formatDateTime(r.email_at)}</div>}</TD>
              <TD className="text-right">
                {r.status === "generated" && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" asChild><a href={`/api/payslips/${r.id}`} target="_blank" rel="noreferrer"><Download /> PDF</a></Button>
                    {r.email && (
                      <ActionButton size="sm" variant="ghost" action={() => resendPayslips([r.id])}
                        confirm={{ title: `Resend payslip to ${r.employee_name}?`, description: <>The {formatMonth(r.payroll_month)} payslip will be emailed to <strong>{r.email}</strong>. This does not change any payroll data.</>, confirmLabel: "Resend" }}>
                        <Send /> Resend
                      </ActionButton>
                    )}
                  </div>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
