-- Assignments core tables
-- Date: 2026-02-20
-- Scope:
-- 1) assignments
-- 2) assignment_links
-- 3) assignment_acceptances
-- 4) outbound_messages

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,

  status text not null default 'draft',
  assignment_type text not null default 'OB',

  responsible_profile_id uuid not null references public.profiles (id) on delete restrict,

  customer_name text,
  customer_email text not null,
  customer_phone text,

  preliminary_address text,
  preferred_date date,
  preferred_time time,
  price_amount numeric(12, 2),
  currency text not null default 'SEK',
  notes_internal text,

  property_address text,
  property_postal_code text,
  property_city text,
  cadastral_id text,

  invoice_name text,
  invoice_address text,
  orderer_role text,
  personal_identity_number text,

  terms_version text,
  accepted_at timestamptz,
  accepted_via_ip inet,
  accepted_user_agent text,

  property_id uuid references public.properties (id) on delete set null,
  inspection_id uuid references public.inspections (id) on delete set null,
  converted_at timestamptz,

  last_sent_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assignments_status_check
    check (status in ('draft', 'sent', 'booked', 'completed', 'expired', 'cancelled')),
  constraint assignments_type_check
    check (assignment_type in ('OB', 'STATUS', 'UHP')),
  constraint assignments_price_amount_check
    check (price_amount is null or price_amount >= 0),
  constraint assignments_accept_pair_check
    check (
      (accepted_at is null and terms_version is null)
      or (accepted_at is not null and terms_version is not null)
    ),
  constraint assignments_booked_requires_accept_check
    check (status <> 'booked' or accepted_at is not null),
  constraint assignments_completed_requires_conversion_check
    check (status <> 'completed' or converted_at is not null),
  constraint assignments_completed_requires_inspection_check
    check (status <> 'completed' or inspection_id is not null)
);

create unique index if not exists assignments_inspection_id_unique_idx
  on public.assignments (inspection_id)
  where inspection_id is not null;

create index if not exists assignments_org_id_idx
  on public.assignments (org_id);

create index if not exists assignments_status_idx
  on public.assignments (status);

create index if not exists assignments_org_status_date_idx
  on public.assignments (org_id, status, preferred_date asc nulls last, created_at desc);

create index if not exists assignments_responsible_profile_idx
  on public.assignments (responsible_profile_id);

create index if not exists assignments_customer_email_idx
  on public.assignments (customer_email);

create table if not exists public.assignment_links (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,

  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint assignment_links_token_hash_unique unique (token_hash),
  constraint assignment_links_token_hash_len_check check (char_length(token_hash) >= 32),
  constraint assignment_links_used_or_revoked_check
    check (not (used_at is not null and revoked_at is not null))
);

create unique index if not exists assignment_links_active_unique_idx
  on public.assignment_links (assignment_id)
  where used_at is null and revoked_at is null;

create index if not exists assignment_links_org_id_idx
  on public.assignment_links (org_id);

create index if not exists assignment_links_assignment_id_idx
  on public.assignment_links (assignment_id);

create index if not exists assignment_links_expires_at_idx
  on public.assignment_links (expires_at);

create table if not exists public.assignment_acceptances (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  assignment_link_id uuid references public.assignment_links (id) on delete set null,
  org_id uuid not null references public.organizations (id) on delete cascade,

  accepted_at timestamptz not null default now(),
  terms_version text not null,
  ip_address inet,
  user_agent text,
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists assignment_acceptances_org_id_idx
  on public.assignment_acceptances (org_id);

create index if not exists assignment_acceptances_assignment_id_idx
  on public.assignment_acceptances (assignment_id);

create index if not exists assignment_acceptances_accepted_at_idx
  on public.assignment_acceptances (accepted_at desc);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,

  channel text not null default 'email',
  recipient_email text not null,
  subject text not null,
  template_key text not null default 'assignment_confirmation',

  provider text,
  provider_message_id text,
  reply_to_email text,

  status text not null default 'pending',
  error_message text,
  sent_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint outbound_messages_channel_check check (channel in ('email')),
  constraint outbound_messages_status_check check (status in ('pending', 'sent', 'failed'))
);

create index if not exists outbound_messages_org_id_idx
  on public.outbound_messages (org_id);

create index if not exists outbound_messages_assignment_id_idx
  on public.outbound_messages (assignment_id);

create index if not exists outbound_messages_status_idx
  on public.outbound_messages (status);

create index if not exists outbound_messages_created_at_idx
  on public.outbound_messages (created_at desc);

create or replace function public.assignments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_assignments_set_updated_at on public.assignments;

create trigger trg_assignments_set_updated_at
before update on public.assignments
for each row
execute function public.assignments_set_updated_at();
