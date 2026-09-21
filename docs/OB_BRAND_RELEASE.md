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

Observed release result: commit `109ba3729be5685735a6495801c95d15fa12b110`
is Ready / Production on `hushub.se`, deployment
`2ApgoAXa8pLwPpfXXjrLQYi3yuU1`, verified in Vercel on 2026-09-21.
The live property form rendered OB Manrope and 48px text inputs; the step menu
contained one OB-runda entry. Verification did not edit inspection fields.
Source work is synced as `f8e6bb7` on the development backup branch.

The isolated local build passed with `next build --webpack` and placeholder
connection values. Default local Turbopack could not resolve the worktree's
external node_modules junction; no production configuration was changed for this.
The normal Vercel production build completed successfully. The 26 selected tests
and synthetic form browser checks also passed in the isolated checkout.

## Mobile resume investigation (not a published correction)

Tested the production inspection page and round UI with synthetic adapters at
390px, plus the assignment-workflow regression suite. No customer data was edited.

- Reproduced: reloading the inspection after entering a room from the normal
  menu starts at Grunddata. The page only initializes from `?round=mobile-v2`
  and does not persist the selected section/building. The round itself stores
  its room/view in sessionStorage, but only restores it after mounting again.
- Reproduced: a failed workflow GET on focus disables the fieldset containing
  the round. The raw visible error is `Failed to fetch`. A later successful
  focus refresh re-enables the same room without reloading. The GET has no
  timeout; retries currently use focus and a 30-second visible-page interval,
  not visibilitychange/pageshow/online. Keep paused/locked/error protections.
- Not reproduced: an immediate return to Grunddata after selecting the round.
  The synthetic router does not model all Next history behavior. Round history
  cleanup calls history.back(), so the interaction with restored history needs
  a real Next/Android regression before changing it.
- Simulated Chromium freeze/resume alone retained the active room and working
  controls. This does not establish what happened on the user's Android device.
  Chrome may freeze/discard background tabs; see the official Page Lifecycle API:
  https://developer.chrome.com/docs/web-platform/page-lifecycle-api

Recommended next implementation: persist validated section/building selection
per inspection/tab, restore it before mounting the round, then verify reload,
menu re-entry and browser Back together. Add bounded, deduplicated workflow reads
and retry on return/online with a clear reconnect message, without bypassing
authorization/paused-state checks or replaying mutations. Verify on Android with
app switching, weak/offline network, pending note saves and image uploads.
