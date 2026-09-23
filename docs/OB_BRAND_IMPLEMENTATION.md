# OB profile 1.1 implementation

## Design update 1.2, 2026-09-23

The approved direction for overview/list screens is now documented in
[OB_BRAND_PROFILE.md](OB_BRAND_PROFILE.md). It adopts RenoApp's quiet list
patterns with OB colors, separate confirmation/inspection states, and mobile
shortcuts with stacked rows. The profile PDF and reference images are design
artifacts only. This does not implement or deploy the combined list, remove
the existing entry points, or change the 1.1 release history below.

## Combined overview implementation, 2026-09-23

The subsequent user-approved implementation adds `ObOverview` below the four
existing dashboard cards, with collapsible mobile shortcuts. Separate confirmation
and inspection states, ID-based linking, filters and read-only aggregation are
documented in [OB_OVERVIEW.md](OB_OVERVIEW.md). The old list pages remain available.
This implementation is local and has not been published. No SQL migration is added.

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
Assignment pages and report/mail branding are later steps.

## Form rollout, 2026-09-21

The next approved step covers **Fastighet & uppdrag** and **Förutsättningar**.
The user approved publication together with the autosave correction below.
This is a separate release from the initial round/menu profile above.

- `ob-forms.css` reuses the same profile tokens and local font. Its selectors are
  limited to OB form surfaces; other modules keep their existing styling.
- Property, customer and inspector sections use unframed responsive columns,
  readable supporting text, associated field labels and 48px controls.
- Conditions use wrapping summary rows and Lucide icons. The existing shared
  sheet supplies a back arrow, keyboard focus and Escape behavior. Only one copy
  of the detail fields is mounted on both desktop and mobile.
- Escape blurs the active field before closing, preserving the existing
  textarea save-on-blur behavior. Conditions draft keys, building scope,
  revision checks and inspection locks remain unchanged.
- The mobile step heading uses blue styling and shows the step count once.
- Existing legacy cover-image fallback and frozen inspector data are retained.

Local review uses the real form components with an in-memory adapter:

```powershell
node scripts/preview-ob-brand.mjs --forms --test
node --experimental-strip-types --test test/ob-forms-brand.test.ts
node scripts/preview-ob-brand.mjs --forms --port 57123
```

The preview never reads environment files or credentials and has no external
network fallback. Database writes are simulated in memory. Screenshots are
generated under `tmp/ob-forms-preview` (not release assets).

Validation covers 320/390/768/1280px, 200% text, field saving, scoped building
values, repeatable/per-floor fields, Escape/focus, locked inspections, legacy
cover images and the existing round/menu regression suite. Physical Android
keyboard and camera checks are still a separate real-device follow-up.

Results: form browser checks and round-brand browser regression passed, as did
18 selected unit/static checks, TypeScript and the production build. The build
retains the two pre-existing PDF filesystem-pattern warnings noted above.
The local form preview is available at `http://127.0.0.1:57123/` on this computer.

### Autosave correction

Grunddata previously replaced entire local forms when parent props changed.
A delayed save could therefore interrupt editing in another field. Local dirty
fields now survive parent refreshes; a successful save acknowledges only the
values it submitted, retaining any newer text. Saves are queued per inspection
and callbacks merge property patches into the latest state. Pending counters
keep the saving indicator visible until all queued work has finished.

The browser regression now simulates 500ms write latency, rapid edits across
object/contact fields and successive edits to the same contact field, including
server normalization. It checks both visible values and the final write.
Queue tests cover ordering, independent inspections, the comparison save barrier
and recovery after rejection. The extended 26-test selection, form browser suite
and TypeScript passed. This does not add offline storage or change lock rules.
