-- =====================================================================
-- FICTIONAL TEST DATA — for a staging/test project only. Never run in production.
-- Creates one branch, one shift and the specification's sample employee
-- (Basic 40,000 · BRA 2 5,000 · BRA 1 3,000 · Performance Incentive 2,000)
-- with 27 present days in January 2026 (2 additional working days).
-- =====================================================================
do $$
declare b uuid; s uuid; e uuid; d date;
begin
  insert into public.branches(name, code, allocated_working_days) values ('Test Branch', 'TEST', 25) returning id into b;
  insert into public.shifts(name, branch_id, start_time, end_time) values ('Day', b, '09:00', '18:00') returning id into s;
  update public.branches set default_shift_id = s where id = b;
  insert into public.employees(full_name, email, designation, epf_number, branch_id, shift_id, employment_start_date)
  values ('Test Employee (fictional)', 'test.employee@example.com', 'Sales Executive', 'TEST-EPF-1', b, s, '2025-01-01') returning id into e;
  insert into public.salary_structures(employee_id, basic_salary, bra2, bra1, performance_incentive, effective_from)
  values (e, 40000, 5000, 3000, 2000, '2025-01-01');
  for i in 1..27 loop
    d := make_date(2026, 1, i);
    insert into public.attendance(employee_id, branch_id, work_date, shift_start_time, check_in_time, check_out_time, status)
    values (e, b, d, '09:00', case when i = 3 then '09:10'::time when i = 4 then '09:20'::time else '08:55'::time end, '18:00', 'present');
  end loop;
end $$;
-- Expected after processing January 2026 payroll:
--   EPF basis 48,000 · EPF 8% 3,840 · Daily basis 48,000 · Daily rate 1,920
--   Additional working pay 3,840 (27 vs 25 days) · Late 750 (250 + 500)
--   Total earnings 53,840 · Total deductions 4,590 · Net 49,250
