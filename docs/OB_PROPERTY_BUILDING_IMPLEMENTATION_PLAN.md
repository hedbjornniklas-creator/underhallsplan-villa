# OB: final property and multi-building implementation plan

Plan version: 1.1, 2026-09-12.
Status: implementation approved in chat; local implementation in progress.
Database rollout remains OFF. Production SQL, deployment and activation require
separate approval after the verification and release gates below.
Reviewed repository baseline: `e12bf08`, 2026-09-11.

This document supersedes the earlier alternatives in this document and the chat.
It defines one implementation path, not three options. Preparing this plan is not
authorization to run production SQL, commit, deploy, or activate a real inspection.

Approved practical refinement: show the included building count and building list
in Fastighet & uppdrag (previously Grunddata), with explicit add/remove actions.
For enrolled inspections, hide the old cover uploader there and show a separate
building image under each building's Conditions. The primary building image is
the cover; extra building images introduce their appendices. Keep all legacy
cover references/files. Only the primary building may fall back to the old cover.
Replacing a building image must not delete previously uploaded files.

## 1. Decision and immediate outcome

Use the existing property and building register. Keep ONE genuine OB inspection
for the assignment, with a separate inspection-owned building part for each
physical building included in it.

For this delivery:

- Add an extra building to an existing OB, using its existing property.
- Give each included building its own Conditions and the existing new OB round.
- Keep property/assignment information, documents/disclosures, review and delivery
  shared across the OB. Do not create another assignment or approval process.
- Present each additional building as a named appendix in the same report.
- Support one, two, four and more buildings without a hard-coded "house 2" model.
- Keep existing findings, photos, floor names and delivered reports intact.
- Implement and verify this end-to-end in OB first.

We do NOT use separate inspection IDs as substitutes for physical buildings.
We do NOT make a second property when adding an extra building.
An appendix is a report presentation choice, not an alternative identity model.

The first building categories are Attefallshus, Friggebod, Guesthouse, Garage and
Complementary building, with Swedish UI labels and an editable building name.
Categories use stable configuration keys, not an SQL enum of display labels.
Adding a category later must not require redefining the relationships.

## 2. Overall model and future boundaries

The property is the shared domain root. A physical building is not a child of a
particular inspection; it can be inspected repeatedly over its lifetime.

```text
Property: property_id
  Buildings: building_id, property_id
  Inspections: inspection_id, property_id, family/variant
    Included OB buildings: building_part_id, inspection_id, building_id
      Inspection-owned building facts and conditions
      Floors, rooms, exterior observations, notes and image placement
    Shared documents, assignment, approval, locking and report versions

Future maintenance plans: own IDs, property_id and explicit building scope
Future TU / EB: reference the same property/building identities as appropriate
```

An inspection includes one or several buildings. The same building can occur in
several inspections, with a different building-part ID and independent facts in
each. Enforce uniqueness of building + inspection within one OB.

Names, addresses, building categories, floor labels and display order are never
relationship keys. An extension recorded under construction years does not by
itself create a separate physical building.

### What this prepares, but does not implement now

- A property-owner interface with explicit access to shared reports and plans.
- Independently editable maintenance plans, separately scoped to buildings, with
  a property-level combined overview and no double-counted measures.
- Selected data imports OB -> maintenance plan and maintenance plan -> OB.
- Reusing a property when creating another inspection through every assignment,
  TU and EB flow, and connecting EB's existing project/inspection hierarchy.
- Shared property land/site areas as their own scope, not a fake building/floor.

The existing schema already allows several inspections under a property.
However, current creation flows often create a new property. This release must
not be described as having completed cross-module property reuse or the owner
portal. No global property merge or deduplication is included.

### Import is a copy, never live synchronization

Future imports must have all these properties:

1. The user selects the source property/building and source report/plan version.
2. A preview shows selected fields, provenance, and any proposed replacements.
3. Only explicitly accepted values are copied into the destination's own records.
4. Store source ID/version, source building, import time and importing user.
5. A source change does not mutate any existing OB, including an open draft.
6. Re-import into an unlocked OB is a new, reviewed edit, not a background task.
7. Locked/delivered OB versions are immutable. Corrections produce an explicit
   new report version or follow the established controlled reopening procedure.

