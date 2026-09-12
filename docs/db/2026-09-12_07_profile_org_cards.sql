-- Organization-specific inspector business cards
-- Date: 2026-09-12
-- Scope:
-- 1) One business card per organization + profile
-- 2) Own-card editing for active members
-- 3) Organization-admin management
-- 4) Safe legacy backfill to only one home organization per profile
--
-- Prerequisites:
-- - 2026-02-20_01_assignments_org_foundation.sql
-- - 2026-02-20_03_assignments_rls.sql
-- - 2026-05-30_01_profile_signature_image.sql
-- - 2026-09-09_05_fortnox_connection_foundation.sql

begin;

set local lock_timeout = '10s';

create extension if not exists pgcrypto;

-- Freeze who represents the organization on each TU investigation. Existing
-- unlocked investigations inherit the assignment's responsible inspector, or
-- their original creator when the investigation was created without an
-- assignment. Already locked legacy reports keep this null: their immutable
-- report snapshot is authoritative and must not be re-attributed afterwards.
alter table public.technical_investigation_details
  add column if not exists inspector_profile_id uuid
    references public.profiles (id)
    on delete set null;

update public.technical_investigation_details as detail
set inspector_profile_id = coalesce(assignment.responsible_profile_id, detail.created_by)
from public.assignments as assignment
where detail.assignment_id = assignment.id
  and assignment.org_id = detail.org_id
  and detail.report_locked_at is null
  and coalesce(assignment.responsible_profile_id, detail.created_by) is not null
  and exists (
    select 1
    from public.org_members as member
    where member.org_id = detail.org_id
      and member.profile_id = coalesce(assignment.responsible_profile_id, detail.created_by)
      and member.is_active
  )
  and detail.inspector_profile_id is null;

update public.technical_investigation_details as detail
set inspector_profile_id = created_by
where inspector_profile_id is null
  and detail.report_locked_at is null
  and created_by is not null
  and exists (
    select 1
    from public.org_members as member
    where member.org_id = detail.org_id
      and member.profile_id = detail.created_by
      and member.is_active
  );

create index if not exists technical_investigation_details_inspector_idx
  on public.technical_investigation_details (org_id, inspector_profile_id)
  where inspector_profile_id is not null;

comment on column public.technical_investigation_details.inspector_profile_id is
  'Inspector identity selected for this TU investigation; never inferred from the current viewer.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.technical_investigation_details'::regclass
      and conname = 'technical_investigation_details_inspector_membership_fkey'
  ) then
    alter table public.technical_investigation_details
      add constraint technical_investigation_details_inspector_membership_fkey
      foreign key (org_id, inspector_profile_id)
      references public.org_members (org_id, profile_id)
      not valid;
  end if;
end
$$;

alter table public.technical_investigation_details
  validate constraint technical_investigation_details_inspector_membership_fkey;

-- Every newly issued TU assignment link carries immutable issuer identity.
-- Other assignment modules may keep these columns null until they adopt the
-- same snapshot contract.
alter table public.assignment_links
  add column if not exists issuer_snapshot_schema_version text,
  add column if not exists issuer_identity_snapshot jsonb;

-- A public link must never join an assignment from another organization. The
-- redundant pair index gives PostgreSQL a composite candidate key while the
-- existing assignments primary key remains unchanged.
create unique index if not exists assignments_org_id_id_unique_idx
  on public.assignments (org_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assignment_links'::regclass
      and conname = 'assignment_links_org_assignment_fkey'
  ) then
    alter table public.assignment_links
      add constraint assignment_links_org_assignment_fkey
      foreign key (org_id, assignment_id)
      references public.assignments (org_id, id)
      on delete cascade
      not valid;
  end if;
end
$$;

-- NOT VALID makes the invariant effective for new writes immediately. The
-- explicit validation also refuses deployment if inconsistent legacy links
-- exist, so they can never silently remain reachable through the public API.
alter table public.assignment_links
  validate constraint assignment_links_org_assignment_fkey;

-- Assignment links are issued and revoked only by server-side service-role
-- code. Direct member writes could otherwise forge an issuer snapshot.
revoke insert, update, delete on table public.assignment_links
  from anon, authenticated;
grant select, insert, update, delete on table public.assignment_links
  to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assignment_links'::regclass
      and conname = 'assignment_links_issuer_snapshot_check'
  ) then
    alter table public.assignment_links
      add constraint assignment_links_issuer_snapshot_check
      check (
        (
          issuer_snapshot_schema_version is null
          and issuer_identity_snapshot is null
        )
        or (
          issuer_snapshot_schema_version = 'assignment_issuer_v1'
          and issuer_identity_snapshot is not null
          and jsonb_typeof(issuer_identity_snapshot) = 'object'
        )
      );
  end if;
end
$$;

