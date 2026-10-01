-- TU explicit report inclusion for reviewed field observations
-- Date: 2026-10-01
-- Scope:
-- 1) Include field observations in the report by default
-- 2) Let the inspector keep an observation as internal documentation
-- 3) Backfill locked investigations without invalidating their approved analysis

begin;

alter table public.tu_observations
  add column if not exists report_inclusion text;

do $$
declare
  v_trigger_names text[] := array[]::text[];
  v_trigger_modes text[] := array[]::text[];
  v_index integer;
begin
  select
    coalesce(array_agg(trigger_row.tgname order by trigger_row.tgname), array[]::text[]),
    coalesce(array_agg(trigger_row.tgenabled::text order by trigger_row.tgname), array[]::text[])
  into v_trigger_names, v_trigger_modes
  from pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.tu_observations'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgname = any(array[
      'trg_guard_locked_inspection_write',
      'trg_mark_tu_analysis_stale',
      'trg_tu_observations_set_updated_at'
    ])
    and trigger_row.tgenabled <> 'D';

  if coalesce(array_length(v_trigger_names, 1), 0) > 0 then
    for v_index in 1..array_length(v_trigger_names, 1) loop
      execute format(
        'alter table public.tu_observations disable trigger %I',
        v_trigger_names[v_index]
      );
    end loop;
  end if;

  begin
    update public.tu_observations
    set report_inclusion = case
      when include_in_report = false then 'internal'
      else 'include'
    end
    where report_inclusion is null
       or report_inclusion not in ('include', 'internal')
       -- Repair rows initialized by the earlier migration's column default.
       or (include_in_report = false and report_inclusion = 'include');
  exception when others then
    if coalesce(array_length(v_trigger_names, 1), 0) > 0 then
      for v_index in 1..array_length(v_trigger_names, 1) loop
        execute format(
          case v_trigger_modes[v_index]
            when 'A' then 'alter table public.tu_observations enable always trigger %I'
            when 'R' then 'alter table public.tu_observations enable replica trigger %I'
            else 'alter table public.tu_observations enable trigger %I'
          end,
          v_trigger_names[v_index]
        );
      end loop;
    end if;
    raise;
  end;

  if coalesce(array_length(v_trigger_names, 1), 0) > 0 then
    for v_index in 1..array_length(v_trigger_names, 1) loop
      execute format(
        case v_trigger_modes[v_index]
          when 'A' then 'alter table public.tu_observations enable always trigger %I'
          when 'R' then 'alter table public.tu_observations enable replica trigger %I'
          else 'alter table public.tu_observations enable trigger %I'
        end,
        v_trigger_names[v_index]
      );
    end loop;
  end if;
end
$$;

alter table public.tu_observations
  alter column report_inclusion set default 'include',
  alter column report_inclusion set not null;

alter table public.tu_observations
  drop constraint if exists tu_observations_report_inclusion_check;

alter table public.tu_observations
  add constraint tu_observations_report_inclusion_check
    check (report_inclusion in ('include', 'internal'));

comment on column public.tu_observations.report_inclusion is
  'Inspector report choice: include in the report or keep as internal documentation.';

create index if not exists tu_observations_report_inclusion_idx
  on public.tu_observations (inspection_id, report_inclusion, review_status);

commit;
