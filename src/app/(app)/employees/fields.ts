import type { FieldDef, Option } from "@/components/app/schema-form";
import { EMPLOYMENT_STATUS, EMPLOYMENT_TYPE } from "@/lib/options";

export function employeeFields(o: { branches: Option[]; departments: Option[]; shifts: Option[] }): FieldDef[] {
  return [
    { name: "_p", label: "Personal information", type: "section" },
    { name: "full_name", label: "Full name", type: "text", required: true },
    { name: "contact_number", label: "Contact number", type: "tel", placeholder: "+94 77 123 4567" },
    { name: "email", label: "Email address", type: "email", hint: "Payslips are emailed to this address" },
    { name: "address", label: "Address", type: "textarea" },
    { name: "_e", label: "Employment information", type: "section" },
    { name: "designation", label: "Designation", type: "text", required: true },
    { name: "department_id", label: "Department", type: "select", options: o.departments },
    { name: "epf_number", label: "EPF number", type: "text" },
    { name: "branch_id", label: "Branch", type: "select", options: o.branches, required: true },
    { name: "employment_start_date", label: "Employment start date", type: "date", required: true },
    { name: "employment_status", label: "Employment status", type: "select", options: EMPLOYMENT_STATUS, required: true },
    { name: "employment_type", label: "Employment type", type: "select", options: EMPLOYMENT_TYPE, required: true },
    { name: "shift_id", label: "Allocated shift", type: "select", options: o.shifts, hint: "Used to calculate late arrivals" },
    { name: "_n", label: "Payslip email", type: "section" },
    { name: "email_notifications_enabled", label: "Email payslips automatically", type: "switch" },
    {
      name: "email_verification_status", label: "Email verification", type: "select",
      options: [{ value: "unverified", label: "Unverified" }, { value: "verified", label: "Verified" }, { value: "invalid", label: "Invalid" }],
    },
  ];
}

export const salaryFields: FieldDef[] = [
  { name: "basic_salary", label: "Basic Salary (LKR)", type: "money", required: true },
  { name: "bra2", label: "BRA 2 (LKR)", type: "money", required: true },
  { name: "bra1", label: "BRA 1 (LKR)", type: "money", required: true },
  { name: "performance_incentive", label: "Performance Incentive (LKR)", type: "money", required: true, hint: "Paid as an earning; not part of the EPF or daily salary basis" },
  { name: "effective_from", label: "Effective from", type: "date", required: true },
  { name: "notes", label: "Notes", type: "textarea" },
];

export const prefixed = (fields: FieldDef[], prefix: string): FieldDef[] => fields.map((f) => ({ ...f, name: `${prefix}.${f.name}` }));
