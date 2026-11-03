-- =====================================================================
-- EMPLOYEE PAYROLL MANAGEMENT SYSTEM — COMPLETE SUPABASE SETUP
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it ONCE on a new, empty project. It creates every table, function,
-- trigger, security policy, private storage bucket, default setting and
-- reporting view. (Same content as supabase/migrations/*.sql, in order.)
-- =====================================================================


-- ##### 20260101000001_schema.sql #####
-- =====================================================================
-- Employee Payroll Management System — core schema
-- All money columns use NUMERIC(14,2). Rates use NUMERIC(7,4).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'hr_manager', 'branch_manager', 'employee');
create type public.employment_status as enum ('active', 'inactive', 'resigned', 'terminated');
create type public.employment_type as enum ('permanent', 'contract', 'probation', 'temporary', 'part_time');
create type public.attendance_status as enum ('present', 'absent', 'no_pay_leave', 'approved_leave', 'weekly_off', 'public_holiday');
create type public.payroll_status as enum ('draft', 'processing', 'pending_approval', 'approved', 'finalized');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.commission_type as enum ('sales', 'pre_owned', 'company_device', 'repair');
create type public.commission_status as enum ('pending', 'approved', 'included_in_payroll', 'released', 'cancelled');
create type public.earning_category as enum (
  'basic_salary', 'bra2', 'bra1', 'performance_incentive', 'additional_working_pay',
  'sales_commission', 'pre_owned_commission', 'company_device_commission', 'repair_commission', 'other');
create type public.deduction_category as enum (
  'no_pay_leave', 'sales_commission_released', 'used_commission_released', 'repair_commission_released',
  'company_device_commission_released', 'employee_epf', 'late_arrivals', 'salary_advance', 'loan_repayment', 'other');
create type public.repayment_plan_status as enum ('active', 'on_hold', 'completed', 'cancelled');
create type public.payslip_status as enum ('pending', 'generated', 'failed');
create type public.email_status as enum ('pending', 'queued', 'sent', 'delivered', 'failed', 'bounced');
create type public.queue_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');
create type public.email_verification_status as enum ('unverified', 'verified', 'invalid');

-- ---------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,16}$'),
  address text,
  manager_profile_id uuid,              -- FK added after profiles
  allocated_working_days numeric(5,2) check (allocated_working_days is null or allocated_working_days > 0),
  default_shift_id uuid,                -- FK added after shifts
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_id uuid references public.branches(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

alter table public.branches
  add constraint branches_default_shift_fk foreign key (default_shift_id) references public.shifts(id) on delete set null;

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
create sequence public.employee_code_seq start 1;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique default ('EMP-' || lpad(nextval('public.employee_code_seq')::text, 5, '0')),
  full_name text not null check (length(trim(full_name)) > 1),
  contact_number text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text,
  designation text not null,
  department_id uuid references public.departments(id) on delete set null,
  epf_number text unique,
  branch_id uuid not null references public.branches(id),
  employment_start_date date not null,
  employment_status public.employment_status not null default 'active',
  employment_type public.employment_type not null default 'permanent',
  shift_id uuid references public.shifts(id) on delete set null,
  photo_path text,
  email_notifications_enabled boolean not null default true,
  email_verification_status public.email_verification_status not null default 'unverified',
  last_payslip_email_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_branch_idx on public.employees(branch_id);
create index employees_status_idx on public.employees(employment_status);
create index employees_name_idx on public.employees(lower(full_name));

-- ---------------------------------------------------------------------
-- Users / profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'employee',
  branch_id uuid references public.branches(id) on delete set null,
  employee_id uuid unique references public.employees(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_manager_needs_branch check (role <> 'branch_manager' or branch_id is not null),
  constraint employee_needs_record check (role <> 'employee' or employee_id is not null)
);

alter table public.branches
  add constraint branches_manager_fk foreign key (manager_profile_id) references public.profiles(id) on delete set null;
alter table public.employees
  add constraint employees_created_by_fk foreign key (created_by) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- Effective-dated salary structures
-- ---------------------------------------------------------------------
create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  basic_salary numeric(14,2) not null check (basic_salary >= 0),
  bra2 numeric(14,2) not null default 0 check (bra2 >= 0),
  bra1 numeric(14,2) not null default 0 check (bra1 >= 0),
  performance_incentive numeric(14,2) not null default 0 check (performance_incentive >= 0),
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
create index salary_structures_lookup_idx on public.salary_structures(employee_id, effective_from desc);

create table public.salary_structure_history (
  id uuid primary key default gen_random_uuid(),
  salary_structure_id uuid,
  employee_id uuid not null references public.employees(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index salary_structure_history_emp_idx on public.salary_structure_history(employee_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Settings (single-row tables, enforced by a fixed boolean key)
-- ---------------------------------------------------------------------
create table public.company_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  company_name text not null default 'Your Company (Pvt) Ltd',
  company_address text,
  company_email text,
  company_phone text,
  registration_number text,
  employer_epf_number text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payroll_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  currency text not null default 'LKR',
  default_working_days numeric(5,2) not null default 25 check (default_working_days > 0),
  employee_epf_rate numeric(7,4) not null default 0.08 check (employee_epf_rate between 0 and 1),
  employer_epf_rate numeric(7,4) not null default 0.12 check (employer_epf_rate between 0 and 1),
  employer_etf_rate numeric(7,4) not null default 0.03 check (employer_etf_rate between 0 and 1),
  late_grace_minutes integer not null default 0 check (late_grace_minutes >= 0),
  late_tier1_max_minutes integer not null default 15 check (late_tier1_max_minutes > 0),
  late_tier1_amount numeric(14,2) not null default 250 check (late_tier1_amount >= 0),
  late_tier2_amount numeric(14,2) not null default 500 check (late_tier2_amount >= 0),
  late_deduction_frequency text not null default 'per_incident'
    check (late_deduction_frequency in ('per_incident', 'once_per_month')),
  late_monthly_cap numeric(14,2) check (late_monthly_cap is null or late_monthly_cap >= 0),
  daily_salary_method text not null default 'allocated_days'
    check (daily_salary_method in ('allocated_days', 'calendar_days', 'fixed_divisor')),
  daily_salary_fixed_divisor numeric(5,2) check (daily_salary_fixed_divisor is null or daily_salary_fixed_divisor > 0),
  round_daily_rate boolean not null default false,
  additional_day_multiplier numeric(7,4) not null default 1 check (additional_day_multiplier >= 0),
  no_pay_multiplier numeric(7,4) not null default 1 check (no_pay_multiplier >= 0),
  approved_leave_treatment text not null default 'paid' check (approved_leave_treatment in ('paid', 'unpaid')),
  weekly_off_treatment text not null default 'neutral' check (weekly_off_treatment in ('neutral', 'counts_as_worked')),
  public_holiday_treatment text not null default 'neutral' check (public_holiday_treatment in ('neutral', 'paid')),
  performance_incentive_mode text not null default 'add'
    check (performance_incentive_mode in ('add', 'override')),
  require_approval boolean not null default true,
  require_separate_approver boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  sender_name text not null default 'HR & Payroll',
  sender_email text,
  email_enabled boolean not null default true,
  auto_send_payslips boolean not null default true,
  batch_size integer not null default 20 check (batch_size between 1 and 200),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Working-day allocations (per month; employee > branch > branch default > global default)
-- ---------------------------------------------------------------------
create table public.working_day_allocations (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (extract(day from payroll_month) = 1),
  branch_id uuid references public.branches(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  allocated_days numeric(5,2) not null check (allocated_days > 0 and allocated_days <= 31),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (branch_id is not null or employee_id is not null)
);
create unique index wda_employee_month_uq on public.working_day_allocations(employee_id, payroll_month) where employee_id is not null;
create unique index wda_branch_month_uq on public.working_day_allocations(branch_id, payroll_month) where employee_id is null;

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  work_date date not null,
  shift_start_time time,
  check_in_time time,
  check_out_time time,
  status public.attendance_status not null,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  working_hours numeric(5,2) check (working_hours is null or working_hours between 0 and 24),
  is_additional_working_day boolean not null default false,
  is_off_day boolean not null default false,
  late_waived boolean not null default false,
  late_waiver_reason text,
  late_waived_by uuid references public.profiles(id) on delete set null,
  remarks text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  check (not late_waived or length(coalesce(trim(late_waiver_reason), '')) > 0)
);
create index attendance_month_idx on public.attendance(work_date, branch_id);
create index attendance_employee_idx on public.attendance(employee_id, work_date);

-- ---------------------------------------------------------------------
-- Additional earnings (non-commission inputs: performance incentive, other)
-- Commission categories live in commission_records (single source of truth);
-- additional working pay is always computed from attendance.
-- ---------------------------------------------------------------------
create table public.additional_earnings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  category public.earning_category not null check (category in ('performance_incentive', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_reference text,
  earning_date date not null default current_date,
  payroll_month date not null check (extract(day from payroll_month) = 1),
  description text,
  approval_status public.approval_status not null default 'pending',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  adjusts_payroll_record_id uuid,       -- set when created as a correction of a finalized payroll
  processed_payroll_record_id uuid,     -- set on finalization
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index additional_earnings_ref_uq on public.additional_earnings(employee_id, category, transaction_reference)
  where transaction_reference is not null and approval_status <> 'cancelled';
create index additional_earnings_month_idx on public.additional_earnings(payroll_month, employee_id);

-- ---------------------------------------------------------------------
-- Commissions
-- ---------------------------------------------------------------------
create table public.commission_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  commission_type public.commission_type not null,
  transaction_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  commission_date date not null,
  payroll_month date not null check (extract(day from payroll_month) = 1),
  status public.commission_status not null default 'pending',
  notes text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  included_payroll_record_id uuid,     -- payroll in which it was paid as an earning
  released_date date,                  -- date it was paid out separately
  release_deduction_month date check (release_deduction_month is null or extract(day from release_deduction_month) = 1),
  release_deducted_payroll_record_id uuid, -- payroll in which the release was recovered
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commission_type, transaction_id, employee_id),
  check (status <> 'released' or released_date is not null)
);
create index commission_month_idx on public.commission_records(payroll_month, employee_id);
create index commission_release_idx on public.commission_records(release_deduction_month, employee_id) where status = 'released';

-- ---------------------------------------------------------------------
-- Salary advances & loans
-- ---------------------------------------------------------------------
create table public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  advance_date date not null,
  outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
  monthly_repayment numeric(14,2) not null check (monthly_repayment > 0),
  repayment_start_month date not null check (extract(day from repayment_start_month) = 1),
  status public.repayment_plan_status not null default 'active',
  remarks text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outstanding_balance <= amount)
);
create index salary_advances_emp_idx on public.salary_advances(employee_id, status);

create table public.advance_repayments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.salary_advances(id) on delete restrict,
  payroll_record_id uuid not null,
  payroll_month date not null,
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (advance_id, payroll_month)
);

create table public.employee_loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  original_amount numeric(14,2) not null check (original_amount > 0),
  outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
  monthly_repayment numeric(14,2) not null check (monthly_repayment > 0),
  start_date date not null,
  repayment_start_month date not null check (extract(day from repayment_start_month) = 1),
  status public.repayment_plan_status not null default 'active',
  remarks text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outstanding_balance <= original_amount)
);
create index employee_loans_emp_idx on public.employee_loans(employee_id, status);

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.employee_loans(id) on delete restrict,
  payroll_record_id uuid not null,
  payroll_month date not null,
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (loan_id, payroll_month)
);

-- ---------------------------------------------------------------------
-- Manual ("other authorized") deductions — require a reason and authorizer
-- ---------------------------------------------------------------------
create table public.manual_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  payroll_month date not null check (extract(day from payroll_month) = 1),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 3),
  reference text,
  status public.approval_status not null default 'approved',
  authorized_by uuid not null references public.profiles(id),
  adjusts_payroll_record_id uuid,
  processed_payroll_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index manual_deductions_month_idx on public.manual_deductions(payroll_month, employee_id);

-- ---------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (extract(day from payroll_month) = 1),
  branch_id uuid references public.branches(id),     -- null = all branches
  status public.payroll_status not null default 'draft',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payroll_periods_month_branch_uq
  on public.payroll_periods(payroll_month, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  payroll_month date not null,
  -- snapshots (preserved after finalization)
  employee_code text not null,
  employee_name text not null,
  designation text not null,
  epf_number text,
  branch_id uuid not null references public.branches(id),
  branch_name text not null,
  salary_structure_id uuid references public.salary_structures(id),
  basic_salary numeric(14,2) not null default 0,
  bra2 numeric(14,2) not null default 0,
  bra1 numeric(14,2) not null default 0,
  performance_incentive numeric(14,2) not null default 0,
  -- calculation bases (kept separate)
  epf_salary_basis numeric(14,2) not null default 0,
  daily_salary_basis numeric(14,2) not null default 0,
  daily_salary_rate numeric(14,4) not null default 0,
  allocated_working_days numeric(5,2) not null default 0,
  actual_working_days numeric(5,2) not null default 0,
  additional_working_days numeric(5,2) not null default 0,
  additional_off_days numeric(5,2) not null default 0,
  additional_working_pay numeric(14,2) not null default 0,
  no_pay_leave numeric(14,2) not null default 0,
  late_deduction numeric(14,2) not null default 0,
  employee_epf numeric(14,2) not null default 0,
  employer_epf numeric(14,2) not null default 0,
  employer_etf numeric(14,2) not null default 0,
  total_earnings numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0,
  status public.payroll_status not null default 'draft',
  needs_recalculation boolean not null default true,
  source_version bigint not null default 0,
  calculation_breakdown jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  calculated_at timestamptz,
  calculated_by uuid references public.profiles(id) on delete set null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, payroll_month),
  check (not (additional_working_days > 0 and additional_off_days > 0)),
  check (not (additional_working_pay > 0 and no_pay_leave > 0))
);
create index payroll_records_period_idx on public.payroll_records(payroll_period_id);
create index payroll_records_month_idx on public.payroll_records(payroll_month, branch_id);
create index payroll_records_stale_idx on public.payroll_records(employee_id, payroll_month) where needs_recalculation;

create table public.payroll_earnings (
  id uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  category public.earning_category not null,
  label text not null,
  amount numeric(14,2) not null check (amount >= 0),
  source_type text not null check (source_type in ('salary_structure', 'attendance', 'commission', 'additional_earning')),
  source_id uuid,
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index payroll_earnings_source_uq
  on public.payroll_earnings(payroll_record_id, category, source_type, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null references public.payroll_records(id) on delete cascade,
  category public.deduction_category not null,
  label text not null,
  amount numeric(14,2) not null check (amount >= 0),
  source_type text not null check (source_type in ('attendance', 'epf', 'commission_release', 'salary_advance', 'loan', 'manual_deduction')),
  source_id uuid,
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index payroll_deductions_source_uq
  on public.payroll_deductions(payroll_record_id, category, source_type, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.advance_repayments add constraint advance_repayments_record_fk
  foreign key (payroll_record_id) references public.payroll_records(id) on delete restrict;
alter table public.loan_repayments add constraint loan_repayments_record_fk
  foreign key (payroll_record_id) references public.payroll_records(id) on delete restrict;
alter table public.additional_earnings add constraint ae_processed_fk
  foreign key (processed_payroll_record_id) references public.payroll_records(id) on delete set null;
alter table public.additional_earnings add constraint ae_adjusts_fk
  foreign key (adjusts_payroll_record_id) references public.payroll_records(id) on delete set null;
alter table public.manual_deductions add constraint md_processed_fk
  foreign key (processed_payroll_record_id) references public.payroll_records(id) on delete set null;
alter table public.manual_deductions add constraint md_adjusts_fk
  foreign key (adjusts_payroll_record_id) references public.payroll_records(id) on delete set null;
alter table public.commission_records add constraint cr_included_fk
  foreign key (included_payroll_record_id) references public.payroll_records(id) on delete set null;
alter table public.commission_records add constraint cr_release_deducted_fk
  foreign key (release_deducted_payroll_record_id) references public.payroll_records(id) on delete set null;

-- ---------------------------------------------------------------------
-- Payslips & email delivery
-- ---------------------------------------------------------------------
create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_record_id uuid not null unique references public.payroll_records(id) on delete restrict,
  employee_id uuid not null references public.employees(id),
  payroll_month date not null,
  reference_number text not null unique,
  storage_path text,
  status public.payslip_status not null default 'pending',
  generation_attempts integer not null default 0,
  locked_at timestamptz,
  error_message text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payslips_employee_idx on public.payslips(employee_id, payroll_month desc);
create index payslips_pending_idx on public.payslips(status) where status <> 'generated';

create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  payroll_record_id uuid not null references public.payroll_records(id),
  payslip_id uuid not null references public.payslips(id),
  recipient_email text not null check (recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_subject text not null,
  email_status public.email_status not null default 'pending',
  brevo_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failure_reason text,
  attempt_count integer not null default 0,
  is_manual_resend boolean not null default false,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Only one automatic notification per payslip; manual resends are separate rows.
create unique index email_notifications_auto_uq on public.email_notifications(payslip_id) where not is_manual_resend;
create index email_notifications_status_idx on public.email_notifications(email_status, created_at desc);
create unique index email_notifications_msgid_uq on public.email_notifications(brevo_message_id) where brevo_message_id is not null;

create table public.email_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  email_notification_id uuid not null references public.email_notifications(id) on delete cascade,
  attempt_number integer not null,
  brevo_message_id text,
  status text not null,
  error_message text,
  attempted_at timestamptz not null default now(),
  unique (email_notification_id, attempt_number)
);

create table public.email_queue (
  id uuid primary key default gen_random_uuid(),
  email_notification_id uuid not null unique references public.email_notifications(id) on delete cascade,
  status public.queue_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_queue_ready_idx on public.email_queue(next_attempt_at) where status in ('pending', 'processing');

create table public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  brevo_message_id text,
  event text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index email_webhook_events_msg_idx on public.email_webhook_events(brevo_message_id);

-- ---------------------------------------------------------------------
-- Audit log & in-app notifications
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role public.app_role,
  recipient_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index app_notifications_recipient_idx on public.app_notifications(recipient_id, is_read, created_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'departments','branches','shifts','employees','profiles','salary_structures','company_settings',
    'payroll_settings','email_settings','working_day_allocations','attendance','additional_earnings',
    'commission_records','salary_advances','employee_loans','manual_deductions','payroll_periods',
    'payroll_records','payslips','email_notifications','email_queue']
  loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ##### 20260101000002_functions.sql #####
-- =====================================================================
-- Helper functions, integrity triggers, payroll workflow and queue RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auth helpers (security definer so RLS policies can call them cheaply)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin', 'hr_manager') from public.profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.current_branch_id() returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid() and is_active and role = 'branch_manager'
$$;

create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and is_active
$$;

-- ---------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------
create or replace function public.write_audit(p_action text, p_entity_type text, p_entity_id uuid, p_summary text,
                                              p_old jsonb default null, p_new jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, summary, old_values, new_values)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_summary, p_old, p_new)
$$;

-- ---------------------------------------------------------------------
-- Month helpers
-- ---------------------------------------------------------------------
create or replace function public.month_start(d date) returns date
language sql immutable as $$ select date_trunc('month', d)::date $$;

create or replace function public.is_month_finalized(p_employee uuid, p_month date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_records
    where employee_id = p_employee and payroll_month = public.month_start(p_month) and status = 'finalized')
$$;

-- ---------------------------------------------------------------------
-- Stale-marking: any change to a payroll input flags the affected
-- non-finalized payroll record for recalculation and bumps its version.
-- ---------------------------------------------------------------------
create or replace function public.mark_payroll_stale(p_employee uuid, p_month date) returns void
language sql security definer set search_path = public as $$
  update public.payroll_records
     set needs_recalculation = true, source_version = source_version + 1
   where employee_id = p_employee
     and payroll_month = public.month_start(p_month)
     and status <> 'finalized'
$$;

create or replace function public.mark_payroll_stale_from(p_employee uuid, p_from_month date) returns void
language sql security definer set search_path = public as $$
  update public.payroll_records
     set needs_recalculation = true, source_version = source_version + 1
   where employee_id = p_employee
     and payroll_month >= public.month_start(p_from_month)
     and status <> 'finalized'
$$;

-- Attendance -----------------------------------------------------------
create or replace function public.trg_attendance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and public.is_month_finalized(old.employee_id, old.work_date) then
    raise exception 'Attendance for % on % belongs to a finalized payroll and cannot be changed. Use a payroll adjustment instead.',
      old.employee_id, old.work_date using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.is_month_finalized(new.employee_id, new.work_date) then
    raise exception 'Payroll for % is already finalized; attendance cannot be added or moved into it.',
      to_char(new.work_date, 'FMMonth YYYY') using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- derived flags
  new.is_off_day := new.status in ('weekly_off', 'public_holiday');
  if new.status <> 'present' then
    new.late_minutes := 0;
  elsif new.shift_start_time is not null and new.check_in_time is not null then
    new.late_minutes := greatest(0, floor(extract(epoch from (new.check_in_time - new.shift_start_time)) / 60)::int);
  end if;
  if new.check_in_time is not null and new.check_out_time is not null and new.check_out_time > new.check_in_time then
    new.working_hours := round((extract(epoch from (new.check_out_time - new.check_in_time)) / 3600)::numeric, 2);
  end if;
  return new;
end $$;

create or replace function public.trg_attendance_stale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.employee_id <> new.employee_id
      or public.month_start(old.work_date) <> public.month_start(new.work_date))) then
    perform public.mark_payroll_stale(old.employee_id, old.work_date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.mark_payroll_stale(new.employee_id, new.work_date); end if;
  return null;
end $$;

create trigger attendance_guard before insert or update or delete on public.attendance
  for each row execute function public.trg_attendance_guard();
create trigger attendance_stale after insert or update or delete on public.attendance
  for each row execute function public.trg_attendance_stale();

-- Salary structures -------------------------------------------------------
create or replace function public.trg_salary_structure_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_next date;
begin
  if tg_op = 'INSERT' then
    -- close the structure that was open on the new effective date
    update public.salary_structures
       set effective_to = new.effective_from - 1
     where employee_id = new.employee_id
       and effective_from < new.effective_from
       and (effective_to is null or effective_to >= new.effective_from);
    -- a back-dated insert ends the day before the next structure starts
    select min(effective_from) into v_next from public.salary_structures
     where employee_id = new.employee_id and effective_from > new.effective_from;
    if v_next is not null then new.effective_to := v_next - 1; end if;
    return new;
  end if;

  if exists (select 1 from public.payroll_records pr
              where pr.salary_structure_id = old.id and pr.status = 'finalized') then
    if tg_op = 'DELETE' or new.basic_salary <> old.basic_salary or new.bra2 <> old.bra2 or new.bra1 <> old.bra1
       or new.performance_incentive <> old.performance_incentive or new.effective_from <> old.effective_from then
      raise exception 'This salary structure was used in a finalized payroll. Create a new effective-dated structure instead of editing it.'
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.trg_salary_structure_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.salary_structure_history(salary_structure_id, employee_id, action, old_values, new_values, changed_by)
  values (coalesce(new.id, old.id), coalesce(new.employee_id, old.employee_id), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  perform public.mark_payroll_stale_from(coalesce(new.employee_id, old.employee_id),
                                         least(coalesce(new.effective_from, old.effective_from), coalesce(old.effective_from, new.effective_from)));
  return null;
end $$;

create trigger salary_structures_before before insert or update or delete on public.salary_structures
  for each row execute function public.trg_salary_structure_before();
create trigger salary_structures_after after insert or update or delete on public.salary_structures
  for each row execute function public.trg_salary_structure_after();

-- Additional earnings & manual deductions ------------------------------------
create or replace function public.trg_monthly_input_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.processed_payroll_record_id is not null then
    -- the finalize procedure is the only writer allowed to touch processed rows (it sets the id once)
    if tg_op = 'DELETE' or old.processed_payroll_record_id is distinct from new.processed_payroll_record_id
       or to_jsonb(old) - 'updated_at' - 'processed_payroll_record_id' <> to_jsonb(new) - 'updated_at' - 'processed_payroll_record_id' then
      raise exception 'This record was paid in a finalized payroll and cannot be changed.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.processed_payroll_record_id is null
     and public.is_month_finalized(new.employee_id, new.payroll_month) then
    raise exception 'Payroll for % is already finalized for this employee. Choose an open payroll month.',
      to_char(new.payroll_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.trg_monthly_input_stale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.employee_id <> new.employee_id or old.payroll_month <> new.payroll_month)) then
    perform public.mark_payroll_stale(old.employee_id, old.payroll_month);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.mark_payroll_stale(new.employee_id, new.payroll_month); end if;
  return null;
end $$;

create trigger additional_earnings_guard before insert or update or delete on public.additional_earnings
  for each row execute function public.trg_monthly_input_guard();
create trigger additional_earnings_stale after insert or update or delete on public.additional_earnings
  for each row execute function public.trg_monthly_input_stale();
create trigger manual_deductions_guard before insert or update or delete on public.manual_deductions
  for each row execute function public.trg_monthly_input_guard();
create trigger manual_deductions_stale after insert or update or delete on public.manual_deductions
  for each row execute function public.trg_monthly_input_stale();

-- Commissions ---------------------------------------------------------------
create or replace function public.trg_commission_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.included_payroll_record_id is not null or old.release_deducted_payroll_record_id is not null then
      raise exception 'Commission % is part of a finalized payroll and cannot be deleted.', old.transaction_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.included_payroll_record_id is not null and (
         new.amount <> old.amount or new.employee_id <> old.employee_id or new.commission_type <> old.commission_type
         or new.payroll_month <> old.payroll_month or new.status = 'cancelled'
         or new.included_payroll_record_id is distinct from old.included_payroll_record_id) then
      raise exception 'Commission % was paid in a finalized payroll; only its release can be recorded.', old.transaction_id using errcode = 'P0001';
    end if;
    if old.release_deducted_payroll_record_id is not null then
      raise exception 'The release of commission % was already recovered in payroll; it cannot be changed.', old.transaction_id using errcode = 'P0001';
    end if;
    if old.status = 'released' and new.status = 'released' and old.released_date is distinct from new.released_date then
      raise exception 'Commission % is already released.', old.transaction_id using errcode = 'P0001';
    end if;
    if old.status = 'released' and new.status not in ('released') and new.release_deducted_payroll_record_id is null then
      -- allow undoing a release only while it has not been recovered and was never paid in payroll
      if old.included_payroll_record_id is not null and new.status <> 'included_in_payroll' then
        raise exception 'A released commission that was paid in payroll can only be reverted to "Included in Payroll".' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- a release only produces a recovery deduction when the commission was paid in an earlier payroll
  if new.status = 'released' then
    if new.released_date is null then new.released_date := current_date; end if;
    if new.included_payroll_record_id is null then
      new.release_deduction_month := null;
    elsif new.release_deduction_month is null then
      new.release_deduction_month := public.month_start(new.released_date);
    end if;
  end if;

  if new.included_payroll_record_id is null and new.status in ('pending', 'approved')
     and public.is_month_finalized(new.employee_id, new.payroll_month) then
    raise exception 'Payroll for % is already finalized for this employee. Choose an open payroll month.',
      to_char(new.payroll_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;
  if new.release_deduction_month is not null and new.release_deducted_payroll_record_id is null
     and public.is_month_finalized(new.employee_id, new.release_deduction_month) then
    raise exception 'The recovery month % is already finalized. Choose a later month.',
      to_char(new.release_deduction_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.trg_commission_stale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.mark_payroll_stale(old.employee_id, old.payroll_month);
    if old.release_deduction_month is not null then perform public.mark_payroll_stale(old.employee_id, old.release_deduction_month); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.mark_payroll_stale(new.employee_id, new.payroll_month);
    if new.release_deduction_month is not null then perform public.mark_payroll_stale(new.employee_id, new.release_deduction_month); end if;
  end if;
  return null;
end $$;

create trigger commission_guard before insert or update or delete on public.commission_records
  for each row execute function public.trg_commission_guard();
create trigger commission_stale after insert or update or delete on public.commission_records
  for each row execute function public.trg_commission_stale();

-- Advances & loans ---------------------------------------------------------
create or replace function public.trg_repayment_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'salary_advances' and exists (select 1 from public.advance_repayments where advance_id = old.id)
       or tg_table_name = 'employee_loans' and exists (select 1 from public.loan_repayments where loan_id = old.id) then
      raise exception 'This record has repayment history and cannot be deleted. Cancel it instead.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.monthly_repayment > new.outstanding_balance and new.outstanding_balance > 0 then
    -- not an error: the engine caps the instalment at the outstanding balance
    null;
  end if;
  if new.outstanding_balance = 0 and new.status = 'active' then new.status := 'completed'; end if;
  return new;
end $$;

create or replace function public.trg_repayment_plan_stale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.mark_payroll_stale_from(coalesce(new.employee_id, old.employee_id),
                                         least(coalesce(new.repayment_start_month, old.repayment_start_month),
                                               coalesce(old.repayment_start_month, new.repayment_start_month)));
  return null;
end $$;

create trigger salary_advances_guard before insert or update or delete on public.salary_advances
  for each row execute function public.trg_repayment_plan_guard();
create trigger salary_advances_stale after insert or update or delete on public.salary_advances
  for each row execute function public.trg_repayment_plan_stale();
create trigger employee_loans_guard before insert or update or delete on public.employee_loans
  for each row execute function public.trg_repayment_plan_guard();
create trigger employee_loans_stale after insert or update or delete on public.employee_loans
  for each row execute function public.trg_repayment_plan_stale();

-- Working-day allocations ------------------------------------------------------
create or replace function public.trg_allocation_stale() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from (select old.employee_id, old.branch_id, old.payroll_month where tg_op <> 'INSERT'
                          union all
                          select new.employee_id, new.branch_id, new.payroll_month where tg_op <> 'DELETE') x
  loop
    if r.employee_id is not null then
      perform public.mark_payroll_stale(r.employee_id, r.payroll_month);
    else
      update public.payroll_records set needs_recalculation = true, source_version = source_version + 1
       where branch_id = r.branch_id and payroll_month = r.payroll_month and status <> 'finalized';
    end if;
  end loop;
  return null;
end $$;

create trigger working_day_allocations_stale after insert or update or delete on public.working_day_allocations
  for each row execute function public.trg_allocation_stale();

-- Settings / branch defaults that change the calculation -----------------------
create or replace function public.trg_settings_stale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'branches' then
    if new.allocated_working_days is distinct from old.allocated_working_days then
      update public.payroll_records set needs_recalculation = true, source_version = source_version + 1
       where branch_id = new.id and status <> 'finalized';
    end if;
  else
    update public.payroll_records set needs_recalculation = true, source_version = source_version + 1
     where status <> 'finalized';
  end if;
  return null;
end $$;

create trigger payroll_settings_stale after update on public.payroll_settings
  for each row execute function public.trg_settings_stale();
create trigger branches_stale after update on public.branches
  for each row execute function public.trg_settings_stale();

-- ---------------------------------------------------------------------
-- Finalized payroll is immutable
-- ---------------------------------------------------------------------
create or replace function public.trg_payroll_record_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'finalized' then
    raise exception 'Payroll record % is finalized and locked. Use an authorized adjustment instead.', old.id using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger payroll_records_guard before update or delete on public.payroll_records
  for each row execute function public.trg_payroll_record_guard();

create or replace function public.trg_payroll_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status public.payroll_status;
begin
  select status into v_status from public.payroll_records where id = coalesce(new.payroll_record_id, old.payroll_record_id);
  if v_status = 'finalized' then
    raise exception 'Lines of a finalized payroll cannot be changed.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger payroll_earnings_guard before insert or update or delete on public.payroll_earnings
  for each row execute function public.trg_payroll_line_guard();
create trigger payroll_deductions_guard before insert or update or delete on public.payroll_deductions
  for each row execute function public.trg_payroll_line_guard();

create or replace function public.trg_period_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'finalized' then
    if tg_op = 'DELETE' or new.status <> 'finalized' or new.payroll_month <> old.payroll_month
       or new.branch_id is distinct from old.branch_id then
      raise exception 'A finalized payroll period cannot be changed or deleted.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger payroll_periods_guard before update or delete on public.payroll_periods
  for each row execute function public.trg_period_guard();

-- ---------------------------------------------------------------------
-- Persist one calculation atomically (called by the server-side engine)
-- ---------------------------------------------------------------------
create or replace function public.save_payroll_calculation(
  p_record_id uuid, p_expected_version bigint, p_values jsonb, p_earnings jsonb, p_deductions jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec public.payroll_records%rowtype;
  v_period public.payroll_periods%rowtype;
  v_changed boolean;
begin
  if not public.is_admin() and auth.role() <> 'service_role' then
    raise exception 'Not authorized to calculate payroll.' using errcode = '42501';
  end if;

  select * into v_rec from public.payroll_records where id = p_record_id for update;
  if not found then raise exception 'Payroll record not found.'; end if;
  if v_rec.status = 'finalized' then raise exception 'Payroll record is finalized.' using errcode = 'P0001'; end if;
  select * into v_period from public.payroll_periods where id = v_rec.payroll_period_id for update;

  v_changed := v_rec.net_salary is distinct from (p_values->>'net_salary')::numeric
            or v_rec.total_earnings is distinct from (p_values->>'total_earnings')::numeric
            or v_rec.total_deductions is distinct from (p_values->>'total_deductions')::numeric;

  delete from public.payroll_earnings where payroll_record_id = p_record_id;
  delete from public.payroll_deductions where payroll_record_id = p_record_id;

  update public.payroll_records set
    salary_structure_id     = nullif(p_values->>'salary_structure_id', '')::uuid,
    employee_code           = coalesce(p_values->>'employee_code', employee_code),
    employee_name           = coalesce(p_values->>'employee_name', employee_name),
    designation             = coalesce(p_values->>'designation', designation),
    epf_number              = p_values->>'epf_number',
    branch_name             = coalesce(p_values->>'branch_name', branch_name),
    basic_salary            = (p_values->>'basic_salary')::numeric,
    bra2                    = (p_values->>'bra2')::numeric,
    bra1                    = (p_values->>'bra1')::numeric,
    performance_incentive   = (p_values->>'performance_incentive')::numeric,
    epf_salary_basis        = (p_values->>'epf_salary_basis')::numeric,
    daily_salary_basis      = (p_values->>'daily_salary_basis')::numeric,
    daily_salary_rate       = (p_values->>'daily_salary_rate')::numeric,
    allocated_working_days  = (p_values->>'allocated_working_days')::numeric,
    actual_working_days     = (p_values->>'actual_working_days')::numeric,
    additional_working_days = (p_values->>'additional_working_days')::numeric,
    additional_off_days     = (p_values->>'additional_off_days')::numeric,
    additional_working_pay  = (p_values->>'additional_working_pay')::numeric,
    no_pay_leave            = (p_values->>'no_pay_leave')::numeric,
    late_deduction          = (p_values->>'late_deduction')::numeric,
    employee_epf            = (p_values->>'employee_epf')::numeric,
    employer_epf            = (p_values->>'employer_epf')::numeric,
    employer_etf            = (p_values->>'employer_etf')::numeric,
    total_earnings          = (p_values->>'total_earnings')::numeric,
    total_deductions        = (p_values->>'total_deductions')::numeric,
    net_salary              = (p_values->>'net_salary')::numeric,
    calculation_breakdown   = coalesce(p_values->'calculation_breakdown', '{}'::jsonb),
    warnings                = coalesce(p_values->'warnings', '[]'::jsonb),
    calculated_at           = now(),
    calculated_by           = auth.uid(),
    -- only clear the stale flag if no input changed while we were calculating
    needs_recalculation     = (source_version <> p_expected_version)
  where id = p_record_id;

  insert into public.payroll_earnings(payroll_record_id, category, label, amount, source_type, source_id, calculation)
  select p_record_id, x.category::public.earning_category, x.label, x.amount, x.source_type, x.source_id, coalesce(x.calculation, '{}'::jsonb)
    from jsonb_to_recordset(p_earnings) as x(category text, label text, amount numeric, source_type text, source_id uuid, calculation jsonb);

  insert into public.payroll_deductions(payroll_record_id, category, label, amount, source_type, source_id, calculation)
  select p_record_id, x.category::public.deduction_category, x.label, x.amount, x.source_type, x.source_id, coalesce(x.calculation, '{}'::jsonb)
    from jsonb_to_recordset(p_deductions) as x(category text, label text, amount numeric, source_type text, source_id uuid, calculation jsonb);

  -- a change after submission invalidates the approval
  if v_changed and v_period.status in ('pending_approval', 'approved') then
    update public.payroll_periods set status = 'draft', approved_by = null, approved_at = null,
           notes = concat_ws(E'\n', notes, to_char(now(), 'YYYY-MM-DD HH24:MI') || ': returned to draft because payroll inputs changed.')
     where id = v_period.id;
    update public.payroll_records set status = 'draft' where payroll_period_id = v_period.id and status <> 'finalized';
    perform public.write_audit('payroll.reverted_to_draft', 'payroll_period', v_period.id,
      'Approval invalidated: recalculated values changed for ' || v_rec.employee_code);
  end if;

  return jsonb_build_object('record_id', p_record_id, 'changed', v_changed);
end $$;

-- ---------------------------------------------------------------------
-- Payroll workflow
-- ---------------------------------------------------------------------
create or replace function public.payroll_blocking_issues(p_period_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('employee_code', employee_code, 'employee_name', employee_name, 'issue', issue)), '[]'::jsonb)
  from (
    select employee_code, employee_name, 'Needs recalculation' as issue from public.payroll_records
     where payroll_period_id = p_period_id and needs_recalculation
    union all
    select employee_code, employee_name, 'No active salary structure for the month' from public.payroll_records
     where payroll_period_id = p_period_id and salary_structure_id is null
    union all
    select employee_code, employee_name, 'Allocated working days must be greater than zero' from public.payroll_records
     where payroll_period_id = p_period_id and allocated_working_days <= 0
    union all
    select employee_code, employee_name, 'Net salary is negative' from public.payroll_records
     where payroll_period_id = p_period_id and net_salary < 0
    union all
    select pr.employee_code, pr.employee_name, w->>'message' from public.payroll_records pr,
           jsonb_array_elements(pr.warnings) w
     where pr.payroll_period_id = p_period_id and (w->>'blocking')::boolean
  ) issues
  where public.is_admin() or auth.role() = 'service_role'
$$;

create or replace function public.submit_payroll_period(p_period_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_period public.payroll_periods%rowtype; v_issues jsonb;
begin
  if not public.is_admin() then raise exception 'Only HR or Super Admin can submit payroll.' using errcode = '42501'; end if;
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.status not in ('draft', 'processing') then
    raise exception 'Only draft payroll can be submitted (current status: %).', v_period.status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.payroll_records where payroll_period_id = p_period_id) then
    raise exception 'This payroll has no employee records.' using errcode = 'P0001';
  end if;
  v_issues := public.payroll_blocking_issues(p_period_id);
  if jsonb_array_length(v_issues) > 0 then
    raise exception 'Payroll has % unresolved issue(s). Review the payroll before submitting.', jsonb_array_length(v_issues)
      using errcode = 'P0001', detail = v_issues::text;
  end if;
  update public.payroll_periods set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now() where id = p_period_id;
  update public.payroll_records set status = 'pending_approval' where payroll_period_id = p_period_id;
  perform public.write_audit('payroll.submitted', 'payroll_period', p_period_id, 'Payroll submitted for approval');
  insert into public.app_notifications(recipient_role, title, body, link)
  values ('super_admin', 'Payroll awaiting approval', to_char(v_period.payroll_month, 'FMMonth YYYY') || ' payroll was submitted.',
          '/payroll/' || p_period_id);
end $$;

create or replace function public.approve_payroll_period(p_period_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_period public.payroll_periods%rowtype; v_sep boolean;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can approve payroll.' using errcode = '42501'; end if;
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.status <> 'pending_approval' then
    raise exception 'Only payroll pending approval can be approved (current status: %).', v_period.status using errcode = 'P0001';
  end if;
  select require_separate_approver into v_sep from public.payroll_settings limit 1;
  if coalesce(v_sep, false) and v_period.submitted_by = auth.uid() then
    raise exception 'Payroll settings require a different user to approve than the one who submitted.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(public.payroll_blocking_issues(p_period_id)) > 0 then
    raise exception 'Payroll inputs changed since submission. Recalculate and resubmit.' using errcode = 'P0001';
  end if;
  update public.payroll_periods set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_period_id;
  update public.payroll_records set status = 'approved' where payroll_period_id = p_period_id;
  perform public.write_audit('payroll.approved', 'payroll_period', p_period_id, 'Payroll approved');
end $$;

create or replace function public.return_payroll_to_draft(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_period public.payroll_periods%rowtype;
begin
  if not public.is_admin() then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason), '')) < 3 then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if v_period.status = 'finalized' then raise exception 'Finalized payroll cannot be reopened.' using errcode = 'P0001'; end if;
  update public.payroll_periods set status = 'draft', approved_by = null, approved_at = null,
         notes = concat_ws(E'\n', notes, to_char(now(), 'YYYY-MM-DD HH24:MI') || ': returned to draft — ' || p_reason)
   where id = p_period_id;
  update public.payroll_records set status = 'draft' where payroll_period_id = p_period_id;
  perform public.write_audit('payroll.returned_to_draft', 'payroll_period', p_period_id, p_reason);
end $$;

create or replace function public.finalize_payroll_period(p_period_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_period public.payroll_periods%rowtype;
  v_require_approval boolean;
  v_issues jsonb;
  d record;
  v_balance numeric;
  v_count int;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can finalize payroll.' using errcode = '42501'; end if;
  select * into v_period from public.payroll_periods where id = p_period_id for update;
  if not found then raise exception 'Payroll period not found.'; end if;
  if v_period.status = 'finalized' then raise exception 'Payroll is already finalized.' using errcode = 'P0001'; end if;

  select require_approval into v_require_approval from public.payroll_settings limit 1;
  if coalesce(v_require_approval, true) and v_period.status <> 'approved' then
    raise exception 'Payroll must be approved before it can be finalized (current status: %).', v_period.status using errcode = 'P0001';
  end if;
  if not coalesce(v_require_approval, true) and v_period.status not in ('approved', 'pending_approval', 'draft', 'processing') then
    raise exception 'Payroll cannot be finalized from status %.', v_period.status using errcode = 'P0001';
  end if;

  -- lock every record of the period before checking, so nothing changes underneath us
  perform 1 from public.payroll_records where payroll_period_id = p_period_id for update;
  v_issues := public.payroll_blocking_issues(p_period_id);
  if jsonb_array_length(v_issues) > 0 then
    raise exception 'Payroll cannot be finalized: % unresolved issue(s).', jsonb_array_length(v_issues)
      using errcode = 'P0001', detail = v_issues::text;
  end if;

  -- Loans ------------------------------------------------------------
  for d in select pd.*, pr.payroll_month from public.payroll_deductions pd
             join public.payroll_records pr on pr.id = pd.payroll_record_id
            where pr.payroll_period_id = p_period_id and pd.category = 'loan_repayment' and pd.amount > 0
  loop
    select outstanding_balance into v_balance from public.employee_loans where id = d.source_id and status = 'active' for update;
    if v_balance is null then raise exception 'Loan % is no longer active.', d.source_id using errcode = 'P0001'; end if;
    if d.amount > v_balance then raise exception 'Loan repayment exceeds the outstanding balance for loan %.', d.source_id using errcode = 'P0001'; end if;
    update public.employee_loans set outstanding_balance = v_balance - d.amount,
           status = case when v_balance - d.amount = 0 then 'completed'::public.repayment_plan_status else status end
     where id = d.source_id;
    insert into public.loan_repayments(loan_id, payroll_record_id, payroll_month, amount, balance_after)
    values (d.source_id, d.payroll_record_id, d.payroll_month, d.amount, v_balance - d.amount);
  end loop;

  -- Salary advances ------------------------------------------------------
  for d in select pd.*, pr.payroll_month from public.payroll_deductions pd
             join public.payroll_records pr on pr.id = pd.payroll_record_id
            where pr.payroll_period_id = p_period_id and pd.category = 'salary_advance' and pd.amount > 0
  loop
    select outstanding_balance into v_balance from public.salary_advances where id = d.source_id and status = 'active' for update;
    if v_balance is null then raise exception 'Salary advance % is no longer active.', d.source_id using errcode = 'P0001'; end if;
    if d.amount > v_balance then raise exception 'Advance repayment exceeds the outstanding balance for advance %.', d.source_id using errcode = 'P0001'; end if;
    update public.salary_advances set outstanding_balance = v_balance - d.amount,
           status = case when v_balance - d.amount = 0 then 'completed'::public.repayment_plan_status else status end
     where id = d.source_id;
    insert into public.advance_repayments(advance_id, payroll_record_id, payroll_month, amount, balance_after)
    values (d.source_id, d.payroll_record_id, d.payroll_month, d.amount, v_balance - d.amount);
  end loop;

  -- Commissions paid as earnings ------------------------------------------
  for d in select pe.* from public.payroll_earnings pe join public.payroll_records pr on pr.id = pe.payroll_record_id
            where pr.payroll_period_id = p_period_id and pe.source_type = 'commission'
  loop
    update public.commission_records set status = 'included_in_payroll', included_payroll_record_id = d.payroll_record_id
     where id = d.source_id and status = 'approved' and included_payroll_record_id is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Commission % changed after calculation. Recalculate before finalizing.', d.source_id using errcode = 'P0001'; end if;
  end loop;

  -- Commission releases recovered as deductions -----------------------------
  for d in select pd.* from public.payroll_deductions pd join public.payroll_records pr on pr.id = pd.payroll_record_id
            where pr.payroll_period_id = p_period_id and pd.source_type = 'commission_release'
  loop
    update public.commission_records set release_deducted_payroll_record_id = d.payroll_record_id
     where id = d.source_id and status = 'released' and release_deducted_payroll_record_id is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Commission release % was already recovered or changed.', d.source_id using errcode = 'P0001'; end if;
  end loop;

  -- Additional earnings & manual deductions --------------------------------
  for d in select pe.* from public.payroll_earnings pe join public.payroll_records pr on pr.id = pe.payroll_record_id
            where pr.payroll_period_id = p_period_id and pe.source_type = 'additional_earning'
  loop
    update public.additional_earnings set processed_payroll_record_id = d.payroll_record_id
     where id = d.source_id and approval_status = 'approved' and processed_payroll_record_id is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Additional earning % changed after calculation.', d.source_id using errcode = 'P0001'; end if;
  end loop;

  for d in select pd.* from public.payroll_deductions pd join public.payroll_records pr on pr.id = pd.payroll_record_id
            where pr.payroll_period_id = p_period_id and pd.source_type = 'manual_deduction'
  loop
    update public.manual_deductions set processed_payroll_record_id = d.payroll_record_id
     where id = d.source_id and status = 'approved' and processed_payroll_record_id is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Manual deduction % changed after calculation.', d.source_id using errcode = 'P0001'; end if;
  end loop;

  -- Lock records & period ---------------------------------------------------
  -- (input triggers above re-flag the period's own rows; they were verified, so clear the flag as we lock)
  update public.payroll_records set status = 'finalized', is_locked = true, needs_recalculation = false
   where payroll_period_id = p_period_id;
  update public.payroll_periods set status = 'finalized', finalized_by = auth.uid(), finalized_at = now(),
         approved_by = coalesce(approved_by, auth.uid()), approved_at = coalesce(approved_at, now())
   where id = p_period_id;

  -- Payslip jobs (PDFs are rendered by the background worker) -----------------
  insert into public.payslips(payroll_record_id, employee_id, payroll_month, reference_number)
  select pr.id, pr.employee_id, pr.payroll_month,
         'PS-' || to_char(pr.payroll_month, 'YYYYMM') || '-' || pr.employee_code
    from public.payroll_records pr
   where pr.payroll_period_id = p_period_id
  on conflict (payroll_record_id) do nothing;
  get diagnostics v_count = row_count;

  perform public.write_audit('payroll.finalized', 'payroll_period', p_period_id,
    'Payroll finalized; ' || v_count || ' payslip(s) queued for generation');
  insert into public.app_notifications(recipient_role, title, body, link)
  values ('hr_manager', 'Payroll finalized', to_char(v_period.payroll_month, 'FMMonth YYYY') || ' payroll was finalized.',
          '/payroll/' || p_period_id);

  return jsonb_build_object('payslips_queued', v_count);
end $$;

-- ---------------------------------------------------------------------
-- Payslip generation & email queue (service role only)
-- ---------------------------------------------------------------------
create or replace function public.claim_payslip_jobs(p_limit int) returns setof public.payslips
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.payslips p set locked_at = now(), generation_attempts = p.generation_attempts + 1
   where p.id in (
     select id from public.payslips
      where status in ('pending', 'failed') and generation_attempts < 5
        and (locked_at is null or locked_at < now() - interval '10 minutes')
      order by created_at
      limit p_limit
      for update skip locked)
  returning p.*;
end $$;

create or replace function public.enqueue_payslip_email(p_payslip_id uuid, p_manual boolean, p_requested_by uuid, p_subject text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_slip public.payslips%rowtype;
  v_emp public.employees%rowtype;
  v_notification uuid;
  v_status public.payroll_status;
begin
  select * into v_slip from public.payslips where id = p_payslip_id for update;
  if not found then raise exception 'Payslip not found.'; end if;
  if v_slip.status <> 'generated' then raise exception 'The payslip PDF has not been generated yet.' using errcode = 'P0001'; end if;
  select status into v_status from public.payroll_records where id = v_slip.payroll_record_id;
  if v_status <> 'finalized' then raise exception 'Payslips can only be emailed for finalized payroll.' using errcode = 'P0001'; end if;
  select * into v_emp from public.employees where id = v_slip.employee_id;
  if v_emp.email is null or v_emp.email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_emp.email_verification_status = 'invalid' then
    raise exception 'Employee % does not have a valid email address.', v_emp.employee_code using errcode = 'P0001';
  end if;
  if not p_manual and not v_emp.email_notifications_enabled then
    return null; -- employee opted out of automatic emails
  end if;
  if p_manual and exists (
       select 1 from public.email_notifications
        where payslip_id = p_payslip_id
          and (email_status in ('pending', 'queued') or (email_status = 'sent' and sent_at > now() - interval '10 minutes'))) then
    raise exception 'An email for this payslip is already in progress or was sent in the last 10 minutes.' using errcode = 'P0001';
  end if;

  insert into public.email_notifications(employee_id, payroll_record_id, payslip_id, recipient_email, email_subject,
                                         email_status, is_manual_resend, requested_by)
  values (v_slip.employee_id, v_slip.payroll_record_id, v_slip.id, lower(trim(v_emp.email)), p_subject,
          'queued', p_manual, p_requested_by)
  on conflict do nothing
  returning id into v_notification;

  if v_notification is null then return null; end if; -- automatic email already exists
  insert into public.email_queue(email_notification_id) values (v_notification);
  return v_notification;
end $$;

create or replace function public.claim_email_jobs(p_limit int, p_worker text) returns setof public.email_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.email_queue q set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = q.attempts + 1
   where q.id in (
     select id from public.email_queue
      where next_attempt_at <= now()
        and (status = 'pending' or (status = 'processing' and locked_at < now() - interval '10 minutes'))
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning q.*;
end $$;

-- ---------------------------------------------------------------------
-- First Super Admin bootstrap (run once from the SQL editor)
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(p_email text, p_full_name text default 'Super Admin') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if exists (select 1 from public.profiles where role = 'super_admin') then
    raise exception 'A Super Admin already exists. Create further users from User Management.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'No auth user with email %. Create the user in Supabase Auth first.', p_email; end if;
  insert into public.profiles(id, full_name, email, role) values (v_user, p_full_name, lower(p_email), 'super_admin')
  on conflict (id) do update set role = 'super_admin', is_active = true;
  return v_user;
end $$;

-- Privileged RPCs: never callable by anon; queue RPCs only by the service role.
revoke execute on function public.claim_payslip_jobs(int) from public, anon, authenticated;
revoke execute on function public.claim_email_jobs(int, text) from public, anon, authenticated;
revoke execute on function public.enqueue_payslip_email(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke execute on function public.bootstrap_super_admin(text, text) from public, anon, authenticated;
revoke execute on function public.mark_payroll_stale(uuid, date) from public, anon, authenticated;
revoke execute on function public.mark_payroll_stale_from(uuid, date) from public, anon, authenticated;
revoke execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb) from public, anon;
revoke execute on function public.save_payroll_calculation(uuid, bigint, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.finalize_payroll_period(uuid) from public, anon;
revoke execute on function public.submit_payroll_period(uuid) from public, anon;
revoke execute on function public.approve_payroll_period(uuid) from public, anon;
revoke execute on function public.return_payroll_to_draft(uuid, text) from public, anon;
grant execute on function public.save_payroll_calculation(uuid, bigint, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.finalize_payroll_period(uuid) to authenticated, service_role;
grant execute on function public.submit_payroll_period(uuid) to authenticated, service_role;
grant execute on function public.approve_payroll_period(uuid) to authenticated, service_role;
grant execute on function public.return_payroll_to_draft(uuid, text) to authenticated, service_role;
grant execute on function public.claim_payslip_jobs(int) to service_role;
grant execute on function public.claim_email_jobs(int, text) to service_role;
grant execute on function public.enqueue_payslip_email(uuid, boolean, uuid, text) to service_role;
grant execute on function public.bootstrap_super_admin(text, text) to service_role;

-- ##### 20260101000003_rls.sql #####
-- =====================================================================
-- Row Level Security
-- Principles:
--  * Every table has RLS enabled; anon gets nothing.
--  * Payroll results, payslips and email tables are written only by
--    SECURITY DEFINER workflow functions or the server's service role.
--  * Branch Managers never see salary figures; employees see only their own
--    finalized payroll.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'departments','branches','shifts','employees','profiles','salary_structures','salary_structure_history',
    'company_settings','payroll_settings','email_settings','working_day_allocations','attendance',
    'additional_earnings','commission_records','salary_advances','advance_repayments','employee_loans',
    'loan_repayments','manual_deductions','payroll_periods','payroll_records','payroll_earnings',
    'payroll_deductions','payslips','email_notifications','email_delivery_attempts','email_queue',
    'email_webhook_events','audit_logs','app_notifications']
  loop
    -- (not FORCE: the table owner runs the SECURITY DEFINER workflow functions and must bypass RLS)
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke execute on function public.write_audit(text, text, uuid, text, jsonb, jsonb) from authenticated;

-- Reference data -----------------------------------------------------------
create policy departments_read on public.departments for select to authenticated using (public.current_app_role() is not null);
create policy departments_write on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy branches_read on public.branches for select to authenticated using (public.current_app_role() is not null);
create policy branches_write on public.branches for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create policy shifts_read on public.shifts for select to authenticated using (public.current_app_role() is not null);
create policy shifts_write on public.shifts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles -----------------------------------------------------------------
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_manage on public.profiles for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Employees ----------------------------------------------------------------
create policy employees_admin on public.employees for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy employees_branch on public.employees for select to authenticated using (branch_id = public.current_branch_id());
create policy employees_self on public.employees for select to authenticated using (id = public.current_employee_id());

-- Salary structures (no Branch Manager access) --------------------------------
create policy salary_structures_admin on public.salary_structures for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy salary_structures_self on public.salary_structures for select to authenticated
  using (employee_id = public.current_employee_id());
create policy salary_history_admin on public.salary_structure_history for select to authenticated using (public.is_admin());

-- Settings -------------------------------------------------------------------
create policy company_settings_read on public.company_settings for select to authenticated using (public.current_app_role() is not null);
create policy company_settings_write on public.company_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy payroll_settings_read on public.payroll_settings for select to authenticated using (public.is_admin());
create policy payroll_settings_write on public.payroll_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy email_settings_read on public.email_settings for select to authenticated using (public.is_admin());
create policy email_settings_write on public.email_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Working days -----------------------------------------------------------------
create policy wda_admin on public.working_day_allocations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy wda_branch on public.working_day_allocations for select to authenticated
  using (branch_id = public.current_branch_id()
         or employee_id in (select id from public.employees where branch_id = public.current_branch_id()));

-- Attendance -------------------------------------------------------------------
create policy attendance_admin on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy attendance_branch on public.attendance for all to authenticated
  using (branch_id = public.current_branch_id())
  with check (branch_id = public.current_branch_id()
              and employee_id in (select id from public.employees where branch_id = public.current_branch_id())
              and not late_waived);  -- waivers are an admin decision
create policy attendance_self on public.attendance for select to authenticated using (employee_id = public.current_employee_id());

-- Additional earnings & commissions (Branch Managers may submit, not approve) --------
create policy ae_admin on public.additional_earnings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy ae_branch_read on public.additional_earnings for select to authenticated using (branch_id = public.current_branch_id());
create policy ae_branch_submit on public.additional_earnings for insert to authenticated
  with check (branch_id = public.current_branch_id() and approval_status = 'pending'
              and employee_id in (select id from public.employees where branch_id = public.current_branch_id()));
create policy ae_self on public.additional_earnings for select to authenticated
  using (employee_id = public.current_employee_id() and approval_status = 'approved');

create policy cr_admin on public.commission_records for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cr_branch_read on public.commission_records for select to authenticated using (branch_id = public.current_branch_id());
create policy cr_branch_submit on public.commission_records for insert to authenticated
  with check (branch_id = public.current_branch_id() and status = 'pending'
              and employee_id in (select id from public.employees where branch_id = public.current_branch_id()));
create policy cr_self on public.commission_records for select to authenticated
  using (employee_id = public.current_employee_id() and status <> 'cancelled');

-- Advances, loans, manual deductions ----------------------------------------------
create policy adv_admin on public.salary_advances for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adv_self on public.salary_advances for select to authenticated using (employee_id = public.current_employee_id());
create policy advrep_admin on public.advance_repayments for select to authenticated using (public.is_admin());
create policy advrep_self on public.advance_repayments for select to authenticated
  using (advance_id in (select id from public.salary_advances where employee_id = public.current_employee_id()));
create policy loan_admin on public.employee_loans for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy loan_self on public.employee_loans for select to authenticated using (employee_id = public.current_employee_id());
create policy loanrep_admin on public.loan_repayments for select to authenticated using (public.is_admin());
create policy loanrep_self on public.loan_repayments for select to authenticated
  using (loan_id in (select id from public.employee_loans where employee_id = public.current_employee_id()));
create policy md_admin_read on public.manual_deductions for select to authenticated using (public.is_admin());
create policy md_admin_write on public.manual_deductions for insert to authenticated
  with check (public.is_admin() and authorized_by = auth.uid());
create policy md_admin_update on public.manual_deductions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy md_admin_delete on public.manual_deductions for delete to authenticated using (public.is_admin());

-- Payroll results: read-only for clients; writes via workflow functions/service role -----
create policy periods_admin on public.payroll_periods for select to authenticated using (public.is_admin());
create policy records_admin on public.payroll_records for select to authenticated using (public.is_admin());
create policy records_self on public.payroll_records for select to authenticated
  using (employee_id = public.current_employee_id() and status = 'finalized');
create policy earnings_admin on public.payroll_earnings for select to authenticated using (public.is_admin());
create policy earnings_self on public.payroll_earnings for select to authenticated
  using (payroll_record_id in (select id from public.payroll_records
                                where employee_id = public.current_employee_id() and status = 'finalized'));
create policy deductions_admin on public.payroll_deductions for select to authenticated using (public.is_admin());
create policy deductions_self on public.payroll_deductions for select to authenticated
  using (payroll_record_id in (select id from public.payroll_records
                                where employee_id = public.current_employee_id() and status = 'finalized'));

-- Payslips & email ------------------------------------------------------------------
create policy payslips_admin on public.payslips for select to authenticated using (public.is_admin());
create policy payslips_self on public.payslips for select to authenticated
  using (employee_id = public.current_employee_id() and status = 'generated');
create policy en_admin on public.email_notifications for select to authenticated using (public.is_admin());
create policy eda_admin on public.email_delivery_attempts for select to authenticated using (public.is_admin());
create policy eq_admin on public.email_queue for select to authenticated using (public.is_admin());

-- Audit & notifications ----------------------------------------------------------------
create policy audit_read on public.audit_logs for select to authenticated using (public.is_super_admin());
create policy notifications_read on public.app_notifications for select to authenticated
  using (recipient_id = auth.uid() or recipient_role = public.current_app_role()
         or (recipient_role = 'hr_manager' and public.is_super_admin()));
create policy notifications_mark_read on public.app_notifications for update to authenticated
  using (recipient_id = auth.uid() or recipient_role = public.current_app_role()
         or (recipient_role = 'hr_manager' and public.is_super_admin()))
  with check (true);

-- ##### 20260101000004_storage_and_defaults.sql #####
-- =====================================================================
-- Private storage buckets and default settings rows
-- =====================================================================

-- Private buckets. No storage.objects policies are created, so only the
-- server (service role) can read/write; users get short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('payslips', 'payslips', false),
       ('employee-photos', 'employee-photos', false),
       ('company-assets', 'company-assets', false)
on conflict (id) do update set public = false;

insert into public.company_settings (singleton) values (true) on conflict do nothing;
insert into public.payroll_settings (singleton) values (true) on conflict do nothing;
insert into public.email_settings (singleton) values (true) on conflict do nothing;

-- ##### 20260101000005_reporting_views.sql #####
-- =====================================================================
-- Reporting views. security_invoker makes them respect the caller's RLS,
-- so a view never exposes more than the underlying tables allow.
-- =====================================================================

create or replace view public.v_payroll_monthly_branch with (security_invoker = true) as
select pr.payroll_month,
       pr.branch_id,
       pr.branch_name,
       count(*)::int                                  as employees,
       count(*) filter (where pr.status = 'finalized')::int as finalized_records,
       sum(pr.basic_salary)                           as basic_salary,
       sum(pr.bra2)                                   as bra2,
       sum(pr.bra1)                                   as bra1,
       sum(pr.performance_incentive)                  as performance_incentive,
       sum(pr.additional_working_pay)                 as additional_working_pay,
       sum(pr.total_earnings - pr.basic_salary - pr.bra2 - pr.bra1 - pr.performance_incentive) as additional_earnings,
       sum(pr.no_pay_leave)                           as no_pay_leave,
       sum(pr.late_deduction)                         as late_deduction,
       sum(pr.employee_epf)                           as employee_epf,
       sum(pr.employer_epf)                           as employer_epf,
       sum(pr.employer_etf)                           as employer_etf,
       sum(pr.total_earnings)                         as total_earnings,
       sum(pr.total_deductions)                       as total_deductions,
       sum(pr.net_salary)                             as net_salary
  from public.payroll_records pr
 group by pr.payroll_month, pr.branch_id, pr.branch_name;

create or replace view public.v_commission_monthly with (security_invoker = true) as
select payroll_month, branch_id, commission_type, status, count(*)::int as records, sum(amount) as amount
  from public.commission_records
 group by payroll_month, branch_id, commission_type, status;

create or replace view public.v_attendance_monthly with (security_invoker = true) as
select date_trunc('month', a.work_date)::date as month,
       a.employee_id,
       a.branch_id,
       count(*) filter (where a.status = 'present')::int        as present,
       count(*) filter (where a.status = 'absent')::int         as absent,
       count(*) filter (where a.status = 'no_pay_leave')::int   as no_pay_leave,
       count(*) filter (where a.status = 'approved_leave')::int as approved_leave,
       count(*) filter (where a.status = 'weekly_off')::int     as weekly_off,
       count(*) filter (where a.status = 'public_holiday')::int as public_holiday,
       count(*) filter (where a.status = 'present' and a.late_minutes > 0 and not a.late_waived)::int as late_count,
       coalesce(sum(a.late_minutes) filter (where a.status = 'present'), 0)::int as late_minutes,
       count(*) filter (where a.is_additional_working_day)::int as flagged_additional_days,
       count(*)::int as recorded_days
  from public.attendance a
 group by 1, 2, 3;

grant select on public.v_payroll_monthly_branch, public.v_commission_monthly, public.v_attendance_monthly to authenticated;

-- =====================================================================
-- DONE. Next: create your login in Authentication → Users → Add user
-- (tick "Auto confirm"), then run in a NEW query:
--   select public.bootstrap_super_admin('your@email.com', 'Your Name');
-- =====================================================================