A physical building name or fact edited in the register must not silently change
the corresponding inspection snapshot either. Source links provide traceability;
they do not grant write-through access.

### Access is a separate concern

`properties.owner` currently participates in inspector access checks. It must not
be repurposed as the legal property owner or changed to grant customer access.
Keep current owner/org authorization for this delivery. Future owner access needs
explicit grants, roles and document publication rules, including which maintenance
fields may be edited. Do not expose internal drafts simply because the property
is shared or because an owner can edit a maintenance plan.

## 3. User experience for this OB release

### Shared and building-specific steps

Rename the visible "Grunddata" label to "Fastighet & uppdrag"; preserve its existing
fields and internal key where possible. It includes more than property facts.

Use direct entries in the existing step menu, grouped by building, not a separate
inspection or a compulsory new "complementary buildings" navigation system:

```text
Fastighet & uppdrag
Handlingar & upplysningar

Huvudbyggnad
  Forutsattningar
  OB-runda

Gasthus
  Forutsattningar
  OB-runda

Granska
Skicka utlatande
```

The example omits Swedish accents only for this ASCII document. Actual UI labels
retain normal Swedish spelling. Area/moisture add-ons remain visible when selected.
Long building names must wrap, and the menu must remain usable with four buildings.

### Add a building

- Provide "Lagg till byggnad" with a plus icon in the shared building overview.
- Choose an existing building from this property or create a new registered
  building with a name and category. Never select the first register row silently.
- Before first activation, explicitly identify the main building's register link.
  Offer creating a main building if it has no suitable register record.
- Show and confirm which buildings the inspection includes. Adding a building
  does not say it has been inspected or expand an accepted assignment silently.
- Creating a register record, its OB part and initial configuration is one
  retry-safe transaction. Canceling creates nothing.
- The new building starts with blank factual answers and no copied findings.
  It receives its own Conditions and round entries immediately.
- Building name/category in this OB are snapshot values. Renaming is explicit and
  does not rename another inspection's copy or the source register automatically.
- Empty accidentally created parts can be removed with confirmation and audit.
  Occupied parts cannot be deleted wholesale. Removing a part never deletes its
  registered physical building or another inspection.

If inclusion changes previously accepted scope, use the existing controlled
assignment-change workflow. Do not automatically approve the change or bypass the
current early-start, pause and delivery restrictions. Include this case in tests.

### Conditions

Reuse `ObStepForutsattningar` and its settings-driven fields through an explicit
building-scoped data layer. Do not fork a guesthouse version of the component.

Building-owned answers include building type/year, construction, foundation,
facade, roof, windows, water/sewer installations, heating, ventilation, furnishing
and building-specific access/limitations. Options and free-note fields retain the
existing behavior; a material-picker/search redesign is not part of this change.

Shared visit weather remains inspection-scoped. Documents, general oral disclosures,
attendees and assignment facts remain shared. Existing `special_conditions` and
other ambiguous free-text fields must be preserved with their current meaning for
the main building, not guessed apart or copied into every new building.

A new building uses its own Plan 0 configuration. The existing main building
retains its current explicit or legacy floors exactly, including Plan 1 and
basement/split-level labels. No automatic renumbering or inferred conversion.

Basement auto-creation must be scoped to building + rule key and driven by semantic
settings values. Preserve previous rule markers during activation; do not recreate
rooms the user removed. Future basement categories reuse the same semantic rule.

### Round, photos and navigation

Reuse the current `ObMobileRound` and its approved controls. Do not create a third
round implementation. Each building has Places, Notes and Pending scoped to it.

- Building + floor/place context remains visible where needed.
- Back arrows, hardware Back, room swipe, room rename/move, note move, image bank,
  unlink/delete, free notes and search retain their established behavior.
- Swiping stays inside the active building. Switching building is an explicit
  menu action, not an accidental swipe beyond the last room.
- Pending counts and the shared Review also show inspection-wide unresolved work,
  so another building's unfinished notes/photos cannot be overlooked.
- Rooms and exterior categories with identical names remain separate.
- Building-specific galleries and image-bank filters default to that building.
- Moving a room to another building requires an explicit destination building and
  floor. Moving/linking a note or photo elsewhere similarly requires an explicit
  destination. Keep record IDs and file paths; preserve original capture location.
