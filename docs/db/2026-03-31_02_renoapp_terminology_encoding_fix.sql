-- RenoApp terminology encoding fix
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Repairs mojibake in seeded terminology texts
-- Prerequisite:
--  - 2026-03-31_01_renoapp_terminology_foundation.sql

create or replace function public.renoapp_fix_mojibake(value text)
returns text
language sql
immutable
as $$
  select convert_from(convert_to(value, 'WIN1252'), 'UTF8')
$$;

update public.renoapp_terminology_groups
set
  label = case
    when strpos(label, chr(195)) > 0 or strpos(label, chr(194)) > 0 or strpos(label, chr(226)) > 0
      then public.renoapp_fix_mojibake(label)
    else label
  end,
  description = case
    when description is not null
      and (
        strpos(description, chr(195)) > 0
        or strpos(description, chr(194)) > 0
        or strpos(description, chr(226)) > 0
      )
      then public.renoapp_fix_mojibake(description)
    else description
  end
where
  strpos(label, chr(195)) > 0
  or strpos(label, chr(194)) > 0
  or strpos(label, chr(226)) > 0
  or strpos(coalesce(description, ''), chr(195)) > 0
  or strpos(coalesce(description, ''), chr(194)) > 0
  or strpos(coalesce(description, ''), chr(226)) > 0;

update public.renoapp_terminology_terms
set
  label = case
    when strpos(label, chr(195)) > 0 or strpos(label, chr(194)) > 0 or strpos(label, chr(226)) > 0
      then public.renoapp_fix_mojibake(label)
    else label
  end,
  definition = case
    when definition is not null
      and (
        strpos(definition, chr(195)) > 0
        or strpos(definition, chr(194)) > 0
        or strpos(definition, chr(226)) > 0
      )
      then public.renoapp_fix_mojibake(definition)
    else definition
  end
where
  strpos(label, chr(195)) > 0
  or strpos(label, chr(194)) > 0
  or strpos(label, chr(226)) > 0
  or strpos(coalesce(definition, ''), chr(195)) > 0
  or strpos(coalesce(definition, ''), chr(194)) > 0
  or strpos(coalesce(definition, ''), chr(226)) > 0;

update public.renoapp_terminology_aliases
set alias = public.renoapp_fix_mojibake(alias)
where
  strpos(alias, chr(195)) > 0
  or strpos(alias, chr(194)) > 0
  or strpos(alias, chr(226)) > 0;

update public.renoapp_terminology_rules
set
  label = case
    when strpos(label, chr(195)) > 0 or strpos(label, chr(194)) > 0 or strpos(label, chr(226)) > 0
      then public.renoapp_fix_mojibake(label)
    else label
  end,
  description = case
    when description is not null
      and (
        strpos(description, chr(195)) > 0
        or strpos(description, chr(194)) > 0
        or strpos(description, chr(226)) > 0
      )
      then public.renoapp_fix_mojibake(description)
    else description
  end
where
  strpos(label, chr(195)) > 0
  or strpos(label, chr(194)) > 0
  or strpos(label, chr(226)) > 0
  or strpos(coalesce(description, ''), chr(195)) > 0
  or strpos(coalesce(description, ''), chr(194)) > 0
  or strpos(coalesce(description, ''), chr(226)) > 0;
