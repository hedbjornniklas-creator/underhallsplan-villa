# OB inspection-owned note text

## Decision

Note, risk and further-investigation (FTU) text are copied from the catalogue
when the inspector explicitly adds/selects a suggestion. All three fields,
including empty values, then belong to the inspection. Catalogue updates or
retirement must not refill or replace them, even in an ongoing inspection.

This supersedes the former report/editor fallback from a null risk/FTU field to
the current outcome template. An empty string and a historical null both render
as empty. This interpretation does not rewrite the stored record.

The user explicitly excluded a review or mass update of earlier inspections.
Do not backfill them from current templates, published snapshots or guesses.
Removing the fallback can remove previously injected template text from a new
working preview/publication. Stored customer snapshots and PDFs remain intact.

## Implementation

- `src/lib/ob/noteText.ts` provides the shared copy/read boundary. It preserves
  text exactly and produces explicit empty strings for new template copies.
- The shared round, retained interior/exterior editors and image-note creation
  use this boundary. Existing manual risk/FTU on an unselected legacy control
  point retain the existing preservation rule when a suggestion is first chosen.
- Editors read inspection-owned fields. A changed catalogue is used for future
  choices/search only, not for displaying existing note content.
- Both live HTML report construction and PDF/snapshot data construction use
  stored note fields and no longer query `settings_control_point_outcomes`.
- Existing field-save behavior, building scoping, locks, local-draft recovery,
  report snapshots, stored PDF retrieval and public customer links are unchanged.
- No migration, historical inventory, backfill or production data writes are
  part of this change. Production publication is a separate action.

## Verification

```powershell
node --experimental-strip-types --test test/ob-cleared-template-text.test.ts test/ob-published-report.test.ts test/ob-building-api-report.test.ts test/ob-mobile-round.test.ts
node scripts/test-ob-mobile-round-ui.mjs --note-copy-only
npx tsc --noEmit --incremental false
```

Checks cover copying filled/null/empty fields, changed templates, cleared fields,
serialization, both interior/exterior report expressions and removal of catalogue
queries. Browser checks use synthetic data at mobile and desktop sizes for main
and extra buildings, including catalogue retirement and autosave/reload. Existing
published-report tests verify snapshot-only reads and refusal to fall back to
live inspection data. No customer inspection needs to be opened or changed.

## Production release, 2026-09-26

Published after the user's explicit approval together with the pending-image
filters documented in `OB_MOBILE_ROUND_V2.md`. Source commit `388ae32` was applied
to current production `6db18e2`, producing release commit
`0350f5c637efd72a12a8c3facab3eb1d78525524`.

The production-only selected-outcome visibility correction from `4b1e989` was
preserved. Its report lookup is superseded by inspection-owned text; retired or
missing templates still cannot hide saved notes. The corresponding report and
editor tests were updated in the release checkout, not discarded.

The exact production candidate passed 101 unit/database/API tests, pending-image
and note-copy browser suites, and the full optimized Next.js build including
TypeScript and 62 static pages. Screenshots at mobile and desktop sizes were
inspected. All tests used synthetic data; the local build used placeholder
configuration, not production credentials.

Vercel reported successful deployment `dpl_4NRZnCSNNsJxCAfjHunE4T8rq6VK`.
At 18:24 UTC, hushub.se/login returned HTTP 200 and that exact deployment ID.
This verifies deployment, not authenticated customer editing. No SQL, customer
record edits, historical review/backfill, snapshot regeneration or PDF changes
were performed. Other chats' assignment-confirmation and RenoApp work was left
untouched and excluded from the release.
