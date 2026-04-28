-- RenoApp review flag links
-- Date: 2026-04-28
-- Adds reusable review flag links for action types, document types and participant roles.

create table if not exists public.renoapp_review_flag_links (
  id uuid primary key default gen_random_uuid(),
  review_flag_id uuid not null references public.renoapp_review_flags (id) on delete cascade,
  action_type_id uuid references public.renovation_action_types (id) on delete cascade,
  document_type_id uuid references public.renovation_document_types (id) on delete cascade,
  participant_role_id uuid references public.renoapp_participant_roles (id) on delete cascade,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_review_flag_links_sort_order_check check (sort_order > 0),
  constraint renoapp_review_flag_links_target_check check (
    (
      action_type_id is not null
      and document_type_id is null
      and participant_role_id is null
    )
    or
    (
      action_type_id is null
      and document_type_id is not null
      and participant_role_id is null
    )
    or
    (
      action_type_id is null
      and document_type_id is null
      and participant_role_id is not null
    )
  )
);

drop trigger if exists trg_renoapp_review_flag_links_set_updated_at on public.renoapp_review_flag_links;
create trigger trg_renoapp_review_flag_links_set_updated_at
before update on public.renoapp_review_flag_links
for each row
execute function public.renoapp_set_updated_at();

create index if not exists renoapp_review_flag_links_flag_idx
  on public.renoapp_review_flag_links (review_flag_id, sort_order);

create index if not exists renoapp_review_flag_links_action_type_idx
  on public.renoapp_review_flag_links (action_type_id, sort_order)
  where action_type_id is not null;

create index if not exists renoapp_review_flag_links_document_type_idx
  on public.renoapp_review_flag_links (document_type_id, sort_order)
  where document_type_id is not null;

create index if not exists renoapp_review_flag_links_participant_role_idx
  on public.renoapp_review_flag_links (participant_role_id, sort_order)
  where participant_role_id is not null;

create unique index if not exists renoapp_review_flag_links_action_type_unique
  on public.renoapp_review_flag_links (action_type_id, review_flag_id)
  where action_type_id is not null;

create unique index if not exists renoapp_review_flag_links_document_type_unique
  on public.renoapp_review_flag_links (document_type_id, review_flag_id)
  where document_type_id is not null;

create unique index if not exists renoapp_review_flag_links_participant_role_unique
  on public.renoapp_review_flag_links (participant_role_id, review_flag_id)
  where participant_role_id is not null;