- Camera/gallery selections bind the original inspection/building/place before
  the file picker opens. Later navigation cannot change queued placement.
- A building-round import may be assigned to that building without a room. Truly
  unassigned legacy/imported images remain visible in a shared unresolved queue
  until the user assigns them; do not guess a building.
- Queued uploads and text drafts survive failed saves, navigation and retries.
  Building-sensitive draft/cache/navigation keys include building-part identity.
- Building switches must finish or retain pending edits. On a failed save, keep
  the draft and current editing context, rather than discarding or relocating it.

Existing ground observations stay with the main building unless explicitly moved.
A separate shared-land editor is deferred. Ground recorded for an extra building
is clearly labeled as belonging to that building, not automatically property-wide.

### Original round and desktop steps

Single-building legacy inspections retain their current editing path until
deliberately activated. Do not remove those interfaces globally.

For activated multi-building inspections, the new round is the authoritative
editing path. The original round and standalone Inside/Outside views must not be
offered as editable, unscoped alternatives. They may only remain available as
clearly identified read-only legacy views after scope-safe reads are verified.
Reject their old ambiguous writes in the database, not just through hidden buttons.

## 4. Technical design

### A relational extension, not a whole-building JSON editor

Reuse the existing relational room, observation, note and image records, adding
explicit scope. Their stable IDs are important for moves, retries, galleries,
auditing, report mapping and future selected imports.

Do not store all editable rooms, notes and photos as one JSON document with one
revision. Existing semistructured selection values, floor configurations and frozen
report/audit snapshots may still use JSON. This is not a ban on JSON fields.

Use these logical entities, finalizing field/FK spelling against the installed
schema before writing the approved migration:

| Entity | Responsibility |
| --- | --- |
| `properties` | Existing property identity; no duplicate register. |
| `buildings` | Existing physical building identity under the property. |
| `ob_inspection_structure` | Opt-in structure version, explicit primary part, revision and activation audit for one OB. |
| `ob_inspection_buildings` | Part ID, inspection ID, registered building ID, snapshot name/category/facts, scope/limitations, order and revision. |
| Building-scoped conditions | Building fallback facts and furnishing, separate from shared visit data. |
| Building-scoped floor configuration | Own legacy/v2 mode and level configuration for each part. |
| Scoped existing operational rows | Rooms, exterior observations, overview selections, notes, quick notes and images. |
| Mutation and recovery records | Expected versions, actor, request ID, before/after or removal snapshot. |

Every included building, including the main building, has a stable `building_id`.
Creating these links does not call the existing property-page workflow that seeds
`spaces`. Inspection rooms remain separate from register `spaces`.

### Ownership and reference rules

- Rooms and exterior observations have an explicit `building_part_id`.
- Overview selections and building conditions also belong to a part.
- A note's part follows its room/observation. If scope is stored for efficient
  queries, enforce agreement in the DB; it is not independently editable.
- Images distinguish current building/place from original capture building/place.
  A linked image's current placement follows its note.
- Root inspection ID remains present for authorization, reporting and indexing.
- Composite references/DB guards verify part + inspection and source building +
  property; independent valid UUIDs alone are insufficient.
- A primary part is an explicit relationship, not a name or first sorted row.
- Register deletion/reparenting cannot cascade into or invalidate inspection
  history. Block destructive changes to referenced identities; use archival
  behavior where appropriate. Audit existing property/building cascade paths.
- All scoped lists, counts, ordering, searches and mutations resolve the same
  authoritative building context. Never mix previous-building rows during loading.
- Legacy auxiliary answer/selection tables must be inventoried too. Even unused
  current UI tables may contain records or expose old direct write paths.

For opted-in inspections, scoped floors/conditions are authoritative; never
dual-write them and legacy fields. Preserve legacy source values for recovery and
non-enrolled readers. Copy main-building facts/configuration once during activation
with provenance; missing extra-building facts must remain missing.

### Uniqueness and old-client protection

Two facades and two copies of the same overview item/floor must coexist in the
same inspection when they belong to different buildings.

Define independent legacy and building-scoped uniqueness:

- Exterior: legacy inspection + item for unscoped rows; part + item for scoped
  primary observations. Keep free-note semantics.
