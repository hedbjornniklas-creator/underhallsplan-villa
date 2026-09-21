-- Allow TU to resend an existing public report link without changing its token.
-- Older links have no ciphertext and remain active during their one-time replacement.

alter table public.inspection_report_links
  add column if not exists tu_token_ciphertext text;

comment on column public.inspection_report_links.tu_token_ciphertext is
  'Server-encrypted TU public link token. Never include this value in report snapshots or list responses.';
