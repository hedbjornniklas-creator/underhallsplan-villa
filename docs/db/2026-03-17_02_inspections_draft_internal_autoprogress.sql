-- Inspections: keep draft internal and auto-progress to ongoing on first meaningful content
-- Date: 2026-03-17
-- Prerequisites:
--  - 2026-02-18_ob_snapshot_and_locks.sql
--  - existing inspections/OB tables in current schema

create or replace function public.inspection_has_meaningful_content(
  p_inspection_id uuid
)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select
    exists (
      select 1
      from public.inspections i
      where i.id = p_inspection_id
        and (
          btrim(coalesce(i.client_name, '')) <> ''
          or i.date is not null
          or i.inspection_time is not null
          or btrim(coalesce(i.scope, '')) <> ''
          or btrim(coalesce(i.attendees_other, '')) <> ''
        )
    )
    or exists (
      select 1
      from public.ob_property_snapshot s
      where s.inspection_id = p_inspection_id
        and (
          btrim(coalesce(s.address, '')) <> ''
          or btrim(coalesce(s.postal_code, '')) <> ''
          or btrim(coalesce(s.city, '')) <> ''
        )
    )
    or exists (
      select 1
      from public.inspection_documents d
      where d.inspection_id = p_inspection_id
        and (
          coalesce(nullif(lower(btrim(d.status)), ''), 'missing') <> 'missing'
          or btrim(coalesce(d.note, '')) <> ''
          or d.document_date is not null
          or d.document_value is not null
          or btrim(coalesce(d.file_url, '')) <> ''
        )
    )
    or exists (
      select 1
      from public.inspection_images img
      where img.inspection_id = p_inspection_id
    )
    or exists (
      select 1
      from public.inspection_control_items ci
      where ci.inspection_id = p_inspection_id
        and (
          ci.selected_outcome_id is not null
          or btrim(coalesce(ci.note, '')) <> ''
        )
    );
$$;

create or replace function public.set_inspection_ongoing_if_started(
  p_inspection_id uuid
)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_inspection_id is null then
    return;
  end if;

  update public.inspections i
  set status = 'ongoing'
  where i.id = p_inspection_id
    and lower(btrim(coalesce(i.status, ''))) in ('', 'draft', 'utkast')
    and public.inspection_has_meaningful_content(i.id);
end;
$$;

create or replace function public.inspections_prevent_draft_regression()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_old_status text := lower(btrim(coalesce(old.status, '')));
  v_new_status text := lower(btrim(coalesce(new.status, '')));
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Draft is internal: never let non-draft statuses go back to draft.
  if v_old_status not in ('', 'draft', 'utkast')
     and v_new_status in ('draft', 'utkast') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

create or replace function public.inspections_auto_progress_after_write()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.set_inspection_ongoing_if_started(new.id);
  return null;
end;
$$;

create or replace function public.inspection_related_auto_progress_after_write()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  perform public.set_inspection_ongoing_if_started(new.inspection_id);
  return null;
end;
$$;

drop trigger if exists trg_inspections_prevent_draft_regression on public.inspections;
create trigger trg_inspections_prevent_draft_regression
before update on public.inspections
for each row
execute function public.inspections_prevent_draft_regression();

drop trigger if exists trg_inspections_auto_progress_after_write on public.inspections;
create trigger trg_inspections_auto_progress_after_write
after insert or update on public.inspections
for each row
execute function public.inspections_auto_progress_after_write();

drop trigger if exists trg_ob_property_snapshot_auto_progress_after_write on public.ob_property_snapshot;
create trigger trg_ob_property_snapshot_auto_progress_after_write
after insert or update on public.ob_property_snapshot
for each row
execute function public.inspection_related_auto_progress_after_write();

drop trigger if exists trg_inspection_documents_auto_progress_after_write on public.inspection_documents;
create trigger trg_inspection_documents_auto_progress_after_write
after insert or update on public.inspection_documents
for each row
execute function public.inspection_related_auto_progress_after_write();

drop trigger if exists trg_inspection_images_auto_progress_after_write on public.inspection_images;
create trigger trg_inspection_images_auto_progress_after_write
after insert or update on public.inspection_images
for each row
execute function public.inspection_related_auto_progress_after_write();

drop trigger if exists trg_inspection_control_items_auto_progress_after_write on public.inspection_control_items;
create trigger trg_inspection_control_items_auto_progress_after_write
after insert or update on public.inspection_control_items
for each row
execute function public.inspection_related_auto_progress_after_write();
