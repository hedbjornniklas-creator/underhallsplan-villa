# Changelog

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

