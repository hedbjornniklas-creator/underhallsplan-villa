-- AI/embedding index for control point search.
-- One indexed document is stored per control point. The document combines the
-- control point metadata and all active outcomes/chips for semantic matching.

create extension if not exists vector with schema extensions;

set search_path = public, extensions;

create table if not exists public.settings_control_point_search_index (
  control_point_id uuid primary key references public.settings_control_points(id) on delete cascade,
  scope text not null,
  search_text text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  embedding_model text not null default 'text-embedding-3-small',
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settings_control_point_search_index_scope_idx
  on public.settings_control_point_search_index(scope);

create index if not exists settings_control_point_search_index_embedding_idx
  on public.settings_control_point_search_index
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_settings_control_point_search_index(
  query_embedding vector(1536),
  match_count int default 10,
  match_threshold double precision default 0
)
returns table (
  control_point_id uuid,
  similarity double precision,
  scope text,
  search_text text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    idx.control_point_id,
    1 - (idx.embedding <=> query_embedding) as similarity,
    idx.scope,
    idx.search_text
  from public.settings_control_point_search_index idx
  where 1 - (idx.embedding <=> query_embedding) >= match_threshold
  order by idx.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant select on public.settings_control_point_search_index to authenticated;
grant execute on function public.match_settings_control_point_search_index(
  vector(1536),
  int,
  double precision
) to authenticated;
