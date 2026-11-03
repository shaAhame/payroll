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
