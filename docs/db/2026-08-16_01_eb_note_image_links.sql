-- EB note image links
-- Date: 2026-08-16
-- Scope:
-- 1) Store note/control-point image relations separately from the image row
-- 2) Allow one original image to be linked to several notes
-- 3) Prevent the same image from being linked more than once to the same note

create table if not exists public.eb_note_image_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  eb_note_id uuid not null references public.eb_notes(id) on delete cascade,
  inspection_image_id uuid not null references public.inspection_images(id) on delete cascade,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create unique index if not exists eb_note_image_links_note_image_unique_idx
  on public.eb_note_image_links (eb_note_id, inspection_image_id);

create index if not exists eb_note_image_links_inspection_idx
  on public.eb_note_image_links (inspection_id, eb_note_id, sort_order, created_at);

create index if not exists eb_note_image_links_image_idx
  on public.eb_note_image_links (inspection_image_id);

insert into public.eb_note_image_links (
  org_id,
  eb_project_id,
  inspection_id,
  eb_note_id,
  inspection_image_id,
  sort_order,
  created_at
)
select
  n.org_id,
  n.eb_project_id,
  img.inspection_id,
  img.eb_note_id,
  img.id,
  coalesce(img.sort_order, 100),
  coalesce(img.created_at, now())
from public.inspection_images img
join public.eb_notes n on n.id = img.eb_note_id
where img.eb_note_id is not null
on conflict (eb_note_id, inspection_image_id) do nothing;

comment on table public.eb_note_image_links is
  'Links one EB inspection image to one note/control point. A single image may be linked to multiple notes.';
