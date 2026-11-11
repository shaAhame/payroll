/**
 * Regression: SchemaForm validates in the browser with zodResolver and the
 * server action parses the submitted values again with the same schema.
 * The browser must submit the RAW values; parsed values (blank → null,
 * EPF 8 → 0.08) fail or change when parsed a second time.
 */
import { describe, expect, it } from "vitest";
import { zodResolver } from "@hookform/resolvers/zod";
import { SCHEMAS } from "@/lib/validation/schemas";

const uuid = "6f1c2b8e-3d4a-4b5c-8d9e-0f1a2b3c4d5e";
const samples: Partial<Record<keyof typeof SCHEMAS, Record<string, unknown>>> = {
  branch: { name: "Colombo Main", code: "cmb01", address: "", manager_profile_id: "", allocated_working_days: "", default_shift_id: "" },
  shift: { name: "Day shift", branch_id: "", start_time: "09:00", end_time: "18:00" },
  employee: { full_name: "Sample Person", contact_number: "", email: "", address: "", designation: "Cashier", department_id: "", epf_number: "", branch_id: uuid,
    employment_start_date: "2026-11-01", employment_status: "active", employment_type: "permanent", shift_id: "", email_notifications_enabled: true, email_verification_status: "unverified" },
  newEmployee: { full_name: "Sample Person", contact_number: "", email: "", address: "", designation: "Cashier", department_id: "", epf_number: "", branch_id: uuid,
    employment_start_date: "2026-11-01", employment_status: "active", employment_type: "permanent", shift_id: "", email_notifications_enabled: true, email_verification_status: "unverified",
    salary: { basic_salary: "40,000", bra2: "5000", bra1: "3000", performance_incentive: "0", effective_from: "2026-11-01", notes: "" } },
  attendance: { employee_id: uuid, work_date: "2026-11-01", status: "absent", shift_start_time: "", check_in_time: "", check_out_time: "", is_additional_working_day: false, remarks: "" },
  user: { full_name: "Branch Manager", email: "manager@example.com", role: "branch_manager", branch_id: uuid, employee_id: "" },
  company: { company_name: "Idealz Lanka (Private) Limited", company_address: "", company_email: "", company_phone: "", registration_number: "", employer_epf_number: "" },
  payrollSettings: { default_working_days: "25.00", employee_epf_rate: "8", employer_epf_rate: "12", employer_etf_rate: "3", late_grace_minutes: 0, late_tier1_max_minutes: 15,
    late_tier1_amount: "250.00", late_tier2_amount: "500.00", late_deduction_frequency: "per_incident", late_monthly_cap: "", daily_salary_method: "allocated_days",
    daily_salary_fixed_divisor: "", round_daily_rate: false, additional_day_multiplier: "1", no_pay_multiplier: "1", approved_leave_treatment: "paid",
    weekly_off_treatment: "neutral", public_holiday_treatment: "neutral", performance_incentive_mode: "add", require_approval: true, require_separate_approver: false },
  emailSettings: { sender_name: "HR IDEALZ", sender_email: "", email_enabled: true, auto_send_payslips: true, batch_size: 20, max_attempts: 5 },
};

describe("form submission: browser check, then server check", () => {
  for (const [key, raw] of Object.entries(samples)) {
    it(`${key}: blank optional fields are accepted end to end`, async () => {
      const schema = SCHEMAS[key as keyof typeof SCHEMAS];
      // what SchemaForm's resolver hands to the submit handler
      const resolver = zodResolver(schema as never, undefined, { raw: true });
      const res = await resolver(raw as never, undefined, { fields: {}, shouldUseNativeValidation: false });
      expect(res.errors).toEqual({});
      // what the server action does with it
      const server = schema.safeParse(res.values);
      expect(server.success, JSON.stringify(server.error?.issues)).toBe(true);
    });
  }

  it("EPF 8% is stored as 0.08, not divided twice", async () => {
    const resolver = zodResolver(SCHEMAS.payrollSettings as never, undefined, { raw: true });
    const res = await resolver(samples.payrollSettings as never, undefined, { fields: {}, shouldUseNativeValidation: false });
    const saved = SCHEMAS.payrollSettings.parse(res.values);
    expect(saved.employee_epf_rate).toBe(0.08);
    expect(saved.employer_etf_rate).toBe(0.03);
  });
});