- Overview: legacy inspection + item + floor + set for unscoped rows; part + item +
  floor + set for scoped rows, with explicit NULL-equal floor semantics.
- Each building occurs at most once per OB; each part has one authoritative floor
  configuration and one marker per automatic-room rule.
- Once activated, operational writes require valid scope. NULL is not permission
  to default silently to the main building.

A partial legacy unique index will NOT automatically support the existing
`onConflict: inspection_id,overview_item_id,floor_key,set_index` client call.
Therefore move affected OB upserts behind compatible server/DB commands BEFORE
the index transition. Merely adding a part column is not a sufficient migration.

All new OB writers use explicit, versioned commands. Revoke ambiguous direct
write paths for activated OB rows through DB permissions/guards; do not trust a
client-supplied compatibility flag. Preserve other modules' existing permissions.
Old tabs must fail visibly and retain drafts, never appear to save into a default.

### Authorization, transactions and concurrency

Every command must verify current actor/org access and the ROOT inspection's
workflow, status and lock. A building part has no separate delivery or approval.

Preserve assignment -> inspection -> child lock ordering. Use revision/expected
state checks, deterministic lock order for cross-building moves and idempotent
request receipts. A stale save is a conflict, not an overwrite. Keep recoverable
drafts and removal audit; do not automatically retry against newly changed content.

Building creation, moves, note+photo creation and linking are atomic. Uploads need
durable intent/retry handling because storage and DB writes are not one transaction.
A failed metadata save must not lose the selected file or create another record on
retry. Offline replay must not resurrect removed parents.

Any ordinary or structural write must advance the revision used for coherent
report capture. New paths cannot bypass early-start approval restrictions, paused
assignment rules, inspection locking or completion checks.

## 5. Report and delivery

Keep ONE inspection ID, one delivery workflow and one coherent report version.
Main-building content stays in the existing sections. Each additional building
gets its own named appendix with:

- Building name/category and included scope/limitations.
- Its own conditions and building facts, without main-building fallbacks.
- Exterior and interior findings, clearly located by building/floor/place.
- Note text, risk, further technical investigation and linked photos.
- Clear representation of what was included, not automatic "inspected" status.

The content and level of inspection must not be weakened merely because a building
is small or its result appears in an appendix. The appendices reuse OB data and
report mapping; they do not use the moisture-control tables.

Update BOTH live data builders and all relevant consumers together:

- Live HTML/review at `src/app/utlatande/[propertyId]/[inspectionId]/page.tsx`.
- `src/lib/report/pdfV2/buildReportDataV2.ts` and shared building-data mapping.
- Report spec, TOC, pagination and repeated building/place headings.
- Frozen snapshot, public links, internal print and structured PDF generation.
- Review completeness and pending counts across all included buildings.

Use structured building identity/labels rather than parsing concatenated headings.
Test identical room names, long text, multiple photos and multi-page appendices.

Capture all relevant data at a consistent root/structure revision and persist the
frozen payload under the same verified lock/version boundary. If anything changes
during preparation, retry or stop visibly; never deliver mixed revisions or omit a
building because its query failed. PDF generation then uses only the frozen payload.

Historical snapshots and already queued PDF jobs retain their original contract.
Add an explicit newer snapshot version if required by changed semantics; keep
existing readers. Never rebuild a delivered PDF from today's source register.

## 6. Existing inspections and safe activation

We do not need to keep every old editor working forever. We DO need to protect
the actual delivered documents and the user's ongoing work.

### Completed inspections

Before moving an old inspection to archive-only access:

- Verify its actual original PDF exists, is readable/downloadable and is associated
  with the correct inspection/report version. A URL or regeneratable preview is
  not evidence that the delivered file has been preserved.
- Retain PDF version, file reference and integrity metadata; verify an independent
  backup/restore path with access controls.
- If no verified original PDF exists, retain the legacy path and resolve that case
  explicitly. Do not silently generate a replacement and call it the original.
- Keep existing raw records and snapshots too. There is no reason to delete them.

### The ongoing inspection

Normal development and tests use synthetic/staging data. The real inspection can
remain in use until a scheduled activation pause; an earlier pause is not standing
authorization to modify it.

1. Agree a short pause on all devices; confirm no pending photos/text on the phone.
2. Take and verify a restricted backup of rows, references, storage files and report
   baselines. Never put private copied inspection data in Git or synthetic fixtures.
