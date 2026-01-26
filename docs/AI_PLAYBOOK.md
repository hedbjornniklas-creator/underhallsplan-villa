# AI Playbook (Codex)

## Källor som alltid gäller
1) Översikt: docs/TECH_OVERVIEW.md
2) Databasschema (mänskligt): docs/SUPABASE_SCHEMA.md
3) Databastyper (sanning): src/types/supabase.ts

## Regler
- Gissa aldrig tabell- eller kolumnnamn.
- Om docs och typer skiljer sig: src/types/supabase.ts gäller.
- Föreslå alltid vilka filer som ska ändras innan du gör stora ändringar.
- Lista alltid vilka filer du ändrat + hur man testar lokalt.

## Utlatande / report (print)
- Source of truth: src/app/utlatande/[propertyId]/[inspectionId]/page.tsx (data mapping).
- Layout: src/components/report/ReportRenderer.tsx (server wrapper) + src/components/report/ReportRendererClient.tsx (client-side paginering/TOC) + src/lib/report/reportSpec.ts.
- Print CSS: src/app/globals.css (A4 sizing, report-page/report-root classes).
