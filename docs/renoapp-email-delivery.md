# RenoApp invitation email delivery

Apply `docs/db/2026-09-07_01_renoapp_invite_message_id.sql` to retain the
Resend message id on invitations. Mail sending still succeeds if this optional
logging column has not been deployed; the server logs the id instead.

## Sender identity

New RenoApp emails use `RenoApp <meddelanden@renoapp.se>` by default. This
domain was verified in Resend on 2026-09-16. `RENOAPP_MAIL_FROM` is an optional
server-side override; missing or blank values use the default. RenoApp never
inherits `ASSIGNMENTS_MAIL_FROM`, which remains unchanged for other modules.
The existing `RESEND_API_KEY` must permit sending from `renoapp.se`.

This applies to applications, draft links, completion requests, decisions,
BRF onboarding/invitations, missing renovation-type feedback and new consultant
review orders. Existing consultant-review delivery payloads retain their saved
sender on retry so the payload and idempotency key remain consistent. Shared
Supabase authentication emails are configured separately and are not changed.

Onboarding mail retains the existing
RenoApp administrator contact `jn@hedbjorn.se` as Reply-To. Case messages retain
the BRF reply address, and feedback/review requests retain the sender's reply
address. `kontakt@renoapp.se` must not be used as Reply-To until receiving mail
has been configured and tested.

No database migration or new environment variable is required for this sender
change. It takes effect when the code is deployed; verify the API key's domain
scope and test delivery and received authentication headers before rollout.

## Email appearance

All newly generated RenoApp HTML emails, including renovation-type feedback,
use the shared `emailTemplate.ts` shell. It mirrors `renoapp-theme.css`: muted
blue buttons (#476786), blue-gray header (#eaf0f5), dark text (#293239), light
gray canvas (#f4f6f7) and restrained borders. The RenoApp wordmark is live text;
no external logo, tracking pixel or font download is required. Manrope is used
when available locally, with Arial as the email-compatible fallback.

The layout uses presentation tables, inline base styles, a 640px maximum width
and reduced padding on mobile. Primary actions use the common button with an
Outlook VML fallback. HTML buttons and plain-text links retain the same original
destination. Existing message text, subjects, recipients and Reply-To routing
are preserved; the shared brand header and sign-off now identify RenoApp first.
Existing saved consultant-review payloads are not restyled on retries.

Run `node scripts/preview-renoapp-emails.mjs` to generate synthetic HTML previews
under `tmp/renoapp-email-preview`; `--serve` provides an ephemeral localhost
preview. Browser previews do not replace a real Outlook/Gmail delivery test,
especially for Word-based Outlook rendering and client dark mode.

Operational checks (not configured by this code change):

- In Resend, verify that open and click tracking are disabled for transactional
  invitations. These are domain settings, so consider other mail before changing them.
- Use the recorded provider_message_id to inspect the message in Resend.
  `sent` means Resend accepted the send, not that Outlook placed it in the inbox.
  Delivery events are available in Resend; this change does not add a webhook.
- Compare the actual received message source, especially SFV, CAT and BCL,
  against a message received in the inbox. SPF/DKIM/DMARC PASS and SCL 1 alone
  do not explain final folder placement.
- Test an activation and personal invitation in Outlook, including with images
  disabled. Never paste personal invitation URLs into public diagnostic tools.
