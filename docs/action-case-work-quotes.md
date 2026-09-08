# Work Pricing and Subcontractor Quotes

## Deployment

Apply `docs/db/2026-09-08_05_action_case_work_quotes.sql` after action-case migrations 01 through 04, then deploy the app. The migration is transactional and rerunnable. Existing cost lines keep direct pricing; it does not change existing file grants, participant links, TU or EB reports.

The workspace remains readable before migration 05, but quote writes require it. Do not roll the app back to a version that ignores quote-covered cost rows once this feature is in use. A code rollback must retain the quote-aware calculation helpers.

Email uses the existing assignment mailer and its `RESEND_API_KEY`, `ASSIGNMENTS_MAIL_FROM` and optional `RESEND_REQUEST_TIMEOUT_MS`. The acting user's profile email is used as Reply-To. No migration or application deployment sends mail automatically.

## Workflow

- Open an action and its calculation. Work rows support direct quantities / hourly cost or quote alternatives.
- Switching to quotes preserves the direct calculation. Switching back restores it, including markup. Quotes remain available.
- Record an offer or prepare a request. Saving a request does not send it. Sending requires an explicit click in a preview displaying recipient, message and selected attachments.
- Replies arrive by email. Register the received amount, scope and conditions; optionally link an existing document from the case. Automatic mailbox ingestion and AI extraction from quotation documents are not implemented.
- Check an offer, then select it for the calculation. This is not an order to the subcontractor. Exactly one offer per work row contributes to cost and markup.
- Explicitly select material / transport / waste rows already covered by the offer. Those rows remain visible but are excluded from totals. They cannot belong to two selected offers or be edited / deleted while covered.
- Editing a selected offer clears its selection. A changed work scope / description or expired validity invalidates use of the old offer. Register a newly confirmed offer against the current scope.

## Grouped Requests

Apply `docs/db/2026-09-08_09_action_case_grouped_requests.sql` after 01 through 05 before deploying the grouped-request feature. It is transactional and rerunnable. Existing single-row requests remain in place, without backfill or changes to their delivery history or prices. The workspace remains readable without migration 09; grouped writes require it.

- Use **Begär offert** on the case, or on a work row to preselect that row. Select work rows across the case's actions, one UE recipient, requested inclusions and attachments.
- Attachment selection shows lazy-loaded image thumbnails. Clicking a thumbnail opens the shared case image viewer without changing the selection. The viewer allows browsing, opening the original and toggling whether a picture is attached. Documents remain selectable rows with an open link. This also applies to the legacy single-row request form; file authorization and outbound attachment rules are unchanged.
- Nothing is checked by default. Choices cover travel, materials, own waste, protection, establishment, tools, lift/scaffolding, freight, cleaning and documentation. ÄTA rates are requested separately, not treated as included fixed-price work. Other requirements are free text.
- **Spara och förhandsgranska** creates a resumable draft, not a send. **Skicka förfrågan** sends one email for all selected rows. The saved request contains frozen source text, requirement wording and recipient details.
- Sending creates linked quote alternatives on the selected work rows. It neither switches an hourly calculation to quotes nor assumes that requested items are actually included. Confirm inclusions when registering the received quote.
- For several work rows, register whether UE's prices apply independently or only as a package. Until independent prices are confirmed, the linked alternatives cannot be selected separately in calculations. A single-row request has no multi-row dependency.
- Package amounts and shared conditions can be recorded for reference. They are **not automatically allocated to actions or counted in the calculation**. Obtain confirmed independent prices before using delpriser, and register shared costs once through the existing cost rows. Switching back to package/unknown conditions clears selected linked prices and releases their covered rows.
- Register per-work prices via **Öppna kalkyl**, using the existing **Offerter** view. Existing manual quotation alternatives and direct hourly pricing continue to work.
- **Komplettera** creates a new draft linked to the old request, for the same recipient. Previously sent work is not preselected. The old email, source snapshot and prices are not overwritten.

Grouped sends reuse the existing mailer, selected-file validation, payload freezing and bounded idempotent retry mechanism. Their provider key is `action-case-group-rfq-<request-id>`. A retry of an uncertain send retains its original content even if work has since changed. New scope requires a new request or supplement. Registered response documents are excluded from outbound requests, including older single-row requests.

## Delivery and Access

Quotes and immutable outbound mail payloads are service-role-only. API operations retain the existing authenticated organization and module-access checks. Quote selection, covered cost rows and recalculation are transactional, locking the parent action first.

Only explicitly selected files from the same organization and case are attached, with a combined 5 MB cap. Registered subcontractor quote documents cannot be attached to a request. Sending does not grant portal access or alter other sharing. Users must check selected files in the preview; the system cannot identify sensitive content in unclassified documents.

The first send freezes the exact message and attachment bytes. A stable provider idempotency key is reused on retries. A lease blocks simultaneous sends; uncertain results remain visible and retryable. After 23 hours an uncertain request requires administrator verification instead of an automatic new send, keeping retries inside [Resend's documented 24-hour retention window](https://resend.com/docs/dashboard/emails/idempotency-keys). Inspect the provider log using the stable `action-case-rfq-<quote-id>` key before deciding whether a new request is appropriate. Never clear the recorded payload simply to retry. Sent requests cannot be edited or deleted through the quote workflow.

## Verification

Run:

```sh
node --test test/action-cases-domain.test.mjs test/action-cases-costing.test.mjs test/action-cases-costing-ai.test.mjs test/action-cases-quotes.test.mjs test/action-cases-quotes-mail.test.mjs test/action-cases-grouped-requests.test.mjs
node scripts/test-action-case-costing-ui.mjs
npx tsc --noEmit --incremental false
npm run build
```

SQL tests execute the migrations using PGlite. UI tests use synthetic data at desktop and mobile widths. Mail tests mock the existing mailer; they do not send any email. Verify real delivery to an approved test recipient in staging before enabling production sending.
