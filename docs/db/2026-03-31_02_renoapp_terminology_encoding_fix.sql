-- RenoApp terminology encoding fix
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Repairs mojibake in seeded terminology texts
-- Prerequisite:
--  - 2026-03-31_01_renoapp_terminology_foundation.sql

update public.renoapp_terminology_groups
set
  label = case
    when label ~ '[ÃÂâ]' then convert_from(convert_to(label, 'LATIN1'), 'UTF8')
    else label
  end,
  description = case
    when description is not null and description ~ '[ÃÂâ]' then convert_from(convert_to(description, 'LATIN1'), 'UTF8')
    else description
  end
where label ~ '[ÃÂâ]'
   or coalesce(description, '') ~ '[ÃÂâ]';

update public.renoapp_terminology_terms
set
  label = case
    when label ~ '[ÃÂâ]' then convert_from(convert_to(label, 'LATIN1'), 'UTF8')
    else label
  end,
  definition = case
    when definition is not null and definition ~ '[ÃÂâ]' then convert_from(convert_to(definition, 'LATIN1'), 'UTF8')
    else definition
  end
where label ~ '[ÃÂâ]'
   or coalesce(definition, '') ~ '[ÃÂâ]';

update public.renoapp_terminology_aliases
set alias = convert_from(convert_to(alias, 'LATIN1'), 'UTF8')
where alias ~ '[ÃÂâ]';

update public.renoapp_terminology_rules
set
  label = case
    when label ~ '[ÃÂâ]' then convert_from(convert_to(label, 'LATIN1'), 'UTF8')
    else label
  end,
  description = case
    when description is not null and description ~ '[ÃÂâ]' then convert_from(convert_to(description, 'LATIN1'), 'UTF8')
    else description
  end
where label ~ '[ÃÂâ]'
   or coalesce(description, '') ~ '[ÃÂâ]';
