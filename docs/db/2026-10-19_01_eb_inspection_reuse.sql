-- A new final inspection can reuse independent copies of historical evidence.
-- No existing notes, snapshots, links, permissions or default statuses change.
begin;

alter table public.eb_notes add column if not exists reuse_source jsonb;
alter table public.inspection_images add column if not exists reuse_source jsonb;

alter table public.eb_notes drop constraint if exists eb_notes_reuse_source_object_check;
alter table public.eb_notes add constraint eb_notes_reuse_source_object_check
  check (reuse_source is null or (jsonb_typeof(reuse_source) = 'object'
    and reuse_source ? 'inspectionId' and reuse_source ? 'noteId'));
alter table public.inspection_images drop constraint if exists inspection_images_reuse_source_object_check;
alter table public.inspection_images add constraint inspection_images_reuse_source_object_check
  check (reuse_source is null or (jsonb_typeof(reuse_source) = 'object'
    and reuse_source ? 'inspectionId' and reuse_source ? 'noteId' and reuse_source ? 'imageId'));

comment on column public.eb_notes.reuse_source is
  'Historical source of an independent note copied to a new EB inspection. Never a live synchronization link.';
comment on column public.inspection_images.reuse_source is
  'Original historical photo source/date. The new inspection owns a separate stored image file and row.';

create or replace function public.eb_preserve_inspection_reuse_source()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reuse_source is distinct from old.reuse_source then
    raise exception using errcode = '42501', message = 'EB_REUSE_SOURCE_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_eb_notes_preserve_reuse_source on public.eb_notes;
create trigger trg_eb_notes_preserve_reuse_source before update on public.eb_notes
  for each row execute function public.eb_preserve_inspection_reuse_source();
drop trigger if exists trg_inspection_images_preserve_reuse_source on public.inspection_images;
create trigger trg_inspection_images_preserve_reuse_source before update on public.inspection_images
  for each row execute function public.eb_preserve_inspection_reuse_source();

notify pgrst, 'reload schema';
commit;
