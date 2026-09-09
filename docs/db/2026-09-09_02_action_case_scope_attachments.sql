-- Internal scope evidence, separate from portal grants and sent request snapshots.
-- Requires action_cases foundation, files, and costing migrations.
begin;

alter table public.action_case_items
  add column if not exists scope_attachment_ids uuid[];

comment on column public.action_case_items.scope_attachment_ids is
  'Internal evidence selection. NULL uses legacy attachment item association; {} explicitly selects none. Does not grant access or alter quotation snapshots.';

create or replace function public.validate_action_case_scope_attachments()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  if new.scope_attachment_ids is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.scope_attachment_ids is not distinct from old.scope_attachment_ids
      and new.org_id = old.org_id and new.action_case_id = old.action_case_id then
      return new;
    end if;
  end if;
  if cardinality(new.scope_attachment_ids) > 50
    or array_ndims(new.scope_attachment_ids) > 1
    or array_position(new.scope_attachment_ids, null) is not null
    or cardinality(new.scope_attachment_ids) <> (select count(distinct id) from unnest(new.scope_attachment_ids) id) then
    raise exception 'ACTION_CASE_SCOPE_ATTACHMENTS_INVALID' using errcode = '22023';
  end if;
  -- Serialize selection with file deletion or reassignment.
  perform id from public.action_case_attachments
    where id = any(new.scope_attachment_ids) and org_id = new.org_id and action_case_id = new.action_case_id
    order by id for share;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(new.scope_attachment_ids) then
    raise exception 'ACTION_CASE_SCOPE_ATTACHMENTS_INVALID' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_action_case_scope_attachments on public.action_case_items;
create trigger trg_validate_action_case_scope_attachments
before insert or update on public.action_case_items
for each row execute function public.validate_action_case_scope_attachments();

create or replace function public.invalidate_action_case_file_evidence()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_removed boolean;
begin
  if tg_op = 'INSERT' then
    update public.action_case_items set updated_at = clock_timestamp()
      where id = new.action_case_item_id and org_id = new.org_id
        and action_case_id = new.action_case_id and scope_attachment_ids is null;
    return new;
  end if;
  v_removed := tg_op = 'DELETE';
  if tg_op = 'UPDATE' then
    if new is not distinct from old then return new; end if;
    v_removed := new.org_id <> old.org_id or new.action_case_id <> old.action_case_id or new.id <> old.id;
  end if;
  -- Bumping the existing item version invalidates generated costing proposals.
  update public.action_case_items i set
    scope_attachment_ids = case when v_removed and scope_attachment_ids is not null then array(
      select selected.id from unnest(scope_attachment_ids) with ordinality selected(id, position)
      join public.action_case_attachments a on a.id = selected.id and a.org_id = i.org_id and a.action_case_id = i.action_case_id
      order by selected.position
    ) else scope_attachment_ids end,
    updated_at = clock_timestamp()
    where org_id = old.org_id and action_case_id = old.action_case_id
      and (old.id = any(scope_attachment_ids) or (scope_attachment_ids is null and id = old.action_case_item_id));
  if tg_op = 'UPDATE' then
    update public.action_case_items set updated_at = clock_timestamp()
      where id = new.action_case_item_id and org_id = new.org_id
        and action_case_id = new.action_case_id and scope_attachment_ids is null;
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_invalidate_action_case_file_evidence on public.action_case_attachments;
create trigger trg_invalidate_action_case_file_evidence
after insert or update or delete on public.action_case_attachments
for each row execute function public.invalidate_action_case_file_evidence();

revoke all on function public.validate_action_case_scope_attachments() from public;
revoke all on function public.invalidate_action_case_file_evidence() from public;

commit;
