begin;

alter table public.eb_inspection_details
  add column if not exists invoice_recipient_matches_client boolean,
  add column if not exists invoice_name text,
  add column if not exists invoice_org_no text,
  add column if not exists invoice_reference text,
  add column if not exists invoice_email_matches_client boolean,
  add column if not exists invoice_email text,
  add column if not exists invoice_address_matches_client boolean,
  add column if not exists invoice_address text,
  add column if not exists invoice_postal_code text,
  add column if not exists invoice_city text;

update public.eb_inspection_details as detail
set
  invoice_recipient_matches_client = coalesce(
    detail.invoice_recipient_matches_client,
    project.invoice_recipient_matches_client,
    true
  ),
  invoice_name = coalesce(detail.invoice_name, project.invoice_name, project.client_name),
  invoice_org_no = coalesce(detail.invoice_org_no, project.invoice_org_no, project.client_org_no),
  invoice_reference = coalesce(detail.invoice_reference, project.invoice_reference),
  invoice_email_matches_client = coalesce(
    detail.invoice_email_matches_client,
    project.invoice_email_matches_client,
    true
  ),
  invoice_email = coalesce(detail.invoice_email, project.invoice_email, project.client_email),
  invoice_address_matches_client = coalesce(
    detail.invoice_address_matches_client,
    project.invoice_address_matches_client,
    true
  ),
  invoice_address = coalesce(detail.invoice_address, project.invoice_address, project.client_address),
  invoice_postal_code = coalesce(
    detail.invoice_postal_code,
    project.invoice_postal_code,
    project.client_postal_code
  ),
  invoice_city = coalesce(detail.invoice_city, project.invoice_city, project.client_city)
from public.eb_projects as project
where project.id = detail.eb_project_id;

update public.eb_inspection_details
set
  invoice_recipient_matches_client = coalesce(invoice_recipient_matches_client, true),
  invoice_email_matches_client = coalesce(invoice_email_matches_client, true),
  invoice_address_matches_client = coalesce(invoice_address_matches_client, true);

alter table public.eb_inspection_details
  alter column invoice_recipient_matches_client set default true,
  alter column invoice_recipient_matches_client set not null,
  alter column invoice_email_matches_client set default true,
  alter column invoice_email_matches_client set not null,
  alter column invoice_address_matches_client set default true,
  alter column invoice_address_matches_client set not null;

comment on column public.eb_inspection_details.invoice_name is
  'Fakturamottagare för den enskilda besiktningen.';
comment on column public.eb_inspection_details.invoice_reference is
  'Fakturareferens för den enskilda besiktningen.';

alter table public.eb_remediation_access_links
  add column if not exists inspection_id uuid references public.inspections (id) on delete cascade;

create index if not exists eb_remediation_access_links_inspection_idx
  on public.eb_remediation_access_links (inspection_id, role, created_at desc)
  where inspection_id is not null;

comment on column public.eb_remediation_access_links.inspection_id is
  'Avgränsar nya åtgärdsportallänkar till en enskild besiktning. Null innebär äldre projektomfattande länk.';

commit;