comment on column public.assignment_links.issuer_identity_snapshot is
  'Immutable organization and inspector identity shown by this issued assignment link.';

create or replace function public.assignment_links_protect_issuer_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.issuer_snapshot_schema_version is distinct from old.issuer_snapshot_schema_version
    or new.issuer_identity_snapshot is distinct from old.issuer_identity_snapshot then
    raise exception 'Assignment issuer identity is immutable after issue.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assignment_links_protect_issuer_snapshot
  on public.assignment_links;

create trigger trg_assignment_links_protect_issuer_snapshot
before update of issuer_snapshot_schema_version, issuer_identity_snapshot
on public.assignment_links
for each row
execute function public.assignment_links_protect_issuer_snapshot();

create table if not exists public.profile_org_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null
    references public.organizations (id)
    on delete cascade,
  profile_id uuid not null
    references public.profiles (id)
    on delete cascade,

  display_name text not null,
  title text,
  phone text,
  email text,
  company_name text not null,
  company_orgno text,
  company_address text,
  company_postal_code text,
  company_city text,
  avatar_path text,
  logo_path text,
  signature_path text,
  report_footer_text text,

  version bigint not null default 1,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_org_cards_org_profile_key
    unique (org_id, profile_id),
  constraint profile_org_cards_membership_fkey
    foreign key (org_id, profile_id)
    references public.org_members (org_id, profile_id)
    on delete cascade,
  constraint profile_org_cards_display_name_check
    check (char_length(btrim(display_name)) between 1 and 200),
  constraint profile_org_cards_title_check
    check (title is null or char_length(title) <= 160),
  constraint profile_org_cards_phone_check
    check (phone is null or char_length(phone) <= 80),
  constraint profile_org_cards_email_check
    check (
      email is null
      or (
        char_length(email) between 3 and 320
        and email !~ '[[:space:]]'
        and position('@' in email) > 1
      )
    ),
  constraint profile_org_cards_company_name_check
    check (char_length(btrim(company_name)) between 1 and 240),
  constraint profile_org_cards_company_orgno_check
    check (
      company_orgno is null
      or public.is_valid_swedish_organization_number(company_orgno)
    ),
  constraint profile_org_cards_company_address_check
    check (company_address is null or char_length(company_address) <= 300),
  constraint profile_org_cards_company_postal_code_check
    check (company_postal_code is null or char_length(company_postal_code) <= 40),
  constraint profile_org_cards_company_city_check
    check (company_city is null or char_length(company_city) <= 160),
  constraint profile_org_cards_avatar_path_check
    check (avatar_path is null or char_length(avatar_path) <= 2048),
  constraint profile_org_cards_logo_path_check
    check (logo_path is null or char_length(logo_path) <= 2048),
  constraint profile_org_cards_signature_path_check
    check (signature_path is null or char_length(signature_path) <= 2048),
  constraint profile_org_cards_report_footer_check
    check (report_footer_text is null or char_length(report_footer_text) <= 2000),
  constraint profile_org_cards_version_check
    check (version > 0)
);

comment on table public.profile_org_cards is
  'Organization-specific inspector identity and report branding.';

comment on column public.profile_org_cards.company_orgno is
  'Swedish organization number in canonical XXXXXX-XXXX form.';

comment on column public.profile_org_cards.report_footer_text is
  'Optional plain-text organization-specific report footer.';

create index if not exists profile_org_cards_profile_org_idx
  on public.profile_org_cards (profile_id, org_id);

create or replace function public.profile_org_cards_prepare_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  actor_profile_id uuid := auth.uid();
begin
  new.display_name := btrim(new.display_name);
  new.title := nullif(btrim(new.title), '');
  new.phone := nullif(btrim(new.phone), '');
  new.email := lower(nullif(btrim(new.email), ''));
  new.company_name := btrim(new.company_name);
  new.company_orgno := nullif(btrim(new.company_orgno), '');
  new.company_address := nullif(btrim(new.company_address), '');
  new.company_postal_code := nullif(btrim(new.company_postal_code), '');
  new.company_city := nullif(btrim(new.company_city), '');
  new.avatar_path := nullif(btrim(new.avatar_path), '');
  new.logo_path := nullif(btrim(new.logo_path), '');
  new.signature_path := nullif(btrim(new.signature_path), '');
  new.report_footer_text := nullif(btrim(new.report_footer_text), '');

  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    if actor_profile_id is not null then
      new.created_by_profile_id := actor_profile_id;
      new.updated_by_profile_id := actor_profile_id;
    end if;
  else
    if new.id is distinct from old.id
      or new.org_id is distinct from old.org_id
      or new.profile_id is distinct from old.profile_id then
      raise exception 'Profile organization card identity is immutable.'
        using errcode = '22023';
    end if;

    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.version := old.version + 1;
    if actor_profile_id is not null then
      new.updated_by_profile_id := actor_profile_id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profile_org_cards_prepare_write
  on public.profile_org_cards;

