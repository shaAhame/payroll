import { PageHeader, Section } from "@/components/app/page-header";
import { SchemaForm } from "@/components/app/schema-form";
import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { savePayrollSettings } from "../actions";

export const metadata = { title: "Payroll Settings" };
export const maxDuration = 300;

export default async function PayrollSettingsPage() {
  const profile = await requirePageRole(ADMIN_ROLES);
  const ro = profile.role !== "super_admin";
  const supabase = await createClient();
  const { data: s } = await supabase.from("payroll_settings").select("*").limit(1).single();
  const pct = (v: string) => String(Number((Number(v) * 100).toFixed(2)));
  return (
    <>
      <PageHeader title="Payroll Settings" description={ro ? "Read-only — only a Super Admin can change payroll rules." : "Changes apply to open (non-finalized) payroll, which is recalculated on save. Finalized payroll never changes."} />
      <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm">
        <div className="font-semibold">Fixed company formulas (not configurable)</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>EPF Salary Basis = Basic Salary + BRA 2 + BRA 1 (Performance Incentive is never included)</li>
          <li>Daily Salary Basis = Basic Salary + BRA 2 + BRA 1 (Performance Incentive is never included)</li>
          <li>Performance Incentive is counted once in Total Earnings · Net Salary = Total Earnings − Total Deductions</li>
          <li>Additional working pay and no-pay leave are one monthly adjustment from (actual − allocated) days, never both</li>
        </ul>
      </div>
      <Section title="Rules and rates">
        <div className="p-5">
          <SchemaForm schema="payrollSettings" action={savePayrollSettings} submitLabel="Save payroll settings"
            fields={[
              { name: "_w", label: "Working days", type: "section" },
              { name: "default_working_days", label: "Default allocated working days", type: "number", required: true, disabled: ro, hint: "Used when no branch or employee allocation exists" },
              { name: "daily_salary_method", label: "Daily salary divisor", type: "select", disabled: ro, options: [{ value: "allocated_days", label: "Allocated working days (default)" }, { value: "calendar_days", label: "Calendar days in month" }, { value: "fixed_divisor", label: "Fixed divisor" }] },
              { name: "daily_salary_fixed_divisor", label: "Fixed divisor", type: "number", disabled: ro, showWhen: { field: "daily_salary_method", in: ["fixed_divisor"] } },
              { name: "round_daily_rate", label: "Round daily rate to 2 decimals before multiplying", type: "switch", disabled: ro, hint: "Off: only final amounts are rounded" },
              { name: "additional_day_multiplier", label: "Additional working day multiplier", type: "number", disabled: ro, hint: "1 = one daily rate per extra day" },
              { name: "no_pay_multiplier", label: "No-pay leave multiplier", type: "number", disabled: ro, hint: "1 = one daily rate per off day" },
              { name: "approved_leave_treatment", label: "Approved leave", type: "select", disabled: ro, options: [{ value: "paid", label: "Paid — counts as a worked day" }, { value: "unpaid", label: "Unpaid — reduces actual days" }] },
              { name: "weekly_off_treatment", label: "Weekly off", type: "select", disabled: ro, options: [{ value: "neutral", label: "Neutral — not counted (allocation excludes offs)" }, { value: "counts_as_worked", label: "Counts as a worked day" }] },
              { name: "public_holiday_treatment", label: "Public holiday", type: "select", disabled: ro, options: [{ value: "neutral", label: "Neutral — not counted (allocation excludes holidays)" }, { value: "paid", label: "Paid — counts as a worked day" }] },
              { name: "performance_incentive_mode", label: "Monthly incentive records", type: "select", disabled: ro, options: [{ value: "add", label: "Add to the salary-structure incentive" }, { value: "override", label: "Replace the salary-structure incentive" }] },
              { name: "_e", label: "EPF and ETF (%)", type: "section" },
              { name: "employee_epf_rate", label: "Employee EPF %", type: "number", required: true, disabled: ro },
              { name: "employer_epf_rate", label: "Employer EPF % (not deducted)", type: "number", required: true, disabled: ro },
              { name: "employer_etf_rate", label: "Employer ETF % (not deducted)", type: "number", required: true, disabled: ro },
              { name: "_l", label: "Late arrivals", type: "section" },
              { name: "late_tier1_max_minutes", label: "Tier 1 up to (minutes)", type: "number", disabled: ro, hint: "Default 15" },
              { name: "late_tier1_amount", label: "Tier 1 deduction (LKR)", type: "money", disabled: ro, hint: "Default 250" },
              { name: "late_tier2_amount", label: "Deduction after tier 1 (LKR)", type: "money", disabled: ro, hint: "Default 500" },
              { name: "late_grace_minutes", label: "Grace minutes", type: "number", disabled: ro, hint: "Default 0 (1 minute late is charged)" },
              { name: "late_deduction_frequency", label: "Frequency", type: "select", disabled: ro, options: [{ value: "per_incident", label: "Per late incident (default)" }, { value: "once_per_month", label: "Once per month (highest incident)" }] },
              { name: "late_monthly_cap", label: "Monthly cap (LKR, optional)", type: "money", disabled: ro },
              { name: "_a", label: "Approval", type: "section" },
              { name: "require_approval", label: "Require approval before finalization", type: "switch", disabled: ro },
              { name: "require_separate_approver", label: "Approver must differ from submitter", type: "switch", disabled: ro },
            ]}
            defaultValues={{
              ...s, employee_epf_rate: pct(s.employee_epf_rate), employer_epf_rate: pct(s.employer_epf_rate), employer_etf_rate: pct(s.employer_etf_rate),
              daily_salary_fixed_divisor: s.daily_salary_fixed_divisor ?? "", late_monthly_cap: s.late_monthly_cap ?? "",
            }} />
          <p className="mt-2 text-xs text-muted-foreground">Currency: {s.currency}</p>
        </div>
      </Section>
    </>
  );
}
