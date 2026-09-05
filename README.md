# underhallsplan-villa
Digital Next.js + Supabase platform for property inspections and maintenance planning.

## Stack
- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- Supabase (Auth, Postgres, Storage)

## Local Development
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Current Route Map (2026-08-22)
- `/login`: Auth page. Redirects authenticated users to `/dashboard-v1`.
- `/dashboard-v1`: Operational dashboard v1 (module overview, no sidebar shell).
- `/ob`: Module home for Overlatelsebesiktning (no sidebar shell).
- `/eb`: Module home for Entreprenadbesiktning.
- `/tu`: Module home for Tekniska utredningar.
- `/uppdrag`: Mobile-first task ownership, follow-up and approval module.
- `/signe/[token]`: Personal external recipient view for a task branch.
- `/mina-uppdrag`: Authenticated recipient overview across organizations.
- `/mina-uppdrag/aktivera/[token]`: Legacy single-use account activation kept
  for links that have already been delivered.
- `/inspections`: Global inspections list in dashboard shell (no sidebar).
- `/properties`: Property-centric flow and links into the inspection wizard.
- `/settings`: Profile/business card and admin configuration pages.
- `/utlatande/[propertyId]/[inspectionId]`: Report preview/print route.

## Layout Shells
- `src/app/(app)/layout.tsx`: Standard shell with sidebar + topbar.
- `src/app/(dashboard)/layout.tsx`: Calm topbar-only shell for module entry pages.
- `src/app/(auth)/layout.tsx`: Auth shell.

## Key Docs
- `docs/CHANGELOG.md`
- `docs/TECH_OVERVIEW.md`
- `docs/UI_FEEDBACK_STANDARD.md`
- `docs/SUPABASE_SCHEMA.md`

## Report PDF worker deployment

EB, TU and ÖB use the same durable PDF queue. Deploy the application first,
then apply `docs/db/2026-09-05_01_inspection_report_pdf_job_queue.sql` to
Supabase, followed by
`docs/db/2026-09-05_02_inspection_report_pdf_cron_request_id_fix.sql`. The
migrations reuse the existing Uppdrag Cron endpoint origin and
`CRON_SECRET` from Vault when those values are present, and activate the
one-minute report worker automatically.

If Uppdrag Cron has not been configured, add
`hushub_report_pdf_endpoint_url` (ending in `/api/cron/reports/pdf`) and
`hushub_report_pdf_cron_secret` (the same value as the application's
`CRON_SECRET`) to Supabase Vault. Then call
`public.configure_inspection_report_pdf_cron()` once and verify
`public.inspection_report_pdf_cron_configuration_status()`.

`APP_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` must be available
to the server. `REPORT_RENDER_SECRET` is optional; when omitted, the internal,
short-lived render authorization is derived from the service-role secret.
`APP_BASE_URL` must use HTTPS in production. Report assets are restricted to
the application and its configured Supabase origin; any intentional legacy
asset origin must be added explicitly as an HTTPS origin in the comma-separated
`REPORT_PDF_ALLOWED_ASSET_ORIGINS` value.

The timeout budget is deliberately bounded below the external dispatcher and
route limits. `REPORT_PDF_RENDER_TIMEOUT_MS` defaults to 60000 and is clamped
to 10000-150000 ms. Chromium lookup and launch are clamped to at most 30000 and
25000 ms respectively, so browser setup plus rendering takes at most 205 seconds;
the Supabase `pg_net` request expires after 280 seconds and the application
route after 300 seconds. `REPORT_PDF_STALE_AFTER_MINUTES` defaults to 10 and is
clamped to 6-1440 minutes, ensuring an active route is not reclaimed early.
`REPORT_READY_TIMEOUT_MS` (5000-150000 ms) and
`REPORT_NETWORK_IDLE_TIMEOUT_MS` (1000-15000 ms) run inside the render budget.

Cron execution is asynchronous: a successful `cron.job_run_details` row only
means that `pg_net` accepted the request. Verify the actual application response
without exposing endpoint URLs or credentials:

```sql
select public.inspection_report_pdf_cron_configuration_status();
```

`latestRequestedHttpOutcome` describes the newest queued request and will often
be `pending` while it is running. It never hides the previous result:
`latestCompletedHttpOutcome` and `latestCompletedHttpStatusCode` always describe
the newest request for which `pg_net` has stored a response. Values
`timed_out`, `network_error` or `http_error` require checking the remaining
non-secret status fields and the application logs; `succeeded` together with
HTTP 200 confirms successful dispatch.

## Uppdrag v1 deployment

1. Apply `docs/db/2026-08-20_00_platform_access_assignments_rls.sql` to
   Supabase. Run it separately so its short exclusive table lock is released
   before the main migration starts.