3. Preview the main building's mapping. Resolve ambiguous/orphaned records manually;
   do not infer physical identity from a name or the first existing building.
4. Under root lock and expected revision, link the existing main content to its
   building part and activate the scoped mode atomically.
5. Preserve room/note/image IDs, text, ordering, floor keys, file paths and capture
   provenance. Association metadata changes are deliberate and audited.
6. Preserve basement-rule history and existing floor mode; no automatic regeneration.
7. Compare before/after content hashes, counts, relationships and report findings.
   Exclude only documented association/audit changes from that comparison.
8. Add the extra building through the new normal command. Move existing records only
   when the user explicitly chooses their destination.
9. Resume work after verification. Delivered snapshots remain untouched.

There is no automatic mass conversion of old inspections.

## 7. Code findings that drive this plan

Evidence is from the repository, NOT a verification of installed production SQL.

| Finding | Source | Required response |
| --- | --- | --- |
| Property/building identities exist, but building creation seeds spaces in one UI path. | `src/types/supabase.ts`; `src/app/(app)/properties/[id]/page.tsx` | Reuse identities; do not call the room-seeding UI workflow. |
| Round reads are inspection-wide; Conditions upserts lack a building key. | `ObStepRunda.tsx`; `ObStepForutsattningar.tsx` | Shared scoped data/command layer and guarded index transition. |
| Main exterior observations have global uniqueness within an inspection. | `docs/db/2026-02-08_inspection_exterior_observations_is_free_note.sql` | Building-scoped uniqueness before storing another facade. |
| Floors and basement rules are inspection-scoped. | `docs/db/2026-09-11_03_ob_floor_model.sql`; `ObFloorProvider.tsx` | Preserve primary mode and introduce per-part authoritative configuration. |
| Image location/queues and remembered UI state lack building context. | `roundImageLocation.ts`; `roundImageUploadQueue.ts`; `ObMobileRound.tsx` | Capture scope at selection time; preserve legacy queue/draft recovery. |
| Latest round RPC already has owner/lock/pause/idempotency protection. | `docs/db/2026-09-11_07_ob_image_note_place.sql` | Extend these contracts; do not bypass them with an unguarded new endpoint. |
| Locks and report delivery address an inspection ID; a missing workflow is not inherited from a parent. | `2026-03-24_03_inspection_lock_write_guards.sql`; OB `report-delivery/route.ts` | No fake child inspection IDs for building workspaces. |
| Two report builders and several renderers group data separately. | Live report page, `buildReportDataV2.ts`, `buildingData.ts`, `reportSpec.ts` | Test live/frozen/PDF parity, not just the new screen. |
| TU/EB error cleanup deletes a property assumed newly created. | `src/lib/tu/server.ts`; `src/lib/eb/server.ts` | Do not globally switch these flows to reused properties now. Fix ownership-aware cleanup before later reuse. |
| `properties.owner` is used for inspector authorization. | Current round/assignment access paths | Do not equate it with owner-portal membership. |
| Generated types include legacy answer/selection tables not referenced by current UI code. | `inspection_control_answers`, `inspection_control_point_answers`, `inspection_exterior_selections`, `inspection_interior_observations` | Inventory installed records, FKs, grants and old writers before activation. |

No claim is made that current single-building use is inherently corrupt.
These dependencies explain why simply copying two pages is insufficient.

## 8. Implementation order and release gates

Each gate is required. A functional mockup is not an implemented feature.

### Gate 0: approval and database preflight

- Obtain explicit approval of this plan before code/SQL work resumes.
- Read installed constraints, indexes, FKs/cascades, triggers, grants and RLS.
- Check deployed migrations and all readers/writers against the reviewed code.
- Finalize the field-ownership manifest, legacy index transition and root revision
  capture protocol using the actual schema, not only generated types.
- Rehearse backup/restoration and prepare synthetic legacy/v2 fixtures.
- Treat a material contradiction as a plan amendment for approval, not silent
  permission to choose another architecture.

Exit: approved plan, verified design prerequisites, rehearsable rollout.

### Gate 1: additive storage and guarded commands, activation disabled

