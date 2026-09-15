# OB building purpose catalogue

Status: implemented and rehearsed in the isolated OB staging project on 2026-09-13.
Not applied to production. The broader multi-building rollout gates still apply.

## User interaction

- Building name remains mandatory free text, independent of classification.
- Building purpose is optional: `Ej angivet` stores null, not an invented official code.
- A searchable picker uses Boverket's official labels and hierarchy. Common
  residential purposes appear first; all imported levels remain available.
- Search hints such as villa, friggebod and attefallshus are application-owned
  discovery aids, not official labels or automatic classifications. The inspector
  chooses the appropriate purpose based on actual use, not a presumed permit status.
- Existing application categories remain readable as `Tidigare kategori` and are
  preserved when editing a name. They are not silently mapped to official concepts.
- No classification controls floors, room creation, inspection scope or the primary
  building role. `Byggnadstyp` in Conditions remains a separate existing setting.

## Source and representation

Boverket's [Andamalskatalog API documentation](https://www.boverket.se/sv/om-boverket/oppna-data/api-tjanst-for-andamalskatalogen/)
and [API reference](https://api-portal.boverket.se/reference#api=andamalskatalogen&operation=get-api-v1-catalogue)
describe the source. The import reads
`https://api.boverket.se/andamalskatalogen/v1/Catalogue` explicitly during maintenance,
never at runtime or during a build. This is a purpose catalogue, not Skatteverket's
tax-assessment typkoder or an automatic determination of a building's legal status.

The initial snapshot contains 197 hierarchical concepts (including parent and
unknown concepts), not 197 mutually exclusive detailed building types.
Source catalogue timestamp: `2026-09-13T13:57:45.4848961+02:00`.
Raw response SHA-256: `fcfe00087a6201261ca5192bb9044571a3288daef263cfe3b5083d36cf033117`.
Official names and identifiers are retained unchanged with visible attribution.

`src/lib/buildings/boverketCatalogue.json` preserves the normalized source snapshot.
The database stores each version in `settings_ob_building_categories.catalogue_entry`:
source, concept number, version, URI, label and hierarchy path. Its key is, for
example, `boverket:010404:v2` (residential Garage). Application search hints are
stored separately in `buildingPurpose.ts`.

The inspection building holds a nullable foreign key to that version. An immutable
metadata trigger rejects changes/deletion of imported versions; active status and
sorting remain editable. Old selected versions remain readable after retirement.
Report data includes `obBuildingClassifications` with the exact version metadata,
so new frozen snapshots retain both the identifier and its meaning. The PDF layout
is unchanged. Already saved report snapshots and existing PDFs are not rewritten.

## Migration and rollout

Requires the reviewed multi-building migrations `2026-09-12_01` through `_04`.
Apply these additions in order:

1. `docs/db/2026-09-13_01_ob_building_purpose.sql`: nullable purpose, immutable
   metadata, optional/clearable command handling and report-service catalogue reads.
2. `docs/db/2026-09-13_02_ob_building_purpose_catalogue.sql`: initial versioned data.

Both are repeatable. Neither updates existing inspection/category assignments.
Existing permission, revision, lock, retry and activation guards are retained.
The new UI activates only when catalogue metadata is available; before the seed
it keeps the old selector. Old clients retain the original activation default;
new clients explicitly send `purposeCatalogueVersion: 1` for optional activation.
Deploy the new app together with these additions; do not roll back its nullable
category handling after users have started leaving the purpose empty.

For the isolated rehearsal, `node scripts/serve-ob-staging-access.mjs --building-purpose`
serves only these two files wrapped in the existing pinned staging installation
guard. Do not run staging scripts against production or add production keys.

## Future catalogue updates

Run the explicit import command with a NEW dated migration filename:

```text
node scripts/update-boverket-building-catalogue.mjs YYYY-MM-DD_NN_ob_building_purpose_catalogue.sql
```

Review the generated diff before committing/applying it. The importer refuses to
overwrite an existing migration or change metadata for an already imported version.
Older versions are retained; versions absent from the new response are deactivated
for new UI choices. Reactivation of a previously deactivated choice requires an
explicit reviewed decision. Existing inspection keys are never upgraded in bulk.
The command does not call Supabase, migrate a database or publish the application.

## Verification

- Database tests: repeatable migrations, legacy preservation, optional/clearable
  purpose, stale revisions, invalid keys, immutable and retired version behavior.
- API/search/report tests: input validation, exact source mapping, Swedish search
  hints, ambiguous labels, version-aware report reading and missing-metadata errors.
- `scripts/test-ob-staging-building-purpose.mjs`: guarded synthetic property and
  inspection, six live checks, no changes to the original click-test inspection.
- Desktop and mobile browser checks cover choosing, saving, clearing, canceling,
  legacy display and free-text naming without a classification. Screenshots were
  checked at 320, 390 and 1280 pixels, including long labels and no horizontal overflow.
- TypeScript and 112 targeted regression tests pass. Targeted lint passes for the
  new picker, helpers, scripts and related building modules. The report builder
  retains its 11 pre-existing `no-explicit-any` diagnostics, verified against HEAD.

This feature does not complete physical-device, full report delivery, backup/restore
or production acceptance for the broader building implementation.
