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
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
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
