-- Inspection family/variant classification
-- Date: 2026-05-14
-- Scope:
-- 1) Add stable family/variant markers to shared inspections table
-- 2) Rename EB Slutbesiktning code from SB to SLB
-- 3) Backfill existing EB/OB inspections without changing IDs or relations

alter table public.inspections
  add column if not exists inspection_family text,
  add column if not exists inspection_variant text;

-- Locked inspections must keep their report data immutable, but this migration
-- needs to add non-report classification metadata to historical locked rows.
create or replace function public.guard_locked_inspections_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception using
        errcode = '55000',
        message = 'Låst besiktning kan inte raderas.',
        detail = format('inspection_id=%s', old.id::text);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.locked_at is not null then
      if (to_jsonb(new) - array['locked_at', 'locked_by', 'updated_at', 'inspection_family', 'inspection_variant'])
        <> (to_jsonb(old) - array['locked_at', 'locked_by', 'updated_at', 'inspection_family', 'inspection_variant']) then
        raise exception using
          errcode = '55000',
          message = 'Låst besiktning kan inte ändras.',
          detail = format('inspection_id=%s', old.id::text);
      end if;
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

-- EB Slutbesiktning uses SLB so OB can use SB for Statusbesiktning.
delete from public.settings_eb_inspection_types
where key = 'SB'
  and exists (
    select 1
    from public.settings_eb_inspection_types
    where key = 'SLB'
  );

update public.settings_eb_inspection_types
set
  key = 'SLB',
  label = 'Slutbesiktning',
  description = 'Första entreprenadbesiktningstypen i EB-modulen.',
  sort_order = 100,
  is_active = true,
  is_default = true
where key = 'SB';

insert into public.settings_eb_inspection_types (key, label, description, sort_order, is_active, is_default)
select 'SLB', 'Slutbesiktning', 'Första entreprenadbesiktningstypen i EB-modulen.', 100, true, true
where not exists (
  select 1
  from public.settings_eb_inspection_types
  where key = 'SLB'
);

update public.settings_eb_inspection_types
set
  label = 'Slutbesiktning',
  description = 'Första entreprenadbesiktningstypen i EB-modulen.',
  sort_order = 100,
  is_active = true,
  is_default = true
where key = 'SLB';

alter table public.eb_inspection_details
  drop constraint if exists eb_inspection_details_variant_check;

update public.eb_inspection_details
set inspection_variant = 'SLB'
where inspection_variant = 'SB';

alter table public.eb_inspection_details
  add constraint eb_inspection_details_variant_check
  check (inspection_variant in ('SLB', 'FB', 'EB', 'GB', 'KSB', 'SAB'));

-- Mark all EB-backed inspections from the EB detail table.
update public.inspections i
set
  inspection_family = 'EB',
  inspection_variant = d.inspection_variant
from public.eb_inspection_details d
where d.inspection_id = i.id;

-- Existing non-EB inspections are classified from their current type.
-- Classic ÖB keeps OB/OB. Future/current statusbesiktning is OB/SB.
update public.inspections
set
  inspection_family = case
    when upper(coalesce(type, '')) = 'STATUS' then 'OB'
    when upper(coalesce(type, '')) = 'UHP' then 'UHP'
    else 'OB'
  end,
  inspection_variant = case
    when upper(coalesce(type, '')) = 'STATUS' then 'SB'
    when upper(coalesce(type, '')) = 'UHP' then 'UHP'
    else 'OB'
  end
where inspection_family is null;

alter table public.inspections
  alter column inspection_family set default 'OB',
  alter column inspection_variant set default 'OB',
  alter column inspection_family set not null,
  alter column inspection_variant set not null;

alter table public.inspections
  drop constraint if exists inspections_family_check,
  drop constraint if exists inspections_variant_check;

alter table public.inspections
  add constraint inspections_family_check
  check (inspection_family in ('OB', 'EB', 'UHP'));

alter table public.inspections
  add constraint inspections_variant_check
  check (btrim(inspection_variant) <> '');

create index if not exists inspections_family_variant_idx
  on public.inspections (inspection_family, inspection_variant, created_at desc);

create index if not exists inspections_property_family_idx
  on public.inspections (property_id, inspection_family, created_at desc);
