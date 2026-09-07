-- Run before deploying the renovation rules UI and API.
begin;

create table if not exists public.renoapp_brf_rules_versions (
  id uuid primary key default gen_random_uuid(),
  brf_id uuid not null references public.brf_associations(id),
  version integer not null check (version > 0),
  format text not null check (format in ('text', 'pdf')),
  body text,
  file_path text unique,
  file_name text,
  published_at timestamptz not null default now(),
  published_by uuid not null references public.profiles(id),
  unique (brf_id, version),
  unique (brf_id, id),
  check ((format = 'text' and body is not null and length(btrim(body)) between 1 and 50000 and file_path is null and file_name is null)
    or (format = 'pdf' and body is null and file_path is not null and file_name is not null and length(btrim(file_name)) > 0
      and file_path like brf_id::text || '/published/%.pdf'))
);
alter table public.renoapp_brf_rules_versions enable row level security;
revoke all on public.renoapp_brf_rules_versions from anon, authenticated;
grant select, insert on public.renoapp_brf_rules_versions to service_role;

alter table public.brf_associations add column if not exists renovation_rules_version_id uuid;
alter table public.brf_associations drop constraint if exists brf_rules_version_belongs_to_brf;
alter table public.brf_associations add constraint brf_rules_version_belongs_to_brf
  foreign key (id, renovation_rules_version_id) references public.renoapp_brf_rules_versions(brf_id, id);

alter table public.renovation_cases
  add column if not exists rules_version_id uuid,
  add column if not exists rules_accepted_at timestamptz,
  add column if not exists rules_accepted_name text,
  add column if not exists rules_accepted_email text,
  add column if not exists rules_checked_at timestamptz;
alter table public.renovation_cases drop constraint if exists case_rules_version_belongs_to_brf;
alter table public.renovation_cases add constraint case_rules_version_belongs_to_brf
  foreign key (brf_id, rules_version_id) references public.renoapp_brf_rules_versions(brf_id, id);

create or replace function public.renoapp_rules_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'RULES_VERSION_IMMUTABLE';
end $$;
drop trigger if exists renoapp_rules_immutable on public.renoapp_brf_rules_versions;
create trigger renoapp_rules_immutable before update or delete on public.renoapp_brf_rules_versions
for each row execute function public.renoapp_rules_immutable();

-- Both publishing and first submission lock the BRF row, serializing version checks.
create or replace function public.renoapp_publish_brf_rules(
  p_actor uuid, p_brf_id uuid, p_expected_version uuid, p_content jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare current_version uuid; next_id uuid; next_version integer;
begin
  select renovation_rules_version_id into current_version from public.brf_associations
    where id = p_brf_id for update;
  if not found then raise exception 'BRF_NOT_FOUND'; end if;
  if current_version is distinct from p_expected_version then raise exception 'RULES_VERSION_CHANGED'; end if;
  if p_content is not null then
    select coalesce(max(version), 0) + 1 into next_version from public.renoapp_brf_rules_versions where brf_id = p_brf_id;
    insert into public.renoapp_brf_rules_versions(brf_id, version, format, body, file_path, file_name, published_by)
    values(p_brf_id, next_version, p_content->>'format', p_content->>'body',
      p_content->>'file_path', p_content->>'file_name', p_actor) returning id into next_id;
  end if;
  update public.brf_associations set renovation_rules_version_id = next_id where id = p_brf_id;
  return next_id;
end $$;
revoke all on function public.renoapp_publish_brf_rules(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.renoapp_publish_brf_rules(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.renoapp_guard_rules_acceptance() returns trigger
language plpgsql security definer set search_path = public as $$
declare required_version uuid;
begin
  if tg_op = 'UPDATE' and (old.status <> 'draft' or old.rules_checked_at is not null) then
    if new.status = 'draft' then raise exception 'CASE_LOCKED'; end if;
    if row(new.rules_version_id, new.rules_accepted_at, new.rules_accepted_name, new.rules_accepted_email, new.rules_checked_at)
      is distinct from row(old.rules_version_id, old.rules_accepted_at, old.rules_accepted_name, old.rules_accepted_email, old.rules_checked_at)
      or new.brf_id <> old.brf_id then raise exception 'RULES_ACCEPTANCE_IMMUTABLE'; end if;
    return new;
  end if;
  if new.status = 'draft' then
    new.rules_version_id := null;
    new.rules_accepted_at := null;
    new.rules_accepted_name := null;
    new.rules_accepted_email := null;
    new.rules_checked_at := null;
    return new;
  end if;
  select renovation_rules_version_id into required_version from public.brf_associations
    where id = new.brf_id for update;
  if new.rules_version_id is distinct from required_version then raise exception 'RULES_VERSION_CHANGED'; end if;
  if required_version is not null then
    if new.rules_accepted_at is null or coalesce(btrim(new.rules_accepted_name), '') = ''
      or coalesce(btrim(new.rules_accepted_email), '') = '' then raise exception 'RULES_ACCEPTANCE_REQUIRED'; end if;
    new.rules_accepted_at := now();
  else
    new.rules_accepted_at := null;
    new.rules_accepted_name := null;
    new.rules_accepted_email := null;
  end if;
  new.rules_checked_at := now();
  return new;
end $$;
drop trigger if exists renoapp_guard_rules_acceptance on public.renovation_cases;
create trigger renoapp_guard_rules_acceptance before insert or update on public.renovation_cases
for each row execute function public.renoapp_guard_rules_acceptance();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('renoapp-brf-rules', 'renoapp-brf-rules', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

commit;
