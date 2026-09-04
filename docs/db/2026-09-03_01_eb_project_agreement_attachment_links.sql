-- EB project agreement attachment links
-- Date: 2026-09-03
-- Scope:
-- 1) Keep one project-level document bank in eb_project_attachments
-- 2) Link one document to the main agreement (agreement_key = 'standard')
--    or to a structured agreement_items row (agreement_key = that row's id)
-- 3) Allow several documents per agreement, without duplicating storage files

create table if not exists public.eb_project_agreement_attachment_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  agreement_key text not null,
  attachment_id uuid not null,
  include_in_report boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_project_agreement_attachment_links_attachment_id_fkey
    foreign key (attachment_id)
    references public.eb_project_attachments(id)
    on delete restrict,
  constraint eb_project_agreement_attachment_links_key_check
    check (btrim(agreement_key) <> '')
);

-- Keep a document from being deleted while it is shown under Avtal. The
-- explicit ALTER also corrects an early local version of this migration that
-- used ON DELETE CASCADE.
alter table public.eb_project_agreement_attachment_links
  drop constraint if exists eb_project_agreement_attachment_links_attachment_id_fkey;
alter table public.eb_project_agreement_attachment_links
  add constraint eb_project_agreement_attachment_links_attachment_id_fkey
  foreign key (attachment_id)
  references public.eb_project_attachments(id)
  on delete restrict;

-- A document may be reused for different agreement rows, but never twice for
-- the same agreement row.
create unique index if not exists eb_project_agreement_attachment_links_unique_idx
  on public.eb_project_agreement_attachment_links (eb_project_id, agreement_key, attachment_id);

create index if not exists eb_project_agreement_attachment_links_project_key_idx
  on public.eb_project_agreement_attachment_links (eb_project_id, agreement_key, sort_order, created_at);

create index if not exists eb_project_agreement_attachment_links_attachment_idx
  on public.eb_project_agreement_attachment_links (attachment_id);

-- A regular foreign key guarantees that the attachment exists. This trigger
-- additionally guarantees that it is a document from this exact EB project
-- and organization; an image or a document from another project cannot be
-- linked by a direct database write.
create or replace function public.eb_validate_project_agreement_attachment_link()
returns trigger
language plpgsql
as $$
declare
  attachment_row public.eb_project_attachments%rowtype;
begin
  select *
    into attachment_row
  from public.eb_project_attachments
  where id = new.attachment_id;

  if not found then
    raise exception 'EB agreement attachment % was not found.', new.attachment_id;
  end if;

  if attachment_row.org_id <> new.org_id
    or attachment_row.eb_project_id <> new.eb_project_id then
    raise exception 'EB agreement attachment must belong to the same project and organization.';
  end if;

  if attachment_row.attachment_type <> 'document' then
    raise exception 'Only EB project documents can be linked to an agreement.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_eb_validate_project_agreement_attachment_link
  on public.eb_project_agreement_attachment_links;
create trigger trg_eb_validate_project_agreement_attachment_link
before insert or update on public.eb_project_agreement_attachment_links
for each row
execute function public.eb_validate_project_agreement_attachment_link();

drop trigger if exists trg_eb_project_agreement_attachment_links_set_updated_at
  on public.eb_project_agreement_attachment_links;
create trigger trg_eb_project_agreement_attachment_links_set_updated_at
before update on public.eb_project_agreement_attachment_links
for each row
execute function public.eb_set_updated_at();

