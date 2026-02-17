# Changelog

## 2026-02-15

### Major changes
- **Dashboard/module entry flow (no sidebar shell)**
  - Added route group `src/app/(dashboard)` with a calm topbar-only layout.
  - Added `src/app/(dashboard)/dashboard-v1/page.tsx` as v1 operational module overview.
  - Added `src/app/(dashboard)/ob/page.tsx` as module home for Overlatelsebesiktning.

- **Login redirect update**
  - `src/app/(auth)/login/page.tsx` now redirects authenticated users to `/dashboard-v1` on load and on auth state changes.

- **`/dashboard-v1` navigation updates**
  - Primary action `Oppna modul` leads to `/inspections`.
  - Secondary action `Visa alla besiktningar` leads to `/ob`.

- **Overlatelsebesiktning module page (`/ob`)**
  - Card 1 now lists the logged-in user's latest inspections (address, customer, status).
  - Sorting: `inspections.date DESC`, then `created_at DESC`.
  - Rows are clickable and open `/properties/[propertyId]/ob/[inspectionId]`.
  - Added card 2: `Skapa ny besiktning`.
  - Added card 3: `Min information` mini business card with link to `/settings`.

- **Profile image/logo rendering hardening**
  - `src/app/(dashboard)/ob/page.tsx` and `src/app/(app)/settings/page.tsx` now resolve Supabase media URLs robustly (absolute URL, `/storage/...`, `storage/...`, and bucket-relative paths).
  - Replaced fragile image rendering with `<img>` + graceful fallback on load error.
## 2026-02-12

### Major changes
- **Report PDF stability fixes (preview -> PDF V.2)**
  - Pagination safety margin in `ReportRendererClient.tsx`
  - Skip spacer-only pages to avoid blank output
  - Appendix 3 pagination + appendix safety margin
  - Print CSS adjustments in `globals.css` (no silent clipping; allow block/image breaks)

- **Interior rooms: edit floor**
  - Added plan selection in "Redigera rum" with safe reordering
  - System room "Övrigt" locked to prevent moving

- **Standard texts: new assignment + okular split**
  - Added `STD_ASSIGNMENT_SELLER_NOTICE.txt`, `STD_ASSIGNMENT_BUYER_NOTICE.txt`
  - Added `STD_VISUAL_INSPECTION_CONDITIONS.txt`, `STD_VISUAL_INSPECTION_ORAL.txt`
  - Updated `reportSpec.ts` + `registry.ts`

- **Appendix 3 formatting**
  - Updated `APPENDIX_3_LIFESPAN_TABLE_SBR.txt` to use `|` separators for parsing

## 2026-02-09

### Major changes
- **PDF V2 export (preview-based)**
  - API route: `src/app/api/report-v2/[inspectionId]/pdf/route.ts`
  - V2 page: `src/app/utlatande-v2/[propertyId]/[inspectionId]/page.tsx`
  - Renderer: `src/lib/report/pdfV2/renderPreviewPdf.ts`
  - Helpers:
    - `src/lib/report/pdfV2/ReportPdfDocumentV2.tsx`
    - `src/lib/report/pdfV2/buildReportDataV2.ts`
    - `src/lib/report/pdfV2/preparePdfImagesV2.ts`

- **Exterior observations data fix (duplicate main rows)**
  - Migration: `docs/db/2026-02-08_inspection_exterior_observations_is_free_note.sql`
  - Logic update: `src/components/ob/ObStepUtsida.tsx`

- **Standard texts cleanup and appendix renames (removed year suffix)**
  - Registry update: `src/content/standardtexts/registry.ts`
  - Appendix IDs update: `src/lib/report/loadAppendixText.ts`, `src/lib/report/reportSpec.ts`
  - Renamed files:
    - `src/content/standardtexts/APPENDIX_1_VILLKOR_SELLER_SBR.txt`
    - `src/content/standardtexts/APPENDIX_2_LITEN_BYGGORDBOK_SBR.txt`
    - `src/content/standardtexts/APPENDIX_3_LIFESPAN_TABLE_SBR.txt`
  - Added buyer appendix:
    - `src/content/standardtexts/APPENDIX_1_VILLKOR_BUYER_SBR.txt`
  - Removed unused standard texts:
    - `STD_COMPANY_CONTACT_BLOCK.txt`
    - `STD_TOC_BLOCK.txt`
    - `STD_ASSIGNMENT_OBJECT_TEMPLATE.txt`
    - `STD_NOTES_SECTION_SKELETON.txt`
    - `STD_SIGNATURE_TEMPLATE.txt`
    - `STD_ASSIGNMENT_MANDATE_TEXT.txt`

- **Cover layout adjustment**
  - `src/components/report/ReportCoverPage.tsx` (logo box sizing + header text fixes)


