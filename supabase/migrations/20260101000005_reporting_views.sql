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