- Add building parts, structure metadata and scoped fields/configuration.
- Implement legacy/scoped resolution, explicit activation and register linking.
- Implement row-level revision checks, root locking, request receipts and recovery.
- Preserve source data and prevent ambiguous writes/foreign references.
- Migrate compatible OB write callers before replacing global unique indexes.
- Prove legacy and scoped uniqueness with the real index definitions.

Exit: authorization, transaction, stale-write, retry, rollback and old-client tests.

### Gate 2: complete OB editing experience

- Implement shared building overview and direct menu entries.
- Reuse Conditions and the current new round through the scoped layer.
- Complete floors, basement semantics, room/note moves, galleries, image bank,
  capture/import queues, linking/unlinking, delete/recovery, drafts and navigation.
- Prevent editable legacy fallbacks on activated inspections.
- Make inspection-wide unfinished work visible from Review and Pending.

Exit: all previously approved mobile controls work with same-named places in two
buildings, including real save/reload and network failures on disposable data.

### Gate 3: complete report chain

- Generate named appendices from the same scoped source data.
- Complete both live builders, snapshot capture, TOC, renderers and delivery.
- Verify main-building baselines and original frozen reports remain intact.

Exit: matching content in live preview, frozen snapshot and delivered PDF for one,
two and four buildings. Incomplete reads and concurrent changes fail safely.

### Gate 4: staging and deployment, production activation still disabled

- Rehearse additive migration, compatible code deployment, index/permission cutover
  and forward recovery against authenticated staging DB/storage.
- Refresh clients and test forgotten old tabs as well. A refresh instruction is
  not the only safety mechanism.
- Check ordinary single-building OB, apartment cases and shared TU/EB paths.
- Deploy only after separate rollout approval. Do not enable the real inspection
  just because the code is published.

Exit: synthetic authenticated end-to-end acceptance and operational sign-off.

### Gate 5: opt in the ongoing inspection

Follow section 6's explicit pause, backup, mapping and comparison procedure.
Begin with the main building unchanged, then add the extra building.

Exit: verified data/report parity, extra building editable and included in the
report, no unresolved loss/conflict, and the user can resume normal work.

## 9. Minimum acceptance matrix

| Scenario | Required result |
| --- | --- |
| One legacy building, never activated | Existing content and supported editing/reporting unchanged. |
| Activation of the current inspection | Same IDs, text, floors, file paths and main-building findings. |
| Main Plan 1 + extra Plan 0 | Independent floors, no renumbering or main-fact fallbacks. |
| Two/four buildings with Bathroom and Facade | Separate answers, notes, counts, galleries, order and report placement. |
| Same building in two OB events | Independent parts, drafts and frozen facts under one stable building ID. |
| Concurrent save/create/move or lost response | Conflict or one idempotent result; no duplicate register records or overwritten text. |
| Cross-building room/note/photo move | Explicit destination, children consistent, original capture context retained. |
| Camera selection followed by building switch | Entire batch keeps the original scope, including retry after reload. |
| Offline replay after parent removal | No resurrected note/room; recoverable file and actionable resolution. |
| Same overview item/floor in two buildings | No unique-key collision or shared local draft. |
| New basement category / previously removed room | Semantic once-per-building behavior, no regeneration on activation. |
| Old tab or direct write with missing scope | Rejected for activated OB; draft retained; no unrelated module regression. |
| Foreign property/building/part/org | Denied by server and DB, including guessed but valid IDs. |
| Early start, changed scope, paused/locked/completed root | Existing restrictions enforced on every new path and delivery. |
| Incomplete building read / change during report capture | Visible failure/retry, never a partial or mixed report. |
| Source building renamed/archived; future plan edited | Existing OB copy and delivered PDF unchanged. |
| Historic original PDF or queued old-version job | Still readable without current register data. |
| Long names, multi-page appendices, 320/390px and desktop | No overlapping controls/text; usable menu, dialogs, Back and swipe. |
| Occupied building removal / property cleanup | No cascade loss; denied or explicit controlled archival behavior. |
| No verified historic PDF | No automatic archive-only conversion. |

## 10. Rollback and limits

Disable new activation without deleting existing building parts or leaving them
editable only through an old client. Prefer a compatible forward fix.

Before any new edits, an activation can be reversed only through its audited,
per-inspection recovery procedure. After extra-building data exists, never merge
it into the main building or reset scoped IDs to NULL as a rollback shortcut.

