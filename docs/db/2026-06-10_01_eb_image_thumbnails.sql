-- EB image thumbnails
-- Date: 2026-06-10
-- Scope:
-- 1) Keep uploaded EB image originals unchanged for future processing
-- 2) Store a separate lightweight thumbnail path for fast round/project previews

alter table public.inspection_images
  add column if not exists thumbnail_file_path text;

alter table public.eb_project_attachments
  add column if not exists thumbnail_file_path text;

create index if not exists inspection_images_thumbnail_file_path_idx
  on public.inspection_images (thumbnail_file_path)
  where thumbnail_file_path is not null;

create index if not exists eb_project_attachments_thumbnail_file_path_idx
  on public.eb_project_attachments (thumbnail_file_path)
  where thumbnail_file_path is not null;

comment on column public.inspection_images.thumbnail_file_path is
  'Optional lightweight thumbnail stored separately from the original image file_path.';

comment on column public.eb_project_attachments.thumbnail_file_path is
  'Optional lightweight thumbnail stored separately from the original attachment file_path.';
