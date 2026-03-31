-- RenoApp terminology foundation
-- Date: 2026-03-31
-- Additive only / rollback-safe:
--  - Adds glossary groups, terms, aliases and lightweight rule storage
--  - Seeds the locked vocabulary used in RenoApp admin/system
-- Prerequisite:
--  - 2026-03-30_01_renoapp_universal_apply_model.sql

create table if not exists public.renoapp_terminology_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_locked boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_terminology_groups_key_check
    check (key = lower(key) and key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint renoapp_terminology_groups_label_check
    check (btrim(label) <> ''),
  constraint renoapp_terminology_groups_sort_order_check
    check (sort_order > 0)
);

drop trigger if exists trg_renoapp_terminology_groups_set_updated_at on public.renoapp_terminology_groups;
create trigger trg_renoapp_terminology_groups_set_updated_at
before update on public.renoapp_terminology_groups
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_terminology_terms (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.renoapp_terminology_groups (id) on delete cascade,
  code text not null unique,
  label text not null,
  definition text,
  term_level text not null,
  input_kind text not null,
  is_locked boolean not null default true,
  is_user_selectable boolean not null default true,
  is_system_generated boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_terminology_terms_code_check
    check (code = lower(code) and code ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_terminology_terms_label_check
    check (btrim(label) <> ''),
  constraint renoapp_terminology_terms_term_level_check
    check (term_level in ('ux', 'technical', 'classification', 'status', 'document_phase', 'decision')),
  constraint renoapp_terminology_terms_input_kind_check
    check (input_kind in ('user_visible', 'system_internal', 'system_generated')),
  constraint renoapp_terminology_terms_sort_order_check
    check (sort_order > 0)
);

create index if not exists renoapp_terminology_terms_group_idx
  on public.renoapp_terminology_terms (group_id, sort_order);

drop trigger if exists trg_renoapp_terminology_terms_set_updated_at on public.renoapp_terminology_terms;
create trigger trg_renoapp_terminology_terms_set_updated_at
before update on public.renoapp_terminology_terms
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_terminology_aliases (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.renoapp_terminology_terms (id) on delete cascade,
  alias text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_terminology_aliases_alias_check
    check (btrim(alias) <> ''),
  constraint renoapp_terminology_aliases_sort_order_check
    check (sort_order > 0),
  constraint renoapp_terminology_aliases_term_alias_unique
    unique (term_id, alias)
);

create index if not exists renoapp_terminology_aliases_term_idx
  on public.renoapp_terminology_aliases (term_id, sort_order);

drop trigger if exists trg_renoapp_terminology_aliases_set_updated_at on public.renoapp_terminology_aliases;
create trigger trg_renoapp_terminology_aliases_set_updated_at
before update on public.renoapp_terminology_aliases
for each row
execute function public.renoapp_set_updated_at();

create table if not exists public.renoapp_terminology_rules (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.renoapp_terminology_terms (id) on delete cascade,
  rule_key text not null,
  label text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renoapp_terminology_rules_rule_key_check
    check (rule_key = lower(rule_key) and rule_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  constraint renoapp_terminology_rules_label_check
    check (btrim(label) <> ''),
  constraint renoapp_terminology_rules_sort_order_check
    check (sort_order > 0),
  constraint renoapp_terminology_rules_term_rule_unique
    unique (term_id, rule_key)
);

create index if not exists renoapp_terminology_rules_term_idx
  on public.renoapp_terminology_rules (term_id, sort_order);

drop trigger if exists trg_renoapp_terminology_rules_set_updated_at on public.renoapp_terminology_rules;
create trigger trg_renoapp_terminology_rules_set_updated_at
before update on public.renoapp_terminology_rules
for each row
execute function public.renoapp_set_updated_at();

insert into public.renoapp_terminology_groups (key, label, description, sort_order, is_locked, is_active)
values
  ('action-categories', 'Action categories', 'Huvudgrupper som boende mÃ¶ter i ansÃ¶kningsguiden.', 10, true, true),
  ('action-types', 'Action types', 'Renoveringstyper och anvÃ¤ndarval som driver RenoApps flÃ¶de.', 20, true, true),
  ('ux-definitions', 'UX-definitioner', 'LÃ¥sta definitioner av ord i boendeflÃ¶det.', 30, true, true),
  ('technical-impacts', 'Technical impacts', 'Tekniska pÃ¥verkansomrÃ¥den som styr logik, dokument och beslut.', 40, true, true),
  ('legal-classifications', 'Juridisk klassning', 'Systemgenererade klassningar som RenoApp hÃ¤rleder.', 50, true, true),
  ('statuses', 'Statusar', 'LÃ¥sta statuskoder fÃ¶r ansÃ¶kans livscykel.', 60, true, true),
  ('document-phases', 'Dokumentfaser', 'Faser som styr nÃ¤r dokument ska finnas tillgÃ¤ngliga.', 70, true, true),
  ('decision-terms', 'Besluts- och uppfÃ¶ljningstermer', 'Termer fÃ¶r beslut, villkor och uppfÃ¶ljning.', 80, true, true)
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_locked = excluded.is_locked,
  is_active = excluded.is_active;

insert into public.renoapp_terminology_terms (
  group_id,
  code,
  label,
  definition,
  term_level,
  input_kind,
  is_locked,
  is_user_selectable,
  is_system_generated,
  is_active,
  sort_order,
  metadata
)
select
  grp.id,
  seed.code,
  seed.label,
  seed.definition,
  seed.term_level,
  seed.input_kind,
  seed.is_locked,
  seed.is_user_selectable,
  seed.is_system_generated,
  seed.is_active,
  seed.sort_order,
  seed.metadata
from (
  values
    ('action-categories', 'vatrum', 'VÃ¥trum', 'Arbeten i badrum, tvÃ¤ttutrymmen och andra vÃ¥trum.', 'ux', 'user_visible', true, true, false, true, 10, '{"source":"system"}'::jsonb),
    ('action-categories', 'kok', 'KÃ¶k', 'Arbeten i kÃ¶k, kÃ¶ksinredning och kÃ¶ksnÃ¤ra installationer.', 'ux', 'user_visible', true, true, false, true, 20, '{"source":"system"}'::jsonb),
    ('action-categories', 'ytskikt', 'Ytskikt', 'MÃ¥lning, golv och andra enklare invÃ¤ndiga ytskikt.', 'ux', 'user_visible', true, true, false, true, 30, '{"source":"system"}'::jsonb),
    ('action-categories', 'vaggar_planlosning', 'VÃ¤ggar och planlÃ¶sning', 'Ã„ndringar av vÃ¤ggar och planlÃ¶sning i bostaden.', 'ux', 'user_visible', true, true, false, true, 40, '{"source":"system"}'::jsonb),
    ('action-categories', 'installationer', 'Installationer', 'Arbeten som pÃ¥verkar VVS, el eller ventilation.', 'ux', 'user_visible', true, true, false, true, 50, '{"source":"system"}'::jsonb),
    ('action-categories', 'ovrigt', 'Ã–vrigt', 'Ã–vriga renoveringar som inte passar i de vanliga kategorierna.', 'ux', 'user_visible', true, true, false, true, 60, '{"source":"system"}'::jsonb),
    ('action-categories', 'fasad_fonster_balkong', 'Fasad, fÃ¶nster, balkong', 'Framtida kategori fÃ¶r arbeten som pÃ¥verkar fasad eller yttre delar.', 'ux', 'user_visible', true, true, false, false, 70, '{"source":"glossary","future":true}'::jsonb),
    ('action-categories', 'storre_renovering', 'StÃ¶rre renovering', 'Framtida samlingskategori fÃ¶r mer omfattande renoveringar.', 'ux', 'user_visible', true, true, false, false, 80, '{"source":"glossary","future":true}'::jsonb),

    ('action-types', 'bathroom', 'Badrum', 'Renovering av badrum, tvÃ¤ttutrymme eller andra vÃ¥trum.', 'ux', 'user_visible', true, true, false, true, 10, '{"categoryCode":"vatrum"}'::jsonb),
    ('action-types', 'kitchen', 'KÃ¶k', 'Ã„ndringar i kÃ¶k, kÃ¶ksinredning eller installationer kopplade till kÃ¶k.', 'ux', 'user_visible', true, true, false, true, 20, '{"categoryCode":"kok"}'::jsonb),
    ('action-types', 'wall', 'VÃ¤ggar och planlÃ¶sning', 'Rivning, flytt eller uppbyggnad av vÃ¤ggar och planlÃ¶sningsÃ¤ndringar.', 'ux', 'user_visible', true, true, false, true, 30, '{"categoryCode":"vaggar_planlosning"}'::jsonb),
    ('action-types', 'plumbing', 'VVS-arbete', 'Ã„ndringar i vatten, avlopp eller annan VVS-installation.', 'ux', 'user_visible', true, true, false, true, 40, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'electrical', 'Elarbete', 'Ã„ndringar i elinstallationer, fasta elpunkter eller eldragning.', 'ux', 'user_visible', true, true, false, true, 50, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'ventilation', 'Ventilation', 'Ã„ndringar som pÃ¥verkar ventilation eller frÃ¥nluftssystem.', 'ux', 'user_visible', true, true, false, true, 60, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'surface', 'Ytskiktsrenovering', 'Ytskiktsrenovering som mÃ¥lning, golv eller andra ytskikt utan stÃ¶rre ingrepp.', 'ux', 'user_visible', true, true, false, true, 70, '{"categoryCode":"ytskikt"}'::jsonb),

    ('ux-definitions', 'renovera', 'Renovera', 'Ã…terstÃ¤lla eller uppgradera ett befintligt utrymme utan att anvÃ¤ndaren sjÃ¤lv behÃ¶ver avgÃ¶ra juridisk klassning.', 'ux', 'user_visible', true, true, false, true, 10, '{}'::jsonb),
    ('ux-definitions', 'bygga_nytt', 'Bygga nytt', 'Skapa en funktion som inte tidigare fanns i utrymmet.', 'ux', 'user_visible', true, true, false, true, 20, '{}'::jsonb),
    ('ux-definitions', 'flytta', 'Flytta', 'Ã„ndra placering av funktion, installation eller rumslig lÃ¶sning.', 'ux', 'user_visible', true, true, false, true, 30, '{}'::jsonb),
    ('ux-definitions', 'installera', 'Installera', 'LÃ¤gga till en ny komponent eller utrustning.', 'ux', 'user_visible', true, true, false, true, 40, '{}'::jsonb),
    ('ux-definitions', 'andra', 'Ã„ndra', 'Justera befintlig lÃ¶sning eller system.', 'ux', 'user_visible', true, true, false, true, 50, '{}'::jsonb),

    ('technical-impacts', 'wet_room', 'wet_room', 'TÃ¤tskikt, golvbrunn eller vÃ¥trumsmiljÃ¶ pÃ¥verkas.', 'technical', 'system_internal', true, false, false, true, 10, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'plumbing', 'plumbing', 'Vatten, avlopp, rÃ¶r eller golvbrunn pÃ¥verkas.', 'technical', 'system_internal', true, false, false, true, 20, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'electrical', 'electrical', 'Fast installerad el pÃ¥verkas.', 'technical', 'system_internal', true, false, false, true, 30, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'ventilation', 'ventilation', 'LuftflÃ¶de, ventil eller ventilationssystem pÃ¥verkas.', 'technical', 'system_internal', true, false, false, true, 40, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'structure', 'structure', 'VÃ¤gg, bjÃ¤lklag eller bÃ¤rande/stabiliserande del pÃ¥verkas.', 'technical', 'system_internal', true, false, false, true, 50, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'surface_only', 'surface_only', 'Arbetet Ã¤r begrÃ¤nsat till enklare ytskikt utan tekniska ingrepp.', 'technical', 'system_internal', true, false, false, true, 60, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'facade', 'facade', 'Byggnadens utsida pÃ¥verkas.', 'technical', 'system_internal', true, false, false, false, 70, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'balcony', 'balcony', 'Balkong, terrass eller uteplats pÃ¥verkas.', 'technical', 'system_internal', true, false, false, false, 80, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'heating', 'heating', 'VÃ¤rmesystem eller golvvÃ¤rme pÃ¥verkas.', 'technical', 'system_internal', true, false, false, false, 90, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'fire', 'fire', 'Brandklassning eller brandskydd pÃ¥verkas.', 'technical', 'system_internal', true, false, false, false, 100, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'noise', 'noise', 'Ljudisolering eller ljudpÃ¥verkan fÃ¶rÃ¤ndras.', 'technical', 'system_internal', true, false, false, false, 110, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'drainage', 'drainage', 'Vattenavledning, lutning eller drÃ¤neringsliknande funktion pÃ¥verkas.', 'technical', 'system_internal', true, false, false, false, 120, '{"source":"glossary","future":true}'::jsonb),

    ('legal-classifications', 'underhall', 'underhÃ¥ll', 'Ã…tgÃ¤rd som normalt inte Ã¤ndrar funktion eller teknisk huvudlÃ¶sning.', 'classification', 'system_generated', true, false, true, true, 10, '{}'::jsonb),
    ('legal-classifications', 'renovering', 'renovering', 'Uppgradering eller Ã¥terstÃ¤llning utan stÃ¶rre funktionsÃ¤ndring.', 'classification', 'system_generated', true, false, true, true, 20, '{}'::jsonb),
    ('legal-classifications', 'ombyggnad', 'ombyggnad', 'Ã„ndring av funktion, planlÃ¶sning eller teknisk huvudlÃ¶sning.', 'classification', 'system_generated', true, false, true, true, 30, '{}'::jsonb),
    ('legal-classifications', 'tillbyggnad', 'tillbyggnad', 'Ã–kning av byggnadens volym.', 'classification', 'system_generated', true, false, true, true, 40, '{}'::jsonb),
    ('legal-classifications', 'nyinstallation', 'nyinstallation', 'Ny teknisk funktion eller installation tillfÃ¶rs.', 'classification', 'system_generated', true, false, true, true, 50, '{}'::jsonb),

    ('statuses', 'draft', 'Utkast', 'Utkast som Ã¤nnu inte skickats in.', 'status', 'system_internal', true, false, false, true, 10, '{}'::jsonb),
    ('statuses', 'submitted', 'Inskickad', 'AnsÃ¶kan Ã¤r inskickad.', 'status', 'system_internal', true, false, false, true, 20, '{}'::jsonb),
    ('statuses', 'need_info', 'BehÃ¶ver komplettering', 'Komplettering krÃ¤vs innan Ã¤rendet kan granskas vidare.', 'status', 'system_internal', true, false, false, true, 30, '{}'::jsonb),
    ('statuses', 'ready_for_review', 'Klar fÃ¶r granskning', 'Ã„rendet Ã¤r tillrÃ¤ckligt komplett fÃ¶r granskning.', 'status', 'system_internal', true, false, false, true, 40, '{}'::jsonb),
    ('statuses', 'approved', 'GodkÃ¤nd', 'Ã„rendet Ã¤r godkÃ¤nt utan sÃ¤rskilda villkor.', 'status', 'system_internal', true, false, false, true, 50, '{}'::jsonb),
    ('statuses', 'approved_with_conditions', 'GodkÃ¤nd med villkor', 'Ã„rendet Ã¤r godkÃ¤nt med villkor som mÃ¥ste fÃ¶ljas.', 'status', 'system_internal', true, false, false, true, 60, '{}'::jsonb),
    ('statuses', 'rejected', 'Avslagen', 'Ã„rendet Ã¤r avslaget.', 'status', 'system_internal', true, false, false, true, 70, '{}'::jsonb),
    ('statuses', 'completed', 'Avslutad', 'Ã„rendet Ã¤r slutredovisat, uppfÃ¶ljt och avslutat.', 'status', 'system_internal', true, false, false, true, 80, '{}'::jsonb),

    ('document-phases', 'before_required', 'before_required', 'Dokument som alltid mÃ¥ste finnas fÃ¶re ansÃ¶kan eller granskning.', 'document_phase', 'system_internal', true, false, false, true, 10, '{}'::jsonb),
    ('document-phases', 'before_conditional', 'before_conditional', 'Dokument som krÃ¤vs om viss teknisk pÃ¥verkan eller vissa svar finns.', 'document_phase', 'system_internal', true, false, false, true, 20, '{}'::jsonb),
    ('document-phases', 'after_completion', 'after_completion', 'Dokument som ska lÃ¤mnas in efter att arbetet har utfÃ¶rts.', 'document_phase', 'system_internal', true, false, false, true, 30, '{}'::jsonb),

    ('decision-terms', 'beslut', 'Beslut', 'Formellt stÃ¤llningstagande till ansÃ¶kan.', 'decision', 'system_generated', true, false, true, true, 10, '{}'::jsonb),
    ('decision-terms', 'villkor', 'Villkor', 'Krav som kopplas till beslutet och som ska fÃ¶ljas under genomfÃ¶randet.', 'decision', 'system_generated', true, false, true, true, 20, '{}'::jsonb),
    ('decision-terms', 'kontrollpunkt', 'Kontrollpunkt', 'Punkt som fÃ¶ljs upp efter utfÃ¶rt arbete fÃ¶r att verifiera att beslut och utfÃ¶rande stÃ¤mmer.', 'decision', 'system_generated', true, false, true, true, 30, '{}'::jsonb),
    ('decision-terms', 'komplettering', 'Komplettering', 'EfterfrÃ¥gat underlag eller svar som behÃ¶vs fÃ¶r fortsatt handlÃ¤ggning.', 'decision', 'system_generated', true, false, true, true, 40, '{}'::jsonb),
    ('decision-terms', 'slutredovisning', 'Slutredovisning', 'Underlag som visar att arbetet Ã¤r utfÃ¶rt och kan avslutas.', 'decision', 'system_generated', true, false, true, true, 50, '{}'::jsonb)
) as seed (
  group_key,
  code,
  label,
  definition,
  term_level,
  input_kind,
  is_locked,
  is_user_selectable,
  is_system_generated,
  is_active,
  sort_order,
  metadata
)
join public.renoapp_terminology_groups grp
  on grp.key = seed.group_key
on conflict (code) do update
set
  group_id = excluded.group_id,
  label = excluded.label,
  definition = excluded.definition,
  term_level = excluded.term_level,
  input_kind = excluded.input_kind,
  is_locked = excluded.is_locked,
  is_user_selectable = excluded.is_user_selectable,
  is_system_generated = excluded.is_system_generated,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata;

insert into public.renoapp_terminology_aliases (term_id, alias, sort_order, is_active)
select
  term_row.id,
  seed.alias,
  seed.sort_order,
  seed.is_active
from (
  values
    ('bathroom', 'Renovera badrum', 10, true),
    ('bathroom', 'Bygga nytt badrum', 20, true),
    ('bathroom', 'Installera tvÃ¤ttmaskin', 30, true),
    ('bathroom', 'Flytta eller byta golvbrunn', 40, true),
    ('bathroom', 'badrumsrenovering', 50, true),
    ('kitchen', 'Renovera kÃ¶k', 10, true),
    ('kitchen', 'Flytta kÃ¶k', 20, true),
    ('kitchen', 'kÃ¶ksrenovering', 30, true),
    ('wall', 'Ã„ndra planlÃ¶sning', 10, true),
    ('wall', 'Riva vÃ¤gg', 20, true),
    ('wall', 'Bygga vÃ¤gg', 30, true),
    ('ventilation', 'Ã„ndra ventilation', 10, true),
    ('plumbing', 'UtfÃ¶ra VVS-arbete', 10, true),
    ('plumbing', 'VVS', 20, true),
    ('electrical', 'UtfÃ¶ra elarbete', 10, true),
    ('surface', 'Ytskiktsrenovering', 10, true),
    ('ombyggnad', 'ombyggnation', 10, true),
    ('kitchen', 'flytt av kÃ¶k', 40, true)
) as seed (term_code, alias, sort_order, is_active)
join public.renoapp_terminology_terms term_row
  on term_row.code = seed.term_code
on conflict (term_id, alias) do update
set
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.renoapp_terminology_rules (term_id, rule_key, label, description, config, sort_order, is_active)
select
  term_row.id,
  seed.rule_key,
  seed.label,
  seed.description,
  seed.config,
  seed.sort_order,
  seed.is_active
from (
  values
    ('bathroom', 'maps_to_action_category', 'Kopplad kategori', 'PrimÃ¤r koppling till action category.', '{"categoryCode":"vatrum"}'::jsonb, 10, true),
    ('bathroom', 'implies_impacts', 'Impakter', 'VÃ¥trumsarbete pÃ¥verkar normalt flera tekniska omrÃ¥den.', '{"impactCodes":["wet_room","plumbing","electrical"]}'::jsonb, 20, true),
    ('bathroom', 'default_classification', 'Standardklassning', 'FÃ¶rvald systemklassning nÃ¤r inga ytterligare svar avviker.', '{"classificationCode":"renovering"}'::jsonb, 30, true),
    ('kitchen', 'maps_to_action_category', 'Kopplad kategori', 'PrimÃ¤r koppling till action category.', '{"categoryCode":"kok"}'::jsonb, 10, true),
    ('kitchen', 'implies_impacts', 'Impakter', 'KÃ¶ksarbete pÃ¥verkar normalt VVS och el.', '{"impactCodes":["plumbing","electrical"]}'::jsonb, 20, true),
    ('kitchen', 'default_classification', 'Standardklassning', 'FÃ¶rvald systemklassning nÃ¤r inga ytterligare svar avviker.', '{"classificationCode":"renovering"}'::jsonb, 30, true),
    ('wall', 'maps_to_action_category', 'Kopplad kategori', 'PrimÃ¤r koppling till action category.', '{"categoryCode":"vaggar_planlosning"}'::jsonb, 10, true),
    ('wall', 'implies_impacts', 'Impakter', 'PlanlÃ¶sningsÃ¤ndringar antyder strukturell pÃ¥verkan.', '{"impactCodes":["structure"]}'::jsonb, 20, true),
    ('wall', 'default_classification', 'Standardklassning', 'VÃ¤gg- och planlÃ¶sningsÃ¤ndringar klassas normalt som ombyggnad.', '{"classificationCode":"ombyggnad"}'::jsonb, 30, true),
    ('surface', 'maps_to_action_category', 'Kopplad kategori', 'PrimÃ¤r koppling till action category.', '{"categoryCode":"ytskikt"}'::jsonb, 10, true),
    ('surface', 'implies_impacts', 'Impakter', 'Ytskiktsrenovering begrÃ¤nsas normalt till surface_only.', '{"impactCodes":["surface_only"]}'::jsonb, 20, true),
    ('surface', 'default_classification', 'Standardklassning', 'Enklare ytskiktsarbete klassas normalt som underhÃ¥ll.', '{"classificationCode":"underhall"}'::jsonb, 30, true),
    ('ombyggnad', 'classification_policy', 'Klassningspolicy', 'Ombyggnad ska vara huvudterm och systemgenererad klassning.', '{"preferredAlias":"ombyggnation","userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('underhall', 'classification_policy', 'Klassningspolicy', 'UnderhÃ¥ll sÃ¤tts av systemet nÃ¤r arbetet inte Ã¤ndrar funktion eller teknisk huvudlÃ¶sning.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('renovering', 'classification_policy', 'Klassningspolicy', 'Renovering sÃ¤tts av systemet efter analys av Ã¥tgÃ¤rden.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('nyinstallation', 'classification_policy', 'Klassningspolicy', 'Nyinstallation sÃ¤tts av systemet nÃ¤r ny funktion tillfÃ¶rs.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('before_required', 'phase_policy', 'Faspolicy', 'Dokumentet mÃ¥ste finnas innan ansÃ¶kan eller granskning gÃ¥r vidare.', '{"timing":"before","requiredByDefault":true}'::jsonb, 10, true),
    ('before_conditional', 'phase_policy', 'Faspolicy', 'Dokumentet krÃ¤vs bara nÃ¤r vissa svar eller impacts finns.', '{"timing":"before","conditional":true}'::jsonb, 10, true),
    ('after_completion', 'phase_policy', 'Faspolicy', 'Dokumentet efterfrÃ¥gas efter att arbetet Ã¤r utfÃ¶rt.', '{"timing":"after_completion"}'::jsonb, 10, true),
    ('approved', 'workflow_state', 'Workflow policy', 'GodkÃ¤nd utan villkor.', '{"isTerminal":false,"allowsConditions":false}'::jsonb, 10, true),
    ('approved_with_conditions', 'workflow_state', 'Workflow policy', 'GodkÃ¤nd med villkor som ska fÃ¶ljas upp.', '{"isTerminal":false,"allowsConditions":true}'::jsonb, 10, true),
    ('rejected', 'workflow_state', 'Workflow policy', 'Avslag avslutar normalt handlÃ¤ggningen.', '{"isTerminal":true}'::jsonb, 10, true),
    ('completed', 'workflow_state', 'Workflow policy', 'SlutfÃ¶rt och avslutat Ã¤rende.', '{"isTerminal":true,"isClosed":true}'::jsonb, 10, true)
) as seed (term_code, rule_key, label, description, config, sort_order, is_active)
join public.renoapp_terminology_terms term_row
  on term_row.code = seed.term_code
on conflict (term_id, rule_key) do update
set
  label = excluded.label,
  description = excluded.description,
  config = excluded.config,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
