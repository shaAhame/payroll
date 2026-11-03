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
