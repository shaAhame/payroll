-- =====================================================================
-- Run the payslip/email background worker every 5 minutes from Supabase.
-- Needed on Vercel Hobby, which only allows a daily Vercel Cron.
--
-- Hobby-friendly: Postgres only calls your app when there is actually work
-- (pending payslips or due emails), so idle months cost no function time.
--
-- Run once in the Supabase SQL editor AFTER deploying, replacing:
--   https://YOUR-APP.vercel.app   -> your production URL
--   YOUR_CRON_SECRET              -> the CRON_SECRET set in Vercel
-- To check runs:  select * from cron.job_run_details order by start_time desc limit 20;
-- To remove:      select cron.unschedule('payroll-worker');
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'payroll-worker',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/process-jobs',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 290000
  )
  where exists (select 1 from public.payslips
                 where status in ('pending', 'failed') and generation_attempts < 5)
     or exists (select 1 from public.email_queue
                 where status in ('pending', 'processing') and next_attempt_at <= now());
  $$
);