-- Replaces an agreement's complete document selection in one database
-- transaction. Locking the project row and checking its current timestamp
-- prevents two browser windows from overwriting each other's link choices.
create or replace function public.replace_eb_project_agreement_attachment_links(
  p_org_id uuid,
  p_project_id uuid,
  p_expected_updated_at timestamptz,
  p_links jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_updated_at timestamptz;
  v_agreement_items jsonb;
begin
  select
    project.updated_at,
    coalesce(project.agreement_items, '[]'::jsonb)
  into v_updated_at, v_agreement_items
  from public.eb_projects project
  where project.org_id = p_org_id
    and project.id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EB_PROJECT_NOT_FOUND';
  end if;

  if v_updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'EB_PROJECT_CONFLICT';
  end if;

  if jsonb_typeof(v_agreement_items) <> 'array' then
    v_agreement_items := '[]'::jsonb;
  end if;

  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'EB_AGREEMENT_ATTACHMENT_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as requested(link)
    where btrim(coalesce(requested.link ->> 'agreementKey', '')) = ''
      or btrim(coalesce(requested.link ->> 'attachmentId', '')) = ''
  ) then
    raise exception using errcode = '22023', message = 'EB_AGREEMENT_ATTACHMENT_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as requested(link)
    where btrim(requested.link ->> 'agreementKey') <> 'standard'
      and not exists (
        select 1
        from jsonb_array_elements(v_agreement_items) as agreement_item(item)
        where agreement_item.item ->> 'id' = btrim(requested.link ->> 'agreementKey')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'EB_AGREEMENT_KEY_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as requested(link)
    left join public.eb_project_attachments attachment
      on attachment.id = (requested.link ->> 'attachmentId')::uuid
    where attachment.id is null
      or attachment.org_id <> p_org_id
      or attachment.eb_project_id <> p_project_id
      or attachment.attachment_type <> 'document'
  ) then
    raise exception using errcode = 'P0001', message = 'EB_AGREEMENT_ATTACHMENT_NOT_FOUND';
  end if;

  delete from public.eb_project_agreement_attachment_links
  where org_id = p_org_id
    and eb_project_id = p_project_id;

  insert into public.eb_project_agreement_attachment_links (
    org_id,
    eb_project_id,
    agreement_key,
    attachment_id,
    include_in_report,
    sort_order
  )
  select
    p_org_id,
    p_project_id,
    btrim(requested.link ->> 'agreementKey'),
    (requested.link ->> 'attachmentId')::uuid,
    coalesce((requested.link ->> 'includeInReport')::boolean, true),
    coalesce((requested.link ->> 'sortOrder')::integer, requested.ordinality::integer * 100)
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) with ordinality as requested(link, ordinality);

  -- Agreement links influence the statement. Updating the project timestamp
  -- makes the report-draft freshness logic pick up that change.
  update public.eb_projects
  set updated_at = now()
  where org_id = p_org_id
    and id = p_project_id;
end;
$$;

revoke all on function public.replace_eb_project_agreement_attachment_links(uuid, uuid, timestamptz, jsonb)
  from public;
grant execute on function public.replace_eb_project_agreement_attachment_links(uuid, uuid, timestamptz, jsonb)
  to service_role;

-- The application reads this before enabling the upload controls. It catches
-- a partial rollout where the table exists but the transactional RPC has not
-- yet reached the API schema cache.
create or replace function public.eb_project_agreement_attachment_links_available()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    to_regclass('public.eb_project_agreement_attachment_links') is not null
    and to_regprocedure(
      'public.replace_eb_project_agreement_attachment_links(uuid,uuid,timestamp with time zone,jsonb)'
    ) is not null;
$$;

revoke all on function public.eb_project_agreement_attachment_links_available()
  from public;
grant execute on function public.eb_project_agreement_attachment_links_available()
  to service_role;

alter table public.eb_project_agreement_attachment_links enable row level security;

grant select, insert, update, delete on table public.eb_project_agreement_attachment_links to authenticated;

drop policy if exists eb_project_agreement_attachment_links_member_all
  on public.eb_project_agreement_attachment_links;
create policy eb_project_agreement_attachment_links_member_all
  on public.eb_project_agreement_attachment_links
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

comment on table public.eb_project_agreement_attachment_links is
  'Links an existing EB project document to the main agreement (standard) or one agreement_items row. Files remain stored only in eb_project_attachments.';

comment on column public.eb_project_agreement_attachment_links.agreement_key is
  'standard for the main contract, otherwise the exact id of an eb_projects.agreement_items row.';

comment on column public.eb_project_agreement_attachment_links.include_in_report is
  'Controls whether this linked document is used in the agreement section of the statement; it does not change the generic project attachment report flag.';

-- Existing projects deliberately receive no automatic links. The prior data
-- model had no reliable file-to-agreement relation, so guessing would risk
-- placing documents under the wrong contract or ÄTA row.
