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

## Current Route Map (2026-02-15)
- `/login`: Auth page. Redirects authenticated users to `/dashboard-v1`.
- `/dashboard-v1`: Operational dashboard v1 (module overview, no sidebar shell).
- `/ob`: Module home for Overlatelsebesiktning (no sidebar shell).
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
