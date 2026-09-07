# RenoApp invitation email delivery

Apply `docs/db/2026-09-07_01_renoapp_invite_message_id.sql` to retain the
Resend message id on invitations. Mail sending still succeeds if this optional
logging column has not been deployed; the server logs the id instead.

Onboarding mail uses the configured `ASSIGNMENTS_MAIL_FROM` and the existing
RenoApp administrator contact `jn@hedbjorn.se` as Reply-To. The shared HTML
template includes text branding and requires no external images. Both activation
and personal invitation emails have an Outlook-compatible action button; the
plain-text version retains the full personal URL.

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
