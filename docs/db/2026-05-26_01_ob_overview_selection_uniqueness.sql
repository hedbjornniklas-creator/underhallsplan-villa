-- OB overview selection uniqueness
-- Date: 2026-05-26
-- Scope:
-- 1) Archive and remove duplicate overview-selection rows
-- 2) Prevent duplicate logical rows for settings/conditions selections
--
-- The logical key is:
-- inspection_id + overview_item_id + floor_key + set_index
--
-- Locked inspections with conflicting duplicate content are not modified. If a
-- locked duplicate group has different values/note content, the migration stops
-- so the case can be reviewed manually. Exact duplicate rows are archived and
-- removed, because they do not carry distinct report information.

do $$
begin
  if exists (
    select 1
    from (
      select
        s.inspection_id,
        s.overview_item_id,
        s.floor_key,
        s.set_index
      from public.inspection_overview_selections s
      join public.inspections i on i.id = s.inspection_id
      where i.locked_at is not null
      group by
        s.inspection_id,
        s.overview_item_id,
        s.floor_key,
        s.set_index
      having count(*) > 1
        and count(distinct jsonb_build_object('values', s.values, 'note', s.note)) > 1
    ) locked_duplicates
  ) then
    raise exception using
      errcode = '55000',
      message = 'Locked inspections have conflicting duplicate overview selections. Review before applying uniqueness.';
  end if;
end
$$;

create table if not exists public.inspection_overview_selection_dedupe_log_20260526 (
  id uuid primary key,
  keep_id uuid not null,
  inspection_id uuid not null,
  overview_item_id uuid not null,
  floor_key text,
  set_index integer not null,
  row_data jsonb not null,
  deleted_at timestamptz not null default now()
);

with ranked as (
  select
    s.*,
    first_value(s.id) over w as keep_id,
    row_number() over w as rn
  from public.inspection_overview_selections s
  window w as (
    partition by s.inspection_id, s.overview_item_id, s.floor_key, s.set_index
    order by s.updated_at desc nulls last, s.created_at desc nulls last, s.id desc
  )
)
insert into public.inspection_overview_selection_dedupe_log_20260526 (
  id,
  keep_id,
  inspection_id,
  overview_item_id,
  floor_key,
  set_index,
  row_data
)
select
  id,
  keep_id,
  inspection_id,
  overview_item_id,
  floor_key,
  set_index,
  to_jsonb(ranked) - 'rn' - 'keep_id'
from ranked
where rn > 1
on conflict (id) do nothing;

do $$
declare
  v_guard_trigger_exists boolean;
begin
  select exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.inspection_overview_selections'::regclass
      and tgname = 'trg_guard_locked_inspection_write'
      and not tgisinternal
  )
  into v_guard_trigger_exists;

  if v_guard_trigger_exists then
    alter table public.inspection_overview_selections
      disable trigger trg_guard_locked_inspection_write;
  end if;

  begin
    with ranked as (
      select
        s.id,
        row_number() over w as rn
      from public.inspection_overview_selections s
      window w as (
        partition by s.inspection_id, s.overview_item_id, s.floor_key, s.set_index
        order by s.updated_at desc nulls last, s.created_at desc nulls last, s.id desc
      )
    )
    delete from public.inspection_overview_selections s
    using ranked r
    where s.id = r.id
      and r.rn > 1;
  exception when others then
    if v_guard_trigger_exists then
      alter table public.inspection_overview_selections
        enable trigger trg_guard_locked_inspection_write;
    end if;
    raise;
  end;

  if v_guard_trigger_exists then
    alter table public.inspection_overview_selections
      enable trigger trg_guard_locked_inspection_write;
  end if;
end
$$;

create unique index if not exists inspection_overview_selections_logical_unique_idx
  on public.inspection_overview_selections (
    inspection_id,
    overview_item_id,
    floor_key,
    set_index
  )
  nulls not distinct;
