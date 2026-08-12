-- TU moisture investigation template deduplication
-- Date: 2026-08-12
-- Scope:
-- 1) Retire the earlier one-section admin template from new TU creation
-- 2) Keep the row and its key intact for investigations that already reference it
-- 3) Make the legacy template distinguishable in admin

update public.settings_tu_report_templates legacy
set
  title = 'Fuktskadeutredning (äldre mall)',
  description = coalesce(
    nullif(btrim(legacy.description), ''),
    'Äldre mall som behålls för befintliga utredningar.'
  ),
  is_active = false,
  updated_at = now()
where legacy.key = 'fuktskadeutredning'
  and exists (
    select 1
    from public.settings_tu_report_templates current_template
    where current_template.key = 'moisture_damage_investigation'
      and current_template.is_active = true
  );