Do not restore an entire shared production database to undo one inspection.
Recover only the intended scope, preserving unrelated concurrent work, audit and
stored files. Recovery must be rehearsed, not assumed.

The DB model has no two-building limit. Nevertheless, read only required building
data for editing, index by inspection/part, aggregate counts server-side and test
at least four buildings. Very large estates, cross-property inspections, per-building
independent deliveries and a general shared-land system are not this release.

## 11. Local implementation, 2026-09-12

The user approved implementation and the building-count/image refinement in chat.
The premature whole-building JSON drafts were removed/replaced. The current
implementation uses relational building parts and row-scoped writes.

Implemented locally:

- Additive schema, opt-in activation with a preview fingerprint, audit records,
  per-building conditions/floors and revision-checked service commands.
- Root owner/org/workflow/lock checks, scope/reference validation, retry receipts,
  and rejection of old unscoped clients after activation.
- Building list/count in Fastighet & uppdrag; explicit add, edit and empty-only
  removal; separate Conditions and new-round menu entries for every part.
- Building-specific text drafts, capture context and upload-queue metadata.
- Room/note moves with an explicit building destination; unplaced old photos
  remain visible for assignment. Image origin and files are preserved.
- Building images in Conditions. Primary-only legacy cover fallback; neither
  activation nor replacement deletes old cover files or references.
- Primary-only report queries and named extra-building appendices in the common
  report specification, HTML preview and captured report data. Snapshot revision
  checks reject an incomplete/outdated building report capture.
- Enrolled inspections use the complete report preview in Review, not the old
  unscoped embedded editors. Editing stays in the building-specific steps;
  non-enrolled inspections retain their existing review flow.

Local verification:

- 56 existing targeted OB tests plus 14 new SQL/client/API/report-contract tests.
- PGlite applies each new SQL file twice, with representative existing unique
  indexes. Tests cover four parts, legacy preservation, foreign/stale writes,
  locks/pause, cover isolation, cross-building room moves, origin preservation,
  empty-only removal and report capture revision guards.
- Synthetic browser checks exercise the production building controls at
  320/390/1280px, building creation and independent image upload. No live data.
- The full synthetic mobile-round browser suite passes: Back, swipes, drafts,
  room/note moves and removal, image linking/bank/preview, locked/paused states
  and the real legacy step menu. These do not replace authenticated multi-building
  end-to-end tests against staging.
- Rendered Review tests ensure enrolled inspections never mount legacy editors
  and that the non-enrolled editing flow is retained.
- Type checking still reports the four known pre-existing errors in
  `test/ob-drainage-building-data.test.ts` and `test/tu-workflow-profile.test.ts`.

NOT a production acceptance certificate. Still required before rollout:

- Review the installed PostgreSQL indexes, grants, policies and triggers using
  the read-only preflight file. Only REST schema metadata was checked so far.
- Authenticated staging tests with the actual schema and Storage policies,
  including offline recovery, simultaneous devices and large datasets.
- Building-cover retry currently survives only while its editor is mounted.
  Verify navigation/reload recovery before field rollout; ordinary round photos
  use the existing durable upload queue.
- Full multi-page HTML/PDF comparison, image completeness, queued PDF jobs and
  delivery/locking under concurrent edits. Report-spec tests alone do not prove
  those workflows or approve enabling multi-building delivery.
- Rehearse scoped backup/restore and verify existing original PDFs. No automatic
  archival conversion or production backup/restore has been performed.

No production SQL, deployment, activation, record/file changes, commit or push
was performed during this implementation. The SQL rollout flag remains false.
The local `/buildings` preview uses synthetic data; it is not a live inspection.

## 12. Approval checklist

- [x] Consolidate requirements into one OB-first design.
- [x] Document identity, access, snapshot and future import boundaries.
- [x] Recheck repository dependencies and define safety/release gates.
- [x] User explicitly approves this final plan.
- [ ] Installed DB preflight and implementation gates 1-3 complete.
- [ ] Authenticated staging, report/PDF and regression tests pass.
- [ ] Deployment approved separately.
- [ ] Activation pause and real-inspection conversion approved separately.

Local implementation is approved. Production release and activation are not.
