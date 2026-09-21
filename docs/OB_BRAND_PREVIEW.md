# OB profile 1.1: isolated layout preview

## Scope and status

The preview itself remains local. Production publication of the shared UI was
approved after desktop review; see `OB_BRAND_RELEASE.md`.
Reuses the implemented `ObMobileRound`, its note
editor, image bank, movement/deletion sheets, `ObStepMenu` and production CSS.
Only the abbreviated conditions page remains preview markup. Shared steps
outside the preview are omitted; the production wizard retains them all.
No database migrations, reports or inspection data change.

The preview follows the approved blue profile. `docs/OB_BUTTON_PLAN.md` now
supersedes the old indigo rules and records the implementation scope.

## Run

```powershell
node scripts/preview-ob-brand.mjs --port 57120
node scripts/preview-ob-brand.mjs --test
```

The server binds to loopback only. Use another port if it is occupied.
`/` provides mobile/desktop layout controls, 320/360/390/430 widths, 200% text,
a simulated save failure, and a reset of this preview's draft keys only.
`/round?levels&swipe` opens the unframed responsive UI.

The Supabase import is replaced at build time with a three-item synthetic
catalog. The server reads only allowlisted assets, rejects HTTP writes, and
loads no environment files or credentials. A CSP blocks external connections.
The inherited fixture retains its synthetic inspection ID; note draft keys
and note storage are additionally separated by preview building.

Four fictional buildings demonstrate long names. Changes are local only;
notes are retained in browser storage, while rooms and image associations
reset on page reload. Selected files use browser blob URLs and are never
uploaded. Do not treat the preview as a place to record inspection work.

## Assets

- Original BesiktApp logo, unaltered: `public/report-assets/BesiktApp.png`.
- Local OB Manrope font/license under `public/ob/brand`.
- `test/fixtures/ob-brand-assets/bathroom-demo.png`: AI-generated fictional
  bathroom test photograph, 2026-09-21; not customer data or inspection evidence.
  Reused thumbnails represent test records, not additional photographs.

## Layout decisions to evaluate

- Manrope, 16px body text, 14px supporting text, blue primary actions.
- Minimum 48px controls; full room names wrap.
- On narrow screens, room/note tools get a separate row.
- Place heading stays left of inside/outside; below 360px it wraps to two rows.
- White inspection header, original logo in the building menu.
- The actual existing room, note and image flows remain available.

## Verification and limits

The browser test exercises five widths from 320 to 1280, menu grouping,
room/note/image-bank views, long names, simulated save failure and recovery,
200% text and a reduced viewport height. It checks document/panel overflow,
loaded images, console exceptions, external requests and rejected HTTP writes.
Screenshots and the preview bundle are generated under `tmp/ob-brand-preview`.

A reduced viewport is not an actual Android keyboard test. Desktop layout was
approved; real Android checks remain a follow-up. Camera/file selection uses
the browser picker; no upload, offline synchronization or server persistence
is validated here. The current editor includes a retry action reusing its
existing serialized save operation and distinct Risk/Investigation badges.

No global styles or other modules should be changed when this is promoted.
Historical PDFs remain unchanged; report/mail branding is a separate step.
