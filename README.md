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

## Current Route Map (2026-08-20)
- `/login`: Auth page. Redirects authenticated users to `/dashboard-v1`.
- `/dashboard-v1`: Operational dashboard v1 (module overview, no sidebar shell).
- `/ob`: Module home for Overlatelsebesiktning (no sidebar shell).
- `/eb`: Module home for Entreprenadbesiktning.
- `/tu`: Module home for Tekniska utredningar.
- `/uppdrag`: Mobile-first task ownership, follow-up and approval module.
- `/signe/[token]`: Personal external recipient view for a task branch.
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
- `docs/SUPABASE_SCHEMA.md`

## Uppdrag v1 deployment

1. Apply `docs/db/2026-08-20_00_platform_access_assignments_rls.sql` to
   Supabase. Run it separately so its short exclusive table lock is released
   before the main migration starts.
2. Apply `docs/db/2026-08-20_01_operational_tasks_foundation.sql` to Supabase.
3. Set `APP_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
   `ASSIGNMENTS_MAIL_FROM`, `OPENAI_API_KEY` and `CRON_SECRET` in the server
   environment.
4. For WhatsApp, also set `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`,
   `WHATSAPP_ASSIGNMENT_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` and
   `WHATSAPP_API_VERSION`. The general template expects the reminder fields;
   the assignment template expects recipient name, task title, due date and
   personal access URL. Both Meta templates must be approved before automated
   messages can be delivered.
5. `vercel.json` runs the durable follow-up worker daily so Hobby deployments
   remain valid. On Vercel Pro the schedule can be changed to `*/15 * * * *`
   for fifteen-minute follow-up resolution.

Task state changes also trigger a small opportunistic worker batch. The cron
job is still required as the durable retry path when no user request occurs.
