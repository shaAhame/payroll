import type { AppRole } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
}

const ALL_STAFF: AppRole[] = ["super_admin", "hr_manager", "branch_manager"];
const ADMIN: AppRole[] = ["super_admin", "hr_manager"];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ALL_STAFF },
  { href: "/employees", label: "Employees", icon: "Users", roles: ALL_STAFF },
  { href: "/payroll", label: "Payroll Management", icon: "Calculator", roles: ADMIN },
  { href: "/attendance", label: "Attendance Management", icon: "CalendarCheck", roles: ALL_STAFF },
  { href: "/earnings", label: "Additional Earnings", icon: "TrendingUp", roles: ALL_STAFF },
  { href: "/commissions", label: "Commission Management", icon: "BadgePercent", roles: ALL_STAFF },
  { href: "/advances", label: "Salary Advances", icon: "HandCoins", roles: ADMIN },
  { href: "/loans", label: "Loan Management", icon: "Landmark", roles: ADMIN },
  { href: "/deductions", label: "Deductions", icon: "MinusCircle", roles: ADMIN },
  { href: "/payslips", label: "Payslips", icon: "FileText", roles: ADMIN },
  { href: "/emails", label: "Email Notifications", icon: "Mail", roles: ADMIN },
  { href: "/reports", label: "Reports & Analytics", icon: "BarChart3", roles: ALL_STAFF },
  { href: "/branches", label: "Branch Management", icon: "Building2", roles: ADMIN },
  { href: "/users", label: "User Management", icon: "UserCog", roles: ["super_admin"] },
  { href: "/settings/payroll", label: "Payroll Settings", icon: "SlidersHorizontal", roles: ADMIN },
  { href: "/settings/company", label: "Company Settings", icon: "Settings", roles: ["super_admin"] },
];

export const PORTAL_NAV: NavItem[] = [
  { href: "/portal", label: "My Profile", icon: "UserRound", roles: ["employee"] },
  { href: "/portal/payslips", label: "My Payslips", icon: "FileText", roles: ["employee"] },
  { href: "/portal/attendance", label: "My Attendance", icon: "CalendarCheck", roles: ["employee"] },
];
