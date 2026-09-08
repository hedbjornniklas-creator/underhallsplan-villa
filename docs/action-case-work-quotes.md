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

## Delivery and Access

Quotes and immutable outbound mail payloads are service-role-only. API operations retain the existing authenticated organization and module-access checks. Quote selection, covered cost rows and recalculation are transactional, locking the parent action first.

Only explicitly selected files from the same organization and case are attached, with a combined 5 MB cap. Registered subcontractor quote documents cannot be attached to a request. Sending does not grant portal access or alter other sharing. Users must check selected files in the preview; the system cannot identify sensitive content in unclassified documents.

The first send freezes the exact message and attachment bytes. A stable provider idempotency key is reused on retries. A lease blocks simultaneous sends; uncertain results remain visible and retryable. After 23 hours an uncertain request requires administrator verification instead of an automatic new send, keeping retries inside [Resend's documented 24-hour retention window](https://resend.com/docs/dashboard/emails/idempotency-keys). Inspect the provider log using the stable `action-case-rfq-<quote-id>` key before deciding whether a new request is appropriate. Never clear the recorded payload simply to retry. Sent requests cannot be edited or deleted through the quote workflow.

## Verification

Run:

```sh
node --test test/action-cases-domain.test.mjs test/action-cases-costing.test.mjs test/action-cases-costing-ai.test.mjs test/action-cases-quotes.test.mjs test/action-cases-quotes-mail.test.mjs
node scripts/test-action-case-costing-ui.mjs
npx tsc --noEmit --incremental false
npm run build
```

SQL tests execute the migrations using PGlite. UI tests use synthetic data at desktop and mobile widths. Mail tests mock the existing mailer; they do not send any email. Verify real delivery to an approved test recipient in staging before enabling production sending.
