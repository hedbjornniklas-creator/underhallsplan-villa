# OB floor model v2

## Scope and compatibility

- Only OB inspections inserted AFTER rollout activation get a row in
  `inspection_floor_models`. No existing inspections are converted or backfilled.
- Absence of that row means the original overview-derived floor model. Existing
  Plan 1, basement categories, room IDs, notes, images and report labels stay unchanged.
- Existing inspections do not get an automatic basement room. Inspectors can still
  add one manually. The settings seed adds a room type, not rooms in existing objects.
- New model: Plan 0 is the entrance reference by default. Positive integers are
  above it, negative integers below it. Names are independent of numbers. Allmant
  (`ovrigt`) is not a physical floor. Suterrang is a name, not an inferred elevation.
- Configure explicit levels under Forutsattningar > Byggnadstyp > Plan. Initially
  only Plan 0 exists. Add the actual levels and optional names, then save.
  Building-type answers remain descriptive report data; they do not renumber floors.
- Supported range: -99..199, up to 64 unique levels, names up to 80 characters.
  Plan 0 cannot be removed. Renumbering an occupied level means adding its target
  and explicitly moving rooms; editing a name does not move anything.
- Both rounds, the inside/outside views, per-floor building data and HTML/PDF report
  generation use the same new-model labels. Stored report snapshots/PDFs are not rewritten.

## Safety

The model table is read-only to authenticated clients, using the existing inspection
RLS visibility. Configuration saves use a service-only RPC with the existing OB
owner/org authorization and assignment/inspection locking order. Locked, completed
and paused inspections cannot be changed. Revision checks prevent overwriting another
editor's configuration. Every successful edit retains before/after data in
`ob_floor_changes`, accessible only to the service role.

Deleting a level is rejected while rooms, per-floor answers (even empty saved rows),
or image capture origins refer to it. Room, answer and image-origin writes validate
new/changed keys under the same inspection lock. Historical unchanged provenance is
not rewritten. Network/access/invalid-model errors do not silently select legacy mode.

Basement automation reads the first building-type selection and its matching option's
`system_value`. `ja`, `yes` or `true` create one Kallare room under Allmant. Labels and
category IDs are not hard-coded. Future categories must have their semantic value set
in settings; unknown values and `nej` do nothing. Existing selected inactive options
retain their semantic meaning.

`ob_auto_rooms` records that the rule ran. It reuses an existing basement room when
possible. Later answer changes do not delete content. A user's move, rename or deletion
does not cause regeneration. This automation never assigns a physical basement level.

## Controlled rollout

1. Back up the database and verify that the existing ongoing inspection remains on
   the legacy model. Do not copy private inspection data into the synthetic preview.
2. Apply `docs/db/2026-09-11_01_ob_round_mutations.sql` if not already installed, then
   `docs/db/2026-09-11_03_ob_floor_model.sql`. The latter is additive and idempotent;
   it leaves rollout disabled on initial installation and preserves its current state
   when rerun. No production migration was executed by the implementation task.
3. Deploy the compatible application. Refresh any older browser/mobile tabs before
   creating new inspections. Smoke-test legacy editing and report generation first.
4. Activate new-inspection enrollment deliberately, using the SQL editor:

   ```sql
   update public.ob_floor_rollout set enabled = true where id = true;
   ```

5. Create a disposable new OB inspection. Verify Plan 0, negative levels, basement
   category selection, room movement and matching report headings before normal use.

Emergency enrollment stop: set `enabled = false`. Already-enrolled inspections retain
their model and require the compatible application; do not deploy an old application
over them or delete their model rows. Conversion/import of old inspections is outside
this change and must explicitly preserve their original floor model.

## Verification

- `node --experimental-strip-types --test test/ob-round-mutations.test.ts`
- `node --experimental-strip-types --test test/ob-round-mutation-api.test.ts test/ob-mobile-round.test.ts test/ob-early-start-api.test.ts`
- `node scripts/test-ob-mobile-round-ui.mjs`
- `npx tsc --noEmit`

The SQL tests execute both migrations in PGlite. Browser tests use production UI with
synthetic callbacks, including add/name/save/cancel/conflict/locked states on narrow
and desktop viewports. They do not exercise production authentication or write to the
ongoing inspection. Optional synthetic preview: run the browser script with
`--serve --port <free-port>` and open `/preview?levels`.
