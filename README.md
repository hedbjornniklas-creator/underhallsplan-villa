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
- `/mina-uppdrag/aktivera/[token]`: Single-use account activation for a new
  task recipient.
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
   `docs/db/2026-08-27_02_task_reminder_schedule_and_supabase_cron.sql`.
4. In Supabase Authentication > URL Configuration, set the production Site URL
   to `https://hushub.se` and add the exact Redirect URL
   `https://hushub.se/mina-uppdrag/logga-in` for password recovery. Add the
   equivalent localhost URL separately when testing recovery locally.
5. Set `APP_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
   `ASSIGNMENTS_MAIL_FROM`, `OPENAI_API_KEY` and `CRON_SECRET` in the server
   environment.
6. For WhatsApp, also set `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`,
   `WHATSAPP_ASSIGNMENT_TEMPLATE_NAME`,
   `WHATSAPP_PORTAL_REMINDER_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` and
   `WHATSAPP_API_VERSION`. The general template expects recipient name, task
   title and due date. Assignment and portal-reminder templates also expect a
   fourth parameter containing the personal access or authenticated portal
   URL. All Meta templates must be approved before automated messages can be
   delivered.
7. Add the production follow-up endpoint and the same `CRON_SECRET` to
   Supabase Vault, then validate the central five-minute Supabase Cron job as
   described in `docs/TASK_REMINDER_CRON_OPERATIONS.md`. Do this after the
   production deployment so the app already understands the new timezone
   columns.

Task state changes also trigger a small opportunistic worker batch. The cron
job is still required as the durable retry path when no user request occurs.
Automatic task communication is held outside each organization's configured
local send window; the default is 07:00-20:00 in `Europe/Stockholm`.
New external recipients receive their first account activation by email.
Personal `/signe` links still open the exact linked task without login, while
the collected `/mina-uppdrag` overview requires the recipient's email/password
session after activation.
