# Changelog

## 2026-04-08

### Access admin planning
- Added `docs/ADMIN_ACCESS_UI_SPEC.md` with an implementation-ready redesign spec for `/admin/access`
- Updated `docs/ACCESS_IMPLEMENTATION_PLAN.md` to reflect the current agreed product behavior for the admin UI:
  - RenoApp stays role + BRF scope based
  - Dashboard is module-driven with `inspector` as the effective first implementation role
  - `hushub_admin` is treated as a single on/off entitlement in the UI
- Linked the new admin UI spec from `docs/TECH_OVERVIEW.md`

### Access admin UI
- Started the `/admin/access` rebuild toward the new scalable list view:
  - replaced the long card-based access view in `src/app/(app)/admin/access/AccessManagementClient.tsx`
  - added a compact user table with per-product access cells for RenoApp, Dashboard, and HusHub Admin
  - added product-specific dialogs:
    - RenoApp uses BRF + role rows
    - Dashboard uses module toggles with implicit `inspector`
    - HusHub Admin uses a single on/off dialog
  - added a separate user dialog with editable basic profile fields and a first history overview
- Added profile update support to the access admin API:
  - `src/app/api/admin/access-management/route.ts`
  - `src/lib/access/admin.ts`
- Hardened the new Dashboard dialog to recognize and migrate older module-less or `dashboard_admin` assignments into the new module-based UI flow
- Polished the new list view with:
  - compact Dashboard summaries instead of long module strings
  - a legacy-admin badge in the user list
  - a clearer empty state in the user history tab
  - cleaner Swedish copy in the table, dialogs, loading states, and error messages

### Documentation
- Added `docs/ACCESS_MODEL.md` with the target long-term access model for:
  - shared identity
  - separate product access
  - separate module access
  - scoped roles
  - future login and product expansion
- Added `docs/ACCESS_IMPLEMENTATION_PLAN.md` with:
  - implementation order
  - route-to-product mapping
  - `/admin` as its own access domain
  - coding rules for future products, modules, and logins
- Linked the new access model from `docs/TECH_OVERVIEW.md`

### Access foundation
- Added normalized access foundation migration:
  - `docs/db/2026-04-08_02_platform_access_foundation.sql`
- Added shared server-side access layer:
  - `src/lib/access/model.ts`
  - `src/lib/access/server.ts`
- Put `/admin` behind its own product access (`hushub_admin`)
- Put Dashboard route group and key Dashboard areas behind explicit Dashboard access:
  - `src/app/(dashboard)/layout.tsx`
  - `src/app/(app)/properties/layout.tsx`
  - `src/app/(app)/settings/layout.tsx`
- Put RenoApp board portal behind explicit `renoapp/board_portal` access:
  - `src/app/renoapp/app/layout.tsx`
- Updated RenoApp viewer context to read normalized `platform_access_assignments` with BRF scope first,
  with fallback to legacy `brf_members` until migration rollout is complete:
  - `src/lib/renoapp/server.ts`
- Added access-aware entry flow foundation:
  - new chooser route at `src/app/app/page.tsx`
  - `/login` and `/renoapp/login` now send authenticated users to `/app`
  - `src/lib/access/server.ts` can now resolve accessible products and default entry destination
- Updated `hushub.se` dashboard entry button to use `/app` for authenticated users instead of jumping directly to Dashboard:
  - `src/app/(app)/page.tsx`
- Reduced direct `profiles.is_admin` coupling in admin UI:
  - added `src/app/api/access/current/route.ts`
  - added `src/hooks/usePlatformAccess.ts`
  - sidebar `Admin` link now follows `hushub_admin` access instead of legacy `is_admin`
  - `/admin` client pages now rely on server guards instead of separate client-side admin checks
- Added normalized access management inside `/admin`:
  - new module route at `src/app/(app)/admin/access/page.tsx`
  - new server-side access admin service at `src/lib/access/admin.ts`
  - new APIs:
    - `src/app/api/admin/access-management/route.ts`
    - `src/app/api/admin/access-management/[assignmentId]/route.ts`
  - supports listing users, products, modules, roles, scopes and creating/deactivating assignments
- Removed the last temporary `isAdmin = true` transition checks from RenoApp admin pages:
  - `src/app/(app)/admin/renoapp/brf/create/page.tsx`
  - `src/app/(app)/admin/renoapp/brf-requests/page.tsx`

## 2026-02-18

### Major changes
- **OB snapshot foundation (decoupling from live property data)**
  - Added DB migration: `docs/db/2026-02-18_ob_snapshot_and_locks.sql`
  - Added DB migration: `docs/db/2026-02-18_ob_snapshot_backfill.sql`
  - New table `ob_property_snapshot` for per-inspection property snapshot.
  - Added `inspections.locked_at` and `inspections.locked_by` (lock foundation).

- **Create-flow hardening**
  - New inspections now create snapshot rows at creation time:
    - `src/app/(app)/properties/[id]/ob/page.tsx`
    - `src/app/(dashboard)/ob/page.tsx`
  - Added cleanup on snapshot failure to avoid half-created records.

- **Snapshot-first read path**
  - Inspection detail now reads `ob_property_snapshot` first, with fallback to `properties`:
    - `src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx`
  - Report data now overlays snapshot data (fallback to `properties`):
    - `src/app/utlatande/[propertyId]/[inspectionId]/page.tsx`
    - `src/lib/report/pdfV2/buildReportDataV2.ts`
  - Dashboard inspection lists now prefer snapshot address/customer:
    - `src/app/(dashboard)/ob/page.tsx`
    - `src/app/(dashboard)/inspections/page.tsx`

- **OB Grunddata write-path**
  - Property-like fields in OB Grunddata now save to `ob_property_snapshot` (not live `properties`):
    - `src/components/ob/ObStepGrunddata.tsx`

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



- Settings ligger nu bakom `dashboard/admin` i det nya accesslagret, settings-sidorna förlitar sig på serverguards i stället för klientkoll på `isAdmin`, och Sidebar visar `Settings` via normaliserad Dashboard-admin-access.
