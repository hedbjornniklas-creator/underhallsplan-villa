  -- EB image source attachment tracking
  -- Date: 2026-06-11
  -- Scope:
  -- 1) Remember which project attachment an inspection image was copied from
  -- 2) Prevent duplicate copied images for the same inspection/source attachment

  alter table public.inspection_images
    add column if not exists source_attachment_id uuid references public.eb_project_attachments(id) on delete set null;

  drop index if exists public.inspection_images_note_source_attachment_unique_idx;

  create unique index if not exists inspection_images_inspection_source_attachment_unique_idx
    on public.inspection_images (inspection_id, source_attachment_id)
    where source_attachment_id is not null;

  comment on column public.inspection_images.source_attachment_id is
    'Optional EB project attachment id when the inspection image was copied from the project image bank.';