create trigger trg_profile_org_cards_prepare_write
before insert or update on public.profile_org_cards
for each row
execute function public.profile_org_cards_prepare_write();

-- Copy legacy data to at most one home organization per profile. Additional
-- organizations must be configured explicitly so the wrong company identity
-- can never be copied silently into their documents.
with membership_stats as (
  select
    member.*,
    count(*) filter (where member.is_active)
      over (partition by member.profile_id) as active_membership_count
  from public.org_members as member
),
legacy_candidates as (
  select
    candidate.*,
    row_number() over (
      partition by candidate.profile_id
      order by
        candidate.is_default desc,
        candidate.is_active desc,
        candidate.created_at asc,
        candidate.org_id asc
    ) as candidate_rank
  from membership_stats as candidate
  where candidate.is_active
    and (candidate.is_default or candidate.active_membership_count = 1)
)
insert into public.profile_org_cards (
  org_id,
  profile_id,
  display_name,
  title,
  phone,
  email,
  company_name,
  company_orgno,
  company_address,
  company_postal_code,
  company_city,
  avatar_path,
  logo_path,
  signature_path,
  report_footer_text,
  created_by_profile_id,
  updated_by_profile_id
)
select
  membership.org_id,
  membership.profile_id,
  left(
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(profile.email), ''),
      'Besiktningsman'
    ),
    200
  ),
  null,
  left(nullif(btrim(profile.phone), ''), 80),
  case
    when char_length(btrim(profile.email)) between 3 and 320
      and btrim(profile.email) !~ '[[:space:]]'
      and position('@' in btrim(profile.email)) > 1
      then lower(btrim(profile.email))
    else null
  end,
  left(
    coalesce(
      nullif(btrim(profile.company_name), ''),
      nullif(btrim(organization.name), ''),
      'Organisation'
    ),
    240
  ),
  case
    when organization.organization_number is not null
      then organization.organization_number
    when public.is_valid_swedish_organization_number(
      nullif(btrim(profile.company_orgno), '')
    )
      then btrim(profile.company_orgno)
    else null
  end,
  left(nullif(btrim(profile.company_address), ''), 300),
  left(nullif(btrim(profile.company_postal_code), ''), 40),
  left(nullif(btrim(profile.company_city), ''), 160),
  -- Legacy media paths may be overwritten by the old global profile editor.
  -- Leave them empty so each organization adopts immutable UUID media paths
  -- through the new editor before those assets are used in frozen documents.
  null,
  null,
  null,
  null,
  membership.profile_id,
  membership.profile_id
from legacy_candidates as membership
join public.profiles as profile
  on profile.id = membership.profile_id
join public.organizations as organization
  on organization.id = membership.org_id
where membership.candidate_rank = 1
on conflict (org_id, profile_id) do nothing;

alter table public.profile_org_cards enable row level security;
alter table public.profile_org_cards force row level security;

revoke all on table public.profile_org_cards from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_org_cards to authenticated;
grant select, insert, update, delete on table public.profile_org_cards to service_role;

drop policy if exists profile_org_cards_select_own_or_admin
  on public.profile_org_cards;
create policy profile_org_cards_select_own_or_admin
  on public.profile_org_cards
  for select
  to authenticated
  using (
    (profile_id = auth.uid() and public.is_org_member(org_id))
    or public.is_org_admin(org_id)
  );

drop policy if exists profile_org_cards_insert_own_or_admin
  on public.profile_org_cards;
create policy profile_org_cards_insert_own_or_admin
  on public.profile_org_cards
  for insert
  to authenticated
  with check (
    (profile_id = auth.uid() and public.is_org_member(org_id))
    or public.is_org_admin(org_id)
  );

drop policy if exists profile_org_cards_update_own_or_admin
  on public.profile_org_cards;
create policy profile_org_cards_update_own_or_admin
  on public.profile_org_cards
  for update
  to authenticated
  using (
    (profile_id = auth.uid() and public.is_org_member(org_id))
    or public.is_org_admin(org_id)
  )
  with check (
    (profile_id = auth.uid() and public.is_org_member(org_id))
    or public.is_org_admin(org_id)
  );

-- Inspectors update their own card instead of deleting it and accidentally
-- reactivating legacy fallback. An organization admin can still delete a card.
drop policy if exists profile_org_cards_delete_admin
  on public.profile_org_cards;
create policy profile_org_cards_delete_admin
  on public.profile_org_cards
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

revoke all on function public.profile_org_cards_prepare_write(),
  public.assignment_links_protect_issuer_snapshot()
  from public, anon, authenticated, service_role;

commit;