2. Apply `docs/db/2026-08-20_01_operational_tasks_foundation.sql` to Supabase.
3. Apply the remaining Uppdrag migrations in filename order:
   `docs/db/2026-08-20_02_operational_task_initial_attachments.sql`,
   `docs/db/2026-08-22_01_task_recipient_portal_identity.sql`,
   `docs/db/2026-08-24_01_operational_task_archiving.sql`,
   `docs/db/2026-08-24_02_operational_task_evidence_checklist.sql`,
   `docs/db/2026-08-25_01_task_bearer_links_concurrency.sql`,
   `docs/db/2026-08-26_01_task_recipient_action_roles.sql`,
   `docs/db/2026-08-27_01_task_conversation_reads.sql` and
   `docs/db/2026-08-27_02_task_reminder_schedule_and_supabase_cron.sql`,
   then `docs/db/2026-08-27_03_task_email_pdf_analysis_rate_limit.sql`.
4. Before deploying this application version, apply
   `docs/db/2026-08-27_05_task_assistant_gizmo_branding.sql` and then
   `docs/db/2026-08-27_06_task_recurrence.sql`. Before deploying the recipient
   first-login flow, also apply
   `docs/db/2026-08-28_01_task_recipient_first_login_code.sql`. Migration 04 is
   deliberately skipped here and applied only after the compatible worker is
   live. Migrations 06 and 2026-08-28_01 must already exist when the matching
   application code starts serving task and recipient-account requests.
5. In Supabase Authentication > URL Configuration, set the production Site URL
   to `https://hushub.se` and add the exact Redirect URL
   `https://hushub.se/mina-uppdrag/logga-in` for password recovery. Add the
   equivalent localhost URL separately when testing recovery locally.
6. Set `APP_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
   `ASSIGNMENTS_MAIL_FROM`, `OPENAI_API_KEY` and `CRON_SECRET` in the server
   environment.
7. For WhatsApp, also set `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`,
   `WHATSAPP_ASSIGNMENT_TEMPLATE_NAME`,
   `WHATSAPP_PORTAL_REMINDER_TEMPLATE_NAME`,
   `WHATSAPP_TASK_EVENT_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` and
   `WHATSAPP_API_VERSION`. The general template expects recipient name, task
   title and due date. Assignment and portal-reminder templates also expect a
   fourth parameter containing the personal access or authenticated portal
   URL. The task-event template expects, in order: recipient name, actor name,
   event heading, task title and task URL. Free-form comments and reasons are
    never passed as WhatsApp template parameters. All Meta templates must be
    approved before automated messages can be delivered. When the task-event
    template is missing, WhatsApp fails closed and the task's configured
    fallback channel is used. Approved and cancelled tasks use an exact-task,
    read-only `/signe` link; they never mint a new legacy activation URL. Keep
    the task-event template unset until HusHub has an auditable, per-person
    WhatsApp opt-in for every affected recipient. A stored phone number or a
    task created by somebody else is not consent to automated WhatsApp messages.
8. Deploy the application version that supports `send_message` automation
    jobs. Wait until all old instances and in-flight requests have drained and
    verify that only the compatible worker version is running. Only then apply
    `docs/db/2026-08-27_04_task_event_notifications.sql`. Migration 04 enables
   the event trigger immediately; applying it before the compatible worker is
   deployed can dead-letter new notification jobs.
9. Add the production follow-up endpoint and the same `CRON_SECRET` to
   Supabase Vault, then validate the central five-minute Supabase Cron job as
   described in `docs/TASK_REMINDER_CRON_OPERATIONS.md`. Do this after the
   production deployment so the app already understands the new timezone
   columns.

Do not roll the application back to a worker that only understands
`evaluate_followup` while migration 04 is active. Pause the Cron dispatcher and
the task-event notification trigger first, or ship a forward fix; otherwise
new `send_message` jobs will be claimed and dead-lettered by the old worker.

Task state changes also trigger a small opportunistic worker batch. The cron
job is still required as the durable retry path when no user request occurs.
Automatic reminder communication is held outside each organization's
configured local send window; the default is 07:00-20:00 in
`Europe/Stockholm`. Human-triggered task events use the same durable queue but
are eligible immediately and do not wait for the reminder cadence or send
window.
New external recipients receive one personal `/signe` link that opens only the
linked task and does not require login. From that task, **Mina uppdrag** starts
first login: HusHub sends a six-digit code to the recipient's stored email and,
after verification, lets the recipient choose a password. Existing
`/mina-uppdrag/aktivera/[token]` links remain valid for already delivered
messages, but new task notifications do not issue a separate activation link.
The collected `/mina-uppdrag` overview still requires the recipient's
email/password session.
