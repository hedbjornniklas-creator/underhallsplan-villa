# OB blue profile release, 2026-09-21

## Approval and boundary

The user approved publication after testing the local desktop preview.
The physical Android keyboard was not retested on this profile; the attempted
phone-preview tunnel was blocked. This limitation is retained explicitly.

The release is isolated from the mixed development checkout and starts at
`936c7ec491ba73ec6a5845bc1f12eed18bded1ad`, verified as the Ready Production
deployment for `hushub.se` before publication. No full development-branch merge.

Application changes:

- `src/components/ob/mobile-round.css`: scoped blue profile and responsive sizing.
- `src/components/ob/ObMobileRound.tsx`: semantic badges and save retry.
- `src/components/ob/ObRoundSheet.tsx`: shared styling and focus restoration.
- `src/components/ob/ObStepMenu.tsx`: building-grouped menu with existing actions.
- `src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx`: menu integration,
  one entry named OB-runda and redirects from the retired round alias.
- `public/ob/brand/manrope.ttf` and its `OFL.txt` license.

Supporting changes are OB documentation, browser/unit tests and synthetic
fixtures. The building-image fixture adapter is included so the full browser
suite remains reproducible on main. No live fixture records are created.

No SQL, API contract, environment-variable, inspection-data, report, email,
RenoApp, TU/EB or Uppdrag changes are included. Current deployed changes in those
areas remain in the baseline; unfinished work in other tasks stays untouched.

## Verification

- 51 targeted unit/in-memory database tests.
- Brand browser checks at 320, 360, 390, 430 and 1280px, 200% text, dark device
  preference, focus/Escape, save failure/retry and multi-image selection.
- Full mobile-round browser regression, using synthetic callbacks only.
- Isolated optimized Next build, TypeScript and all 62 static pages. The local
  build uses non-working placeholder connection values, not production secrets;
  it is not uploaded as a deployment artifact. Vercel builds from Git with its
  unchanged production configuration.
- Post-publication checks: matching Git/Vercel revision, Ready Production and
  domain, font checksum, and read-only inspection UI navigation.

Do not call the last checks complete until their results have been observed.
For rollback, revert only this release commit on the then-current main branch.
No database restore or migration rollback is required for these UI changes.

## Form extension and autosave correction, 2026-09-21

The user approved publishing the latest forms and the identified autosave fix
before investigating mobile app-switch/navigation behavior. The isolated release
starts from `980b4b3ab5b1b57f02d2f745a7c6ea32977703cd` on main.

Scope: Grunddata and conditions styling, shared form-sheet navigation, scoped
form CSS and mobile heading, plus dirty-field protection and serialized Grunddata
writes. Supporting files are synthetic form fixtures, browser/queue tests and
this documentation. Other tasks' files are excluded. No SQL or configuration
changes, customer records or outbound emails are part of publication.

Preflight: 26 selected unit/static tests, delayed-write form browser tests and
TypeScript passed. The form suite covers 320/390/768/1280px and 200% text. Existing
round-brand browser regression passed with the same styling changes in the prior
turn. Physical Android testing remains outstanding for the new form layout.

The release build and Git/Vercel revision/domain checks must be observed before
reporting the extension as live. Revert only the extension commit to roll back;
no database rollback is needed. Mobile resume/navigation is a separate follow-up
and is not claimed fixed by this form release.
