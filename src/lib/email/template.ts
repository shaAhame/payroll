export interface PayslipEmailData {
  employeeName: string;
  employeeCode: string;
  monthLabel: string;
  totalEarnings: string;
  totalDeductions: string;
  netSalary: string;
  companyName: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: string) => new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));

export const payslipSubject = (monthLabel: string) => `Your Monthly Salary Payslip - ${monthLabel}`;

/** Responsive, table-based HTML (works in Outlook/Gmail). Contains only this employee's own summary. */
export function payslipEmailHtml(d: PayslipEmailData): string {
  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="padding:8px 0;color:#5b6474;font-size:14px;border-bottom:1px solid #eef0f3">${k}</td><td align="right" style="padding:8px 0;font-size:14px;border-bottom:1px solid #eef0f3;${strong ? "font-weight:700;color:#2449b8" : "color:#0f172a"}">${v}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(payslipSubject(d.monthLabel))}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e6eb">
<tr><td style="background:#0f1b2d;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:600">${esc(d.companyName)}<div style="font-size:12px;font-weight:400;color:#9fb0c8;margin-top:2px">HR &amp; Payroll Department</div></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:15px;color:#0f172a">Dear ${esc(d.employeeName)},</p>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">Your salary for ${esc(d.monthLabel)} has been processed successfully.</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155">Please find your monthly salary payslip attached to this email.</p>
<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#0f172a;text-transform:uppercase;letter-spacing:.04em">Payroll Summary</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Employee ID", esc(d.employeeCode))}
${row("Payroll Month", esc(d.monthLabel))}
${row("Total Earnings", `LKR ${fmt(d.totalEarnings)}`)}
${row("Total Deductions", `LKR ${fmt(d.totalDeductions)}`)}
${row("Net Salary", `LKR ${fmt(d.netSalary)}`, true)}
</table>
<p style="margin:24px 0 4px;font-size:14px;color:#334155">Thank you.</p>
<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#334155">Best regards,<br><strong>${esc(d.companyName)}</strong><br>HR &amp; Payroll Department</p>
</td></tr>
<tr><td style="padding:14px 28px;background:#f8f9fb;color:#8a93a3;font-size:11px;line-height:1.5">This email and its attachment are confidential and intended only for ${esc(d.employeeName)}. If you received it in error, please delete it and notify HR.</td></tr>
</table></td></tr></table></body></html>`;
}

export function payslipEmailText(d: PayslipEmailData): string {
  return `Dear ${d.employeeName},

Your salary for ${d.monthLabel} has been processed successfully.

Please find your monthly salary payslip attached to this email.

Payroll Summary:
- Employee ID: ${d.employeeCode}
- Payroll Month: ${d.monthLabel}
- Total Earnings: LKR ${fmt(d.totalEarnings)}
- Total Deductions: LKR ${fmt(d.totalDeductions)}
- Net Salary: LKR ${fmt(d.netSalary)}

Thank you.

Best regards,

${d.companyName}
HR & Payroll Department`;
}
