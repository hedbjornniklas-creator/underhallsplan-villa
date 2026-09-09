# Coherent Quote Packages

## Migration And Compatibility

Apply `db/2026-09-09_04_action_case_package_pricing.sql` after the existing costing,
work-quote and grouped-request migrations. When work parts are installed, apply
their `2026-09-09_03` migration first. Package pricing also works without work
parts; rerun its migration after subsequently installing work parts to attach
the scope guard. The migration is repeatable.

Existing request rows receive `price_presentation = 'itemized'`; no saved body,
source snapshot, email payload, response, or cost is rewritten. Only new requests
default to `grouped`. Deploy the migration before writers; readers on an older
schema must retry their legacy column list when `price_presentation` is absent.
Never rebuild a sent request body for display or retry. Render its stored `body`.

## Request Domain

`quoteRequests.ts` exports `PricePresentation`, `PackageRequestLine`,
`PackageQuoteRequest`, `QuoteRequestGroup`, `groupRequestLines`, `requestSources`,
`normalizeQuoteRequest`, `buildQuoteRequestBody`, and `mapQuoteRequest`.

Groups use the stable key `${itemId}:${workPartId ?? ''}`. The generated body
collects interleaved groups, presents the action scope once, and the part scope
once. Only the listed work and selected requirements are requested. Internal
costs, margins, verification metadata, and original pricing are not serialized.
New requests include explicit null work-part identity for unassigned rows.

Save and first-send verify the selected lines, action scope/title, and optional
part identity/title/scope against tenant-scoped database sources. Subsequent send
attempts retain the original immutable email payload. Itemized response selection
also validates work-part snapshots, including legacy unassigned snapshots.

## Group Price API

Route an authenticated, authorized internal action to
`handleQuotePackageAction(context, payload)` in `quotePackagesServer.ts`.
`context` supplies trusted `orgId` and `userId`; never take these from form data.
The handler calls the service-role-only `write_action_case_quote_package` RPC.

Accept payload (`QuotePackageAction`):

```ts
{
  operation: 'accept',
  caseId,
  requestId,
  groupKey: group.key,
  expectedUpdatedAt: request.updatedAt,
  amount: 25000, // SEK excluding VAT, at most two decimal places; zero is valid
  offeredScope: 'Reviewed supplier scope for the listed group work',
  checked: true,
  separateGroupPriceConfirmed: true,
  expectedLines: [{ costLineId, updatedAt }],
  coveredLineIds: [],
  validUntil: null
}
```

`expectedLines` must contain every requested work row in that group and every
explicit additional covered row, exactly once, using current raw timestamp
strings (preserve database microseconds). `coveredLineIds` contains only extra
material/waste/transport/other rows in the same action, either unassigned or
assigned to the selected part (never another named part).
Those selections explicitly confirm inclusion in the reviewed group amount;
request requirements do not implicitly cover any costing row. All requested work
rows in the chosen group are covered automatically, regardless of row count.

The request must have been sent. Independent group prices may be registered
directly without first editing the request-wide response. A multi-group request
requires `separateGroupPriceConfirmed: true`, meaning the supplier confirmed that
this group price stands on its own. A conditional whole-request package cannot
be accepted by inventing per-group allocations. There is no allocation engine.
For a single-group request with a saved package response, the accepted amount
must equal its saved `packageAmount`.

Remove payload:

```ts
{ operation: 'remove', caseId, requestId, groupKey, expectedUpdatedAt: request.updatedAt }
```

Both operations return `{ requestId, groupKey, quoteId, state, updatedAt }`.
The returned timestamp is the new REQUEST version. Refresh the workspace after
success or a stale error. Editing a response requires removing all active groups
first. Replacing a group price requires remove, refresh, then accept; it never
overwrites an existing restoration basis. Both operations require draft case and
item statuses, consistent with work-part costing operations.

## Read Model And UI

Read `action_case_quote_packages` with tenant/case filters using
`PACKAGE_VIEW_COLUMNS`, then `mapQuotePackage` from `quotePackages.ts`. Each
`QuotePackageView` contains:

```ts
{ requestId, groupKey, quoteId, anchorLineId, itemId, workPartId,
  amount, coveredLineIds, state: 'active' | 'removed', updatedAt }
```

This `updatedAt` belongs to the PACKAGE row, not the request concurrency token.
There is one row per `(request_id, group_key)`. Do not expose `original_lines`.
Use `groupRequestLines(request.lines)` for selectors and
`packageAcceptanceBlockReason(lines, groupKey, confirmation)` for a preliminary
multi-group reason; database validation remains authoritative.

Derived `action_case_work_quotes` have `package_request_id` set and `request_id`
null. Include and map `package_request_id` as `packageRequestId`. Only expose
derived quotes referenced by ACTIVE package views; removed historical derived
quotes remain protected audit records, never selectable alternatives. Normal
edit/select/unselect/send/delete controls must be hidden for derived quotes; use
the package API. The existing loader can price the anchor normally because the
derived quote is not an itemized response from the grouped request. Secondary
covered work rows are temporarily direct-priced so missing per-row quotes do not
invalidate the group. Existing covered-row filtering excludes them from totals.

Errors to present explicitly: `ACTION_CASE_PACKAGE_ALLOCATION_REQUIRED`,
`GROUP_NOT_FOUND`, `REMOVE_FIRST`, `CONFLICT`, `STALE`, `AMOUNT_MISMATCH`,
`UNCHECKED`, `NOT_ACCEPTED`, `RESPONSE_REQUIRED`, `USE_RPC`, and `INVALID` (all
with the `ACTION_CASE_PACKAGE_` prefix); also `ACTION_CASE_QUOTE_STALE`,
`ACTION_CASE_ITEM_LOCKED`, and `ACTION_CASES_SCHEMA_REQUIRED`.

## Safety And Verification

One selected anchor contains the complete group amount; every other included
row is covered exactly once. The anchor's existing markup/VAT policy is used,
not a sum of the old rows' markups. Every original row is retained server-side.
On removal the final cost-line trigger restores the entire original record after
legacy quote-price derivation, retaining only fresh `updated_at`/`updated_by`.
This includes pending quote mode, direct-pricing basis, quantities, prices,
verification, provenance, notes, ordering, and work-part identity.

The RPC locks items in ID order, then the case, request, package and contributing
lines. Mandatory request/line versions are checked after locking. Intermediate
`applying`/`removing` states exist only inside the transaction; any failure rolls
everything back. Ordinary writes cannot alter active contributing rows, selected
derived quotes, action scope/title, or part scope/title. No session flags or
client-writable bypass switches are used. Whole-case cascades remain possible.

Focused tests: `node --experimental-strip-types --test test/action-cases-packages.test.mjs`.
PGlite exercises upgrade/reapplication with and without work parts, independent
groups, exact restoration, stale secondary sources, rollback injection, denied
roles, tenant isolation, draft locks, and competing stale requests. PGlite uses a
single connection, so the competing-request test verifies version/replay
semantics, not a multi-connection PostgreSQL deadlock stress test. No production
database or outbound email is used.
