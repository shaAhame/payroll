# Employee Payroll Management System

A multi-branch payroll application for a retail company: employees, effective-dated salary structures,
attendance, working-day allocation, commissions, advances and loans, a central payroll engine, an approval
workflow, PDF payslips, and automated payslip email delivery through Brevo.

**Stack:** Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS v4 · shadcn-style
components (Radix + Lucide) · React Hook Form + Zod · Recharts · ExcelJS · pdf-lib · Supabase (Postgres, Auth,
RLS, Storage) · Brevo Transactional API · Vercel.

---

## Contents

1. [How payroll is calculated](#1-how-payroll-is-calculated)
2. [Configurable rules and their defaults](#2-configurable-rules-and-their-defaults)
3. [Architecture](#3-architecture)
4. [Deployment, step by step](#4-deployment-step-by-step)
5. [Testing](#5-testing)
6. [Security model](#6-security-model)
7. [Project structure](#7-project-structure)
8. [Operational notes and limitations](#8-operational-notes-and-limitations)

---

## 1. How payroll is calculated

All salary figures are produced by one server-side engine, `src/lib/payroll/engine.ts`, using
`decimal.js` (no floating-point money). Results are stored in PostgreSQL `NUMERIC` columns.

| Rule | Formula |
|---|---|
| EPF Salary Basis | Basic Salary + BRA 2 + BRA 1 (Performance Incentive is **never** included) |
| Employee EPF | EPF Salary Basis × 8% |
| Daily Salary Basis | Basic Salary + BRA 2 + BRA 1 + Performance Incentive |
| Daily Salary Rate | Daily Salary Basis ÷ Allocated Working Days |
| Additional Working Days | max(0, Actual − Allocated) → × Daily Rate = Additional Working Pay (earning) |
| Additional Off Days | max(0, Allocated − Actual) → × Daily Rate = No-Pay Leave (deduction) |
| Late arrivals | 1–15 min → LKR 250 · >15 min → LKR 500, per incident; waived incidents not charged |
| Total Earnings | Basic + BRA 2 + BRA 1 + Performance Incentive + Additional Working Pay + Sales / Pre-Owned / Company Device / Repair Commission + Other Approved Earnings |
| Total Deductions | No-Pay Leave + commission releases (Sales / Used / Repair / Company Device) + Employee EPF + Late Arrivals + Salary Advances + Loan Repayment + Other Authorized Deductions |
| Net Salary | Total Earnings − Total Deductions |

Guarantees enforced in code and in the database:

- Performance Incentive appears once in Total Earnings, even though it is part of the daily basis.
- Additional working pay and no-pay leave are the *same* monthly adjustment — the database rejects a record that has both.
- A "No-Pay Leave" attendance status only reduces actual days; it is never deducted a second time.
- Employer EPF (12%) and ETF (3%) are calculated and reported but never deducted from the employee.
- Loan/advance instalments never exceed the outstanding balance; balances change only on finalization.
- A commission is deducted only when it was paid in an earlier payroll **and** later released separately.

Named engine functions: `calculateEPFSalary`, `calculateEmployeeEPF`, `calculateDailySalaryBasis`,
`calculateDailySalaryRate`, `calculateAdditionalWorkingPay`, `calculateNoPayLeave`, `calculateLateDeduction`,
`calculateTotalEarnings`, `calculateTotalDeductions`, `calculateNetSalary` (plus `calculatePayroll`, which
combines them for one employee-month).

**Specification test case** (`tests/engine.test.ts`): Basic 40,000 · BRA 2 5,000 · BRA 1 3,000 · Performance
Incentive 2,000 · 25 allocated days → EPF basis 48,000 · EPF 3,840 · Daily basis 50,000 · Daily rate 2,000 ·
27 days → +4,000 · 23 days → −4,000 · 25 days → no adjustment. All pass.

## 2. Configurable rules and their defaults

Where the specification left a rule open, it is a setting (Payroll Settings page) with a documented default,
rather than an invented policy. Changing a setting recalculates open payroll; finalized payroll never changes.

| Setting | Default | Notes |
|---|---|---|
| Allocated working days | 25 | Priority: employee allocation for the month → branch allocation for the month → branch default → company default |
| Daily salary divisor | Allocated working days | Alternatives: calendar days, fixed divisor |
| Rounding | Final amounts only | Daily rate kept at full precision; amounts rounded half-up to 2 dp. Optional: round the rate first |
| Approved leave | Paid (counts as worked) | Or unpaid |
| Weekly off / public holiday | Neutral (not counted) | Allocations are expected to exclude offs and holidays. Working on an off day = a present day, so it becomes an additional working day |
| Monthly incentive records | Added to the structure's incentive | Or replace it. Both feed the daily basis, never EPF |
| Late deduction | 250 / 500, threshold 15 min, grace 0 | Frequency per incident (default) or once per month; optional monthly cap |
| Additional-day / no-pay multipliers | 1 × daily rate | |
| EPF / employer EPF / ETF | 8% / 12% / 3% | |
| Approval | Required before finalization | Optional: approver must differ from submitter |
| Salary structure for a month | The structure in force on the **last day** of the payroll month | Mid-month changes are not pro-rated |
| Joiners / leavers | Not pro-rated automatically | Set an employee-specific allocation for the month |
| Negative net salary | Blocks finalization | Reduce or pause a loan/advance instalment for the month |
| No attendance for an employee | Blocks finalization | Record the absences explicitly |

## 3. Architecture

```
Browser ──► Next.js (Vercel)
             ├─ Server Components: read through Supabase with the user's session (RLS applies)
             ├─ Server Actions: validate (Zod) → check role → write → recalculate → audit log
             ├─ Payroll engine (pure TS, decimal-safe) ──► save_payroll_calculation() RPC (atomic)
             ├─ /api/cron/process-jobs  ◄── Vercel Cron / Supabase pg_cron (every 5 min)
             │     ├─ payslip jobs: render PDF (pdf-lib) → private bucket "payslips"
             │     └─ email queue: claim (SKIP LOCKED) → Brevo API → record attempt
             └─ /api/webhooks/brevo ◄── Brevo delivery events (delivered / bounced / …)
Supabase Postgres: tables, constraints, RLS, workflow functions, immutability triggers
```

**Payroll workflow.** Draft → Pending Approval → Approved → Finalized.

1. *Process payroll* creates a period (month + branch or all) and one record per active employee, then calculates each.
2. Any change to an input (attendance, salary structure, allocation, earnings, commissions, deductions, advances, loans, settings) flags the affected open record via database triggers **and** the server action recalculates it immediately. A version counter prevents a concurrent edit from being lost.
3. Submitting recalculates anything stale first; issues (no salary structure, no attendance, negative net, stale) block submission.
4. Approval (Super Admin). A value-changing recalculation after submission returns the payroll to draft.
5. Finalization runs in **one database transaction** (`finalize_payroll_period`): re-checks issues, posts loan and advance repayments (rejecting any that exceed the balance), marks commissions paid, marks releases recovered, marks earnings/deductions processed, locks records and creates payslip jobs.
6. The worker renders PDFs, stores them privately, and (if enabled) queues one email per employee. Corrections afterwards are made with **authorized adjustments** (arrears or recovery in a later month, linked to the original record) — finalized rows are immutable at the database level.

**Email delivery.** Persistent queue in Supabase (`email_queue`), claimed with `FOR UPDATE SKIP LOCKED`,
stale locks recovered after 10 minutes, exponential back-off (1, 5, 15, 60, 180, 360 min) for temporary errors,
permanent failure for invalid requests, and a hard stop on resending once Brevo has returned a message id.
"Sent" means accepted by Brevo; only the webhook sets "Delivered". Hard bounces mark the employee's address invalid.
One automatic notification per payslip is enforced by a unique index; manual resends require confirmation and are
refused while one is in flight or was sent in the last 10 minutes.

## 4. Deployment, step by step

### 4.1 Create the Supabase project
1. Create a project at supabase.com in the **South Asia (Mumbai)** region. Vercel functions are pinned to Mumbai (`bom1`) in `vercel.json`, so app and database sit in the same city. If you choose another Supabase region, change `regions` in `vercel.json` to match.
2. *Project Settings → API*: copy the **Project URL**, **anon key** and **service_role key**.

### 4.2 Run the database migrations
Either with the Supabase CLI:
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
or paste each file from `supabase/migrations/` into the SQL editor **in filename order**:
`…01_schema.sql`, `…02_functions.sql`, `…03_rls.sql`, `…04_storage_and_defaults.sql`, `…05_reporting_views.sql`.

### 4.3 Configure Supabase Authentication
- *Authentication → Sign In / Providers*: keep **Email** enabled; **disable "Allow new users to sign up"** (users are invited by a Super Admin).
- *Authentication → URL Configuration*: Site URL = your production URL; add `https://<your-domain>/auth/callback` to Redirect URLs (and `http://localhost:3000/auth/callback` for local development).
- Optional but recommended: configure custom SMTP for Supabase's own auth emails (you can use Brevo SMTP).

### 4.4 Create the first Super Admin
1. *Authentication → Users → Add user → Create new user* with your email and a strong password (tick "Auto confirm").
2. In the SQL editor:
```sql
select public.bootstrap_super_admin('you@company.lk', 'Your Name');
```
This works only while no Super Admin exists. Further users are invited from **User Management**.

### 4.5 Private payslip storage
Migration `…04` creates the private buckets `payslips`, `employee-photos` and `company-assets`. Confirm under
*Storage* that all three show as **Private**. No storage policies are created on purpose: only the server
(service role) reads or writes, and users receive 60-second signed URLs after an RLS-checked lookup.

### 4.6 Configure Brevo
1. Create a Brevo account → *SMTP & API → API Keys* → generate a key (`BREVO_API_KEY`).
2. Check your plan's daily sending quota covers one email per employee per month (plus resends), and set the
   **batch size** in Email Settings accordingly.

### 4.7 Verify the sender email / domain
*Brevo → Senders, Domains & Dedicated IPs*: add your company sender (e.g. `payroll@yourcompany.lk`), then
authenticate the domain (DKIM and DMARC records in your DNS). Use that address as `BREVO_SENDER_EMAIL`.

### 4.8 Configure Brevo transactional webhooks
*Brevo → Transactional → Settings → Webhooks → Add a new webhook*:
- URL: `https://<your-domain>/api/webhooks/brevo?token=<BREVO_WEBHOOK_SECRET>`
- Events: Sent, Delivered, Soft bounce, Hard bounce, Invalid email, Blocked, Error (opens/clicks optional).

### 4.9 Environment variables (Vercel → Project → Settings → Environment Variables)
| Variable | Value | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | yes (public by design) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | yes (public by design, protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key | **no** |
| `BREVO_API_KEY` | Brevo API key | **no** |
| `BREVO_SENDER_EMAIL` | verified sender | no |
| `BREVO_SENDER_NAME` | e.g. `HR & Payroll` | no |
| `BREVO_WEBHOOK_SECRET` | long random string (`openssl rand -hex 32`) | no |
| `CRON_SECRET` | long random string | no |
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` | yes |

Copy `.env.example` to `.env.local` for local development. Never commit real values (`.env*` is git-ignored).

### 4.10 Connect GitHub
```bash
git init && git add . && git commit -m "Payroll system"
git branch -M main
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin main
```
In Vercel: *Add New → Project → Import* the repository (framework: Next.js; no build overrides needed).

### 4.11 Deploy
Vercel builds on every push to `main`. Payroll and job routes declare `maxDuration` up to 300 s, which is the
Hobby maximum, so the project deploys unchanged on Hobby.

**Background worker on Vercel Hobby (required step).** Hobby only allows cron jobs that run once a day, so
`vercel.json` registers a **daily** run (02:00 UTC, ±59 min) as a safety net. For payslips and emails to go out
within minutes, run `supabase/optional/schedule-worker.sql` once in the Supabase SQL editor after the first
deploy (replace the URL and `CRON_SECRET`). It uses Supabase `pg_cron` + `pg_net` to call the worker every
5 minutes, **but only when there is pending work**, so it costs no Vercel function time in quiet periods.
Finalizing payroll and manual resends also process a first batch immediately, so small payrolls usually finish
right away. On Vercel Pro you could instead change the `vercel.json` schedule to `*/5 * * * *`.

**Hobby limits to keep in mind**
- Runtime logs are kept for 1 hour — check *Email Notifications* in the app (attempts and errors are stored in the database) rather than Vercel logs.
- Monthly included usage (e.g. 4 active-CPU hours, 1M invocations) is ample for a monthly payroll of a few hundred employees; if exceeded, Hobby features pause until the 30-day window resets.
- Vercel's fair use guidelines restrict Hobby to non-commercial, personal use. A company payroll system is commercial use, so plan to move the project to Pro before relying on it in production.

### 4.12 Production domain
*Vercel → Project → Settings → Domains* → add your domain and DNS records. Then update
`NEXT_PUBLIC_APP_URL`, the Supabase Site URL/Redirect URLs, the Brevo webhook URL and (if used) the pg_cron URL.

### 4.13 Test automated payslip delivery (on a staging project first)
1. Run `supabase/optional/fictional-test-data.sql` on a **staging** project only (creates a fictional branch and employee — change the email to an inbox you own).
2. Settings: set company details and logo; in Email Settings check "API status: Connected" and send a **test email**.
3. Payroll → *Process payroll* for January 2026 → open the employee → confirm: EPF basis 48,000; EPF 3,840; daily basis 50,000; additional working pay 4,000; late 750; net 49,410.
4. Submit → Approve → Finalize. The payslip appears under *Payslips*; the email appears under *Email Notifications* as **Sent**, then **Delivered** once Brevo's webhook arrives.
5. Try *Resend* (confirmation; refused within 10 minutes of the last send) and the employee portal (invite the employee as an Employee user).

## 5. Testing

```bash
npm install
npm test            # all tests
npm run test:engine # payroll engine unit tests (26)
npm run test:db     # migrations + workflow on in-memory Postgres (PGlite) (28)
npm run typecheck
npm run build
```

`tests/db/workflow.test.ts` applies the real migrations to an in-memory PostgreSQL (PGlite, with minimal
stand-ins for Supabase's `auth`/`storage` schemas) and drives the engine through calculation, stale detection,
submission, approval rules, finalization side effects (loans, advances, commissions, payslips), immutability,
commission release rules, email queue idempotency and Row Level Security per role.

## 6. Security model

- **Authentication**: Supabase Auth, cookie sessions refreshed by middleware; public sign-up disabled; users invited by a Super Admin; deactivated users are banned at the auth layer.
- **Authorization**: every server action and route checks the role (`requireRole`); every query also runs through **RLS**:
  - Super Admin / HR: all operational data; only Super Admin approves/finalizes payroll and changes settings, users, branches and Brevo settings.
  - Branch Manager: their branch's employees and attendance; can submit commissions/earnings only as *pending*; **no** salary, payroll or payslip data.
  - Employee: only their own profile, finalized payroll, payslips and attendance.
- **Payroll tables are not client-writable**: results are written only through `SECURITY DEFINER` workflow functions (which check the role) or the server's service role.
- **Finalized payroll is immutable** via triggers (records, lines, periods, attendance of finalized months, salary structures used by finalized payroll, paid commissions/earnings/deductions).
- **Secrets**: service-role and Brevo keys are read only in `server-only` modules; nothing sensitive uses a `NEXT_PUBLIC_` variable.
- **Files**: private buckets, 60-second signed URLs, issued only after an RLS-checked lookup. Uploads are type- and size-checked.
- **Emails**: one employee per email, only their own PDF; no salary data in logs (attempt rows store status and error text only).
- **Audit trail**: `audit_logs` records manual changes, approvals, finalizations, adjustments, exports, resends; salary-structure history is captured by trigger.
- **Exports**: CSV cells are neutralised against spreadsheet formula injection.
- **Webhook / cron endpoints**: constant-time secret comparison.

Rate limiting: Supabase Auth rate-limits sign-in; for additional protection of API routes, enable Vercel's
Firewall/WAF rate-limit rules on `/api/*` (configured in the Vercel dashboard, not in code).

## 7. Project structure

```
supabase/migrations/          schema, functions/triggers, RLS, storage & defaults, reporting views
supabase/optional/            pg_cron worker schedule · fictional staging data
src/lib/payroll/engine.ts     central calculation engine (pure, decimal-safe)
src/lib/payroll/service.ts    loads inputs in bulk, runs the engine, persists atomically
src/lib/jobs/runner.ts        payslip generation + Brevo email queue worker
src/lib/payslip/              PDF rendering and data loading
src/lib/email/                Brevo client and email template
src/lib/reports/              15 required reports + payroll register, Excel/CSV/PDF export
src/app/(app)/                staff application (dashboard, employees, payroll, attendance, …)
src/app/portal/               employee self-service portal
src/app/api/                  cron worker, Brevo webhook, payslip downloads, report exports, import template
tests/                        engine unit tests and database workflow tests
```

## 8. Operational notes and limitations

- **What was verified here**: TypeScript compiles, ESLint is clean, `next build` succeeds, 54 automated tests pass (engine + migrations/workflow/RLS on PGlite), and payslip/report PDFs and Excel exports render. The UI and the Supabase/Brevo integrations have **not** been exercised against a live Supabase project or a live Brevo account from this environment — run step 4.13 on staging before go-live.
- **Brevo idempotency**: each send carries the notification id; the worker never re-sends a notification that has a Brevo message id. If a worker is cut off *after* Brevo accepts but *before* the database write, the lock expires and the email can be sent a second time. This window is small but not zero.
- **Large payrolls**: calculation loads inputs set-wise and saves with bounded concurrency; a few hundred employees per run is comfortable within 300 s. For thousands, process payroll per branch.
- **Statutory compliance**: EPF/ETF rates are configurable and default to 8% / 12% / 3%. PAYE/APIT tax is not part of the specification and is not calculated — add it as a deduction category if required.
- **Backups**: enable Supabase Point-in-Time Recovery for production payroll data.
