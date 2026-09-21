# OB profile 1.1 implementation

## Scope, 2026-09-21

Implemented and approved for publication after the user's desktop review.
Release scope and verification are recorded in `OB_BRAND_RELEASE.md`.

- `mobile-round.css`: scoped profile tokens, local OB Manrope, blue actions,
  readable fields, 48px controls, wrapping names and responsive tool rows.
- `ObMobileRound`: Risk/Investigation semantic hooks and a retry button calling
  the existing serialized `persist` operation; no new persistence mechanism.
- `ObStepMenu`: shared and per-building steps from the existing page data,
  native dialog focus/escape handling, back arrow, original BesiktApp logo.
- `ObRoundSheet`: restore keyboard focus to a surviving opener after React
  removes the dialog; keep the existing close and draft-save guards.
- The inspection page still owns section switching, building selection and
  unsaved-draft confirmation. Menu entries/permissions are not recreated in a
  second source of truth.
- The preview now uses production styling and the production menu. Only its
  records/callbacks and abbreviated conditions page remain synthetic.

The older indigo button plan is superseded in `OB_BUTTON_PLAN.md`.
No SQL, API contracts, inspection records, report documents, email templates,
TU/EB screens or other modules are changed. The previously approved legacy-round
menu retirement ships with the profile; existing aliases redirect to the new
round and the underlying data is retained.

## Verification

```powershell
node scripts/preview-ob-brand.mjs --test
node scripts/test-ob-mobile-round-ui.mjs
node --experimental-strip-types --test test/ob-brand.test.ts test/ob-mobile-round.test.ts test/ob-building-navigation.test.ts test/ob-round-image-bank.test.ts test/ob-round-image-unlink.test.ts test/ob-room-name-images.test.ts test/ob-round-mutations.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

The regression suite uses the real round, menu and inspection-page components
with synthetic adapters. It verifies draft protection, browser Back, gestures,
image placement/link/unlink/delete, room renaming/moving and read-only states.
Brand checks cover contrast pairs, assets, 320-1280px layouts, long names,
200% text, save error/retry and generated screenshots.

Results on 2026-09-21: all 51 selected unit/database-fixture tests, the full
round browser suite and the brand browser suite passed. The brand suite also
checks keyboard focus/escape, 48px controls and a dark device preference.
The full suite verifies the enlarged image viewer in portrait and landscape.
Type checking and the production build passed. The build reports two existing
non-blocking broad-filesystem-pattern warnings in `renderPreviewPdf.ts`.

Local review: `http://127.0.0.1:57121/`. The server uses synthetic data, blocks
external requests and rejects application writes. It is not a live inspection
or a replacement for the final real-device test.

## Release boundary

The user explicitly approved publication on 2026-09-21 after desktop testing.
The attempted remote phone-preview connection was unavailable, so the current
profile has not been tested with a physical Android keyboard. The reduced-height
browser test is only a keyboard-layout approximation; real-device checks remain
a follow-up, not evidence claimed by this release.
Review and commit only task-related changes; parallel Uppdrag work is separate.
Broader forms, assignment pages and report/mail branding are later steps.
