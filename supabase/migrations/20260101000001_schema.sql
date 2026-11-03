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
