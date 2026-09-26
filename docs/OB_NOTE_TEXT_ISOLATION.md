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
