-- EB quality document types
-- Date: 2026-05-25
-- Scope:
-- 1) Seed EB document types for testing, documentation and quality measures
-- 2) Mark the document types as EB-only in the shared document type admin

alter table public.document_types
  add column if not exists applicable_modules text not null default 'ob';

with seed_rows (
  code,
  label,
  category,
  result_label,
  sort_order
) as (
  values
    ('EB_DOC_TATSKIKT_YTTERTAK_TERRASSBJALKLAG', 'Tätskikt på yttertak / terrassbjälklag', 'EB provning och dokumentation', 'Datum', 100),
    ('EB_DOC_TATSKIKT_VATRUM', 'Tätskikt i våtrum', 'EB provning och dokumentation', 'Datum', 110),
    ('EB_DOC_GOLVLUTNINGAR_VATRUM', 'Golvlutningar i våtrum', 'EB provning och dokumentation', 'Datum', 120),
    ('EB_DOC_KVALITETSDOKUMENT_BBV', 'Kvalitetsdokument utfärdat av behörigt företag som intygar att våtrum är utfört enligt BBV', 'EB provning och dokumentation', 'Datum', 130),
    ('EB_DOC_VATRUMSINTYG_GVK', 'Våtrumsintyg utfärdat att ett GVK-auktoriserat företag som intygar att arbetet är utfört enligt GVKs gällande branschregler', 'EB provning och dokumentation', 'Datum', 140),
    ('EB_DOC_ISOLATIONSPROVNING_EL', 'Isolationsprovning av elinstallationer', 'EB provning och dokumentation', 'Datum', 150),
    ('EB_DOC_JORDFELSBRYTARTEST', 'Jordfelsbrytartest', 'EB provning och dokumentation', 'Datum', 160),
    ('EB_DOC_SKYDDSLEDARE_KONTINUITET', 'Provning skyddsledare och kontinuitet', 'EB provning och dokumentation', 'Datum', 170),
    ('EB_DOC_SAKER_VATTEN', 'Säker Vatteninstallation utfärdat av behörigt auktoriserat företag', 'EB provning och dokumentation', 'Datum', 180),
    ('EB_DOC_PROVTRYCKNING_ROR', 'Provtryckningar av rör', 'EB provning och dokumentation', 'Datum', 190),
    ('EB_DOC_INJUSTERING_VARME', 'Injustering värme', 'EB provning och dokumentation', 'Datum', 200),
    ('EB_DOC_INJUSTERING_VENTILATION_OVK', 'Injustering ventilation OVK', 'EB provning och dokumentation', 'Datum', 210),
    ('EB_DOC_UTVANDIG_PUTS', 'Utvändig puts', 'EB provning och dokumentation', 'Datum', 220),
    ('EB_DOC_GLASSAKERHET', 'Glassäkerhet', 'EB provning och dokumentation', 'Datum', 230),
    ('EB_DOC_IMKANALER_SAKKUNNIG', 'Sakkunnighetsintyg för imkanaler', 'EB provning och dokumentation', 'Datum', 240),
    ('EB_DOC_RELATIONSHANDLINGAR', 'Relationshandlingar', 'EB provning och dokumentation', 'Överlämnas', 250),
    ('EB_DOC_DRIFT_SKOTSELINSTRUKTION', 'Drift- och skötselinstruktion', 'EB provning och dokumentation', 'Överlämnas', 260)
)
insert into public.document_types (
  code,
  label,
  category,
  scope,
  applicable_modules,
  applies_to,
  description,
  is_default,
  result_label,
  result_unit,
  validity_years,
  recommended_interval_years,
  interval_note,
  is_active
)
select
  seed_rows.code,
  seed_rows.label,
  seed_rows.category,
  'building',
  'eb',
  'all',
  'Underlag för EB-utlåtandets avsnitt Provning, dokumentation.',
  true,
  seed_rows.result_label,
  null,
  null,
  null,
  case
    when seed_rows.result_label = 'Överlämnas'
      then 'Välj om handlingen överlämnas, inte överlämnas eller inte är aktuell.'
    else null
  end,
  true
from seed_rows
where not exists (
  select 1
  from public.document_types existing
  where existing.code = seed_rows.code
);

with seed_rows (
  code,
  label,
  category,
  result_label
) as (
  values
    ('EB_DOC_TATSKIKT_YTTERTAK_TERRASSBJALKLAG', 'Tätskikt på yttertak / terrassbjälklag', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_TATSKIKT_VATRUM', 'Tätskikt i våtrum', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_GOLVLUTNINGAR_VATRUM', 'Golvlutningar i våtrum', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_KVALITETSDOKUMENT_BBV', 'Kvalitetsdokument utfärdat av behörigt företag som intygar att våtrum är utfört enligt BBV', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_VATRUMSINTYG_GVK', 'Våtrumsintyg utfärdat att ett GVK-auktoriserat företag som intygar att arbetet är utfört enligt GVKs gällande branschregler', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_ISOLATIONSPROVNING_EL', 'Isolationsprovning av elinstallationer', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_JORDFELSBRYTARTEST', 'Jordfelsbrytartest', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_SKYDDSLEDARE_KONTINUITET', 'Provning skyddsledare och kontinuitet', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_SAKER_VATTEN', 'Säker Vatteninstallation utfärdat av behörigt auktoriserat företag', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_PROVTRYCKNING_ROR', 'Provtryckningar av rör', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_INJUSTERING_VARME', 'Injustering värme', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_INJUSTERING_VENTILATION_OVK', 'Injustering ventilation OVK', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_UTVANDIG_PUTS', 'Utvändig puts', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_GLASSAKERHET', 'Glassäkerhet', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_IMKANALER_SAKKUNNIG', 'Sakkunnighetsintyg för imkanaler', 'EB provning och dokumentation', 'Datum'),
    ('EB_DOC_RELATIONSHANDLINGAR', 'Relationshandlingar', 'EB provning och dokumentation', 'Överlämnas'),
    ('EB_DOC_DRIFT_SKOTSELINSTRUKTION', 'Drift- och skötselinstruktion', 'EB provning och dokumentation', 'Överlämnas')
)
update public.document_types document_type
set
  label = seed_rows.label,
  category = seed_rows.category,
  scope = 'building',
  applicable_modules = 'eb',
  applies_to = 'all',
  description = 'Underlag för EB-utlåtandets avsnitt Provning, dokumentation.',
  is_default = true,
  result_label = seed_rows.result_label,
  result_unit = null,
  interval_note = case
    when seed_rows.result_label = 'Överlämnas'
      then 'Välj om handlingen överlämnas, inte överlämnas eller inte är aktuell.'
    else null
  end,
  is_active = true
from seed_rows
where document_type.code = seed_rows.code;
