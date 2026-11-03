import type { Option } from "@/components/app/schema-form";

export function employeeOptions(
  employees: { id: string; employee_code: string; full_name: string; branch_id: string }[],
  branches: { id: string; name: string }[],
): Option[] {
  const name = new Map(branches.map((b) => [b.id, b.name]));
  return employees.map((e) => ({ value: e.id, label: `${e.full_name} (${e.employee_code})`, group: name.get(e.branch_id) ?? "Other" }));
}

export const branchOptions = (branches: { id: string; name: string; code: string }[]): Option[] =>
  branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));

export const EMPLOYMENT_STATUS: Option[] = [
  { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
  { value: "resigned", label: "Resigned" }, { value: "terminated", label: "Terminated" },
];
export const EMPLOYMENT_TYPE: Option[] = [
  { value: "permanent", label: "Permanent" }, { value: "contract", label: "Contract" }, { value: "probation", label: "Probation" },
  { value: "temporary", label: "Temporary" }, { value: "part_time", label: "Part-time" },
];
export const ATTENDANCE_STATUS: Option[] = [
  { value: "present", label: "Present" }, { value: "absent", label: "Absent" }, { value: "no_pay_leave", label: "No-Pay Leave" },
  { value: "approved_leave", label: "Approved Leave" }, { value: "weekly_off", label: "Weekly Off" }, { value: "public_holiday", label: "Public Holiday" },
];
export const COMMISSION_TYPES: Option[] = [
  { value: "sales", label: "Sales Commission" }, { value: "pre_owned", label: "Pre-Owned Commission" },
  { value: "company_device", label: "Company Device Commission" }, { value: "repair", label: "Repair Commission" },
];
