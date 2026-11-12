# Gizmo Navigation Performance

## Scope (2026-11-12)

Reduce waits when opening the project list, opening a project and returning to
its overview. No schema changes, financial writes, changes to autosaving or
changes to signed/locked documents.

## Implementation

- Task and project workspace reads overlap after module authorization.
- Project people, organization and branding reads overlap the project workspace
  read. Offer loading still waits for the authorized project to exist.
- Offer/contract workspace reads overlap only after its organization-scoped
  project lookup. Draft normalization, legacy schema fallbacks, frozen versions,
  selected sender validation and private planning remain unchanged.
- Contract-work lock reads overlap the independent work data reads. A lock-read
  failure still rejects the workspace; it never produces an editable fallback.
- Quote and attachment-grant reads overlap after their prerequisites are known.
- The mounted overview retains successful question/schedule reads for 30 seconds
  across tab changes. This is component-local state, not a shared server cache.
  Expired data refreshes in the background. Project/refresh-key changes and
  manual refresh invalidate immediately. Failed reads clear the affected data;
  cancelled reads cannot refill it. A failed result is never marked fresh.
  Local question/schedule edits invalidate even while the overview is hidden;
  reloading waits for the local write to settle rather than reading before save.
  Successful question reads (including after autosave) and subsequent schedule
  save/read callbacks invalidate only the overview, not the source editor. This
  also covers locally recovered question drafts that do not block navigation.
- Existing editors stay mounted, retaining their draft/upload/autosave behavior.
  Server authorization, write revisions and contract locks are never cached.

## Verification

- Controlled before/after offer-workspace benchmark against commit
  `b364ff0eb3257847713a9dc4bc91651bd98b36f7`: fictional data, eight database
  reads with 30 ms simulated latency each, median of three runs. Before: 268 ms;
  after: 99 ms. Results were deeply equal; both used eight reads and zero writes.
  This is not a production page-load measurement or a promised speedup.
- Controlled-promise tests verify read overlap, authorization order, missing
  projects, legacy costing and fail-closed contract locks.
- Overview hook tests verify rapid return, background refresh, access/read
  failure, retry, changed project/access keys, cancellation and manual refresh.
- Chrome click test with fictional local data and 1.2-second simulated reads:
  returning to the overview did not repeat question/schedule requests or show
  a new loading screen. A failed refresh displayed a warning and retry restored
  the overview. No real project was modified or sent.
- Production Webpack build and TypeScript checks passed.
- Final `test/action-cases*.test.*` regression selection: 1,078 passed, zero
  failures. The broader selection that also includes singular
  `action-case*` test filenames has the existing failures described below.

The wider test selection also exposes two pre-existing sender-profile UI-test
failures in `test/action-case-sender-profile-ui.test.ts`. That test and the
contractor/offer-editor implementations it fails on are unchanged. Keep those separate from the
navigation work; do not report the entire repository suite as passing.

## Remaining Work

Measure actual production navigation after an authorized deployment. Further
potential work includes a lighter project-list data projection and splitting
the large project editor bundle. Those require separate validation of derived
statuses and cross-editor synchronization; they are not implemented here.

Deployment and live verification are recorded separately from these local checks.
