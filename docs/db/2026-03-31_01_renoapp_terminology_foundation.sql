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
  code text not null,
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

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'renoapp_terminology_terms_code_key'
  ) then
    alter table public.renoapp_terminology_terms
      drop constraint renoapp_terminology_terms_code_key;
  end if;
end $$;

create unique index if not exists renoapp_terminology_terms_group_code_idx
  on public.renoapp_terminology_terms (group_id, code);

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
  ('action-categories', 'Action categories', 'Huvudgrupper som boende m�f¶ter i ans�f¶kningsguiden.', 10, true, true),
  ('action-types', 'Action types', 'Renoveringstyper och anv�f¤ndarval som driver RenoApps fl�f¶de.', 20, true, true),
  ('ux-definitions', 'UX-definitioner', 'L�f¥sta definitioner av ord i boendefl�f¶det.', 30, true, true),
  ('technical-impacts', 'Technical impacts', 'Tekniska p�f¥verkansomr�f¥den som styr logik, dokument och beslut.', 40, true, true),
  ('legal-classifications', 'Juridisk klassning', 'Systemgenererade klassningar som RenoApp h�f¤rleder.', 50, true, true),
  ('statuses', 'Statusar', 'L�f¥sta statuskoder f�f¶r ans�f¶kans livscykel.', 60, true, true),
  ('document-phases', 'Dokumentfaser', 'Faser som styr n�f¤r dokument ska finnas tillg�f¤ngliga.', 70, true, true),
  ('decision-terms', 'Besluts- och uppf�f¶ljningstermer', 'Termer f�f¶r beslut, villkor och uppf�f¶ljning.', 80, true, true)
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
    ('action-categories', 'vatrum', 'V�f¥trum', 'Arbeten i badrum, tv�f¤ttutrymmen och andra v�f¥trum.', 'ux', 'user_visible', true, true, false, true, 10, '{"source":"system"}'::jsonb),
    ('action-categories', 'kok', 'K�f¶k', 'Arbeten i k�f¶k, k�f¶ksinredning och k�f¶ksn�f¤ra installationer.', 'ux', 'user_visible', true, true, false, true, 20, '{"source":"system"}'::jsonb),
    ('action-categories', 'ytskikt', 'Ytskikt', 'M�f¥lning, golv och andra enklare inv�f¤ndiga ytskikt.', 'ux', 'user_visible', true, true, false, true, 30, '{"source":"system"}'::jsonb),
    ('action-categories', 'vaggar_planlosning', 'V�f¤ggar och planl�f¶sning', '�f�?zndringar av v�f¤ggar och planl�f¶sning i bostaden.', 'ux', 'user_visible', true, true, false, true, 40, '{"source":"system"}'::jsonb),
    ('action-categories', 'installationer', 'Installationer', 'Arbeten som p�f¥verkar VVS, el eller ventilation.', 'ux', 'user_visible', true, true, false, true, 50, '{"source":"system"}'::jsonb),
    ('action-categories', 'ovrigt', '�f�?"vrigt', '�f�?"vriga renoveringar som inte passar i de vanliga kategorierna.', 'ux', 'user_visible', true, true, false, true, 60, '{"source":"system"}'::jsonb),
    ('action-categories', 'fasad_fonster_balkong', 'Fasad, f�f¶nster, balkong', 'Framtida kategori f�f¶r arbeten som p�f¥verkar fasad eller yttre delar.', 'ux', 'user_visible', true, true, false, false, 70, '{"source":"glossary","future":true}'::jsonb),
    ('action-categories', 'storre_renovering', 'St�f¶rre renovering', 'Framtida samlingskategori f�f¶r mer omfattande renoveringar.', 'ux', 'user_visible', true, true, false, false, 80, '{"source":"glossary","future":true}'::jsonb),

    ('action-types', 'bathroom', 'Badrum', 'Renovering av badrum, tv�f¤ttutrymme eller andra v�f¥trum.', 'ux', 'user_visible', true, true, false, true, 10, '{"categoryCode":"vatrum"}'::jsonb),
    ('action-types', 'kitchen', 'K�f¶k', '�f�?zndringar i k�f¶k, k�f¶ksinredning eller installationer kopplade till k�f¶k.', 'ux', 'user_visible', true, true, false, true, 20, '{"categoryCode":"kok"}'::jsonb),
    ('action-types', 'wall', 'V�f¤ggar och planl�f¶sning', 'Rivning, flytt eller uppbyggnad av v�f¤ggar och planl�f¶snings�f¤ndringar.', 'ux', 'user_visible', true, true, false, true, 30, '{"categoryCode":"vaggar_planlosning"}'::jsonb),
    ('action-types', 'plumbing', 'VVS-arbete', '�f�?zndringar i vatten, avlopp eller annan VVS-installation.', 'ux', 'user_visible', true, true, false, true, 40, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'electrical', 'Elarbete', '�f�?zndringar i elinstallationer, fasta elpunkter eller eldragning.', 'ux', 'user_visible', true, true, false, true, 50, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'ventilation', 'Ventilation', '�f�?zndringar som p�f¥verkar ventilation eller fr�f¥nluftssystem.', 'ux', 'user_visible', true, true, false, true, 60, '{"categoryCode":"installationer"}'::jsonb),
    ('action-types', 'surface', 'Ytskiktsrenovering', 'Ytskiktsrenovering som m�f¥lning, golv eller andra ytskikt utan st�f¶rre ingrepp.', 'ux', 'user_visible', true, true, false, true, 70, '{"categoryCode":"ytskikt"}'::jsonb),

    ('ux-definitions', 'renovera', 'Renovera', '�f�?�terst�f¤lla eller uppgradera ett befintligt utrymme utan att anv�f¤ndaren sj�f¤lv beh�f¶ver avg�f¶ra juridisk klassning.', 'ux', 'user_visible', true, true, false, true, 10, '{}'::jsonb),
    ('ux-definitions', 'bygga_nytt', 'Bygga nytt', 'Skapa en funktion som inte tidigare fanns i utrymmet.', 'ux', 'user_visible', true, true, false, true, 20, '{}'::jsonb),
    ('ux-definitions', 'flytta', 'Flytta', '�f�?zndra placering av funktion, installation eller rumslig l�f¶sning.', 'ux', 'user_visible', true, true, false, true, 30, '{}'::jsonb),
    ('ux-definitions', 'installera', 'Installera', 'L�f¤gga till en ny komponent eller utrustning.', 'ux', 'user_visible', true, true, false, true, 40, '{}'::jsonb),
    ('ux-definitions', 'andra', '�f�?zndra', 'Justera befintlig l�f¶sning eller system.', 'ux', 'user_visible', true, true, false, true, 50, '{}'::jsonb),

    ('technical-impacts', 'wet_room', 'wet_room', 'T�f¤tskikt, golvbrunn eller v�f¥trumsmilj�f¶ p�f¥verkas.', 'technical', 'system_internal', true, false, false, true, 10, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'plumbing', 'plumbing', 'Vatten, avlopp, r�f¶r eller golvbrunn p�f¥verkas.', 'technical', 'system_internal', true, false, false, true, 20, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'electrical', 'electrical', 'Fast installerad el p�f¥verkas.', 'technical', 'system_internal', true, false, false, true, 30, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'ventilation', 'ventilation', 'Luftfl�f¶de, ventil eller ventilationssystem p�f¥verkas.', 'technical', 'system_internal', true, false, false, true, 40, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'structure', 'structure', 'V�f¤gg, bj�f¤lklag eller b�f¤rande/stabiliserande del p�f¥verkas.', 'technical', 'system_internal', true, false, false, true, 50, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'surface_only', 'surface_only', 'Arbetet �f¤r begr�f¤nsat till enklare ytskikt utan tekniska ingrepp.', 'technical', 'system_internal', true, false, false, true, 60, '{"source":"system"}'::jsonb),
    ('technical-impacts', 'facade', 'facade', 'Byggnadens utsida p�f¥verkas.', 'technical', 'system_internal', true, false, false, false, 70, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'balcony', 'balcony', 'Balkong, terrass eller uteplats p�f¥verkas.', 'technical', 'system_internal', true, false, false, false, 80, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'heating', 'heating', 'V�f¤rmesystem eller golvv�f¤rme p�f¥verkas.', 'technical', 'system_internal', true, false, false, false, 90, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'fire', 'fire', 'Brandklassning eller brandskydd p�f¥verkas.', 'technical', 'system_internal', true, false, false, false, 100, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'noise', 'noise', 'Ljudisolering eller ljudp�f¥verkan f�f¶r�f¤ndras.', 'technical', 'system_internal', true, false, false, false, 110, '{"source":"glossary","future":true}'::jsonb),
    ('technical-impacts', 'drainage', 'drainage', 'Vattenavledning, lutning eller dr�f¤neringsliknande funktion p�f¥verkas.', 'technical', 'system_internal', true, false, false, false, 120, '{"source":"glossary","future":true}'::jsonb),

    ('legal-classifications', 'underhall', 'underh�f¥ll', '�f�?�tg�f¤rd som normalt inte �f¤ndrar funktion eller teknisk huvudl�f¶sning.', 'classification', 'system_generated', true, false, true, true, 10, '{}'::jsonb),
    ('legal-classifications', 'renovering', 'renovering', 'Uppgradering eller �f¥terst�f¤llning utan st�f¶rre funktions�f¤ndring.', 'classification', 'system_generated', true, false, true, true, 20, '{}'::jsonb),
    ('legal-classifications', 'ombyggnad', 'ombyggnad', '�f�?zndring av funktion, planl�f¶sning eller teknisk huvudl�f¶sning.', 'classification', 'system_generated', true, false, true, true, 30, '{}'::jsonb),
    ('legal-classifications', 'tillbyggnad', 'tillbyggnad', '�f�?"kning av byggnadens volym.', 'classification', 'system_generated', true, false, true, true, 40, '{}'::jsonb),
    ('legal-classifications', 'nyinstallation', 'nyinstallation', 'Ny teknisk funktion eller installation tillf�f¶rs.', 'classification', 'system_generated', true, false, true, true, 50, '{}'::jsonb),

    ('statuses', 'draft', 'Utkast', 'Utkast som �f¤nnu inte skickats in.', 'status', 'system_internal', true, false, false, true, 10, '{}'::jsonb),
    ('statuses', 'submitted', 'Inskickad', 'Ans�f¶kan �f¤r inskickad.', 'status', 'system_internal', true, false, false, true, 20, '{}'::jsonb),
    ('statuses', 'need_info', 'Beh�f¶ver komplettering', 'Komplettering kr�f¤vs innan �f¤rendet kan granskas vidare.', 'status', 'system_internal', true, false, false, true, 30, '{}'::jsonb),
    ('statuses', 'ready_for_review', 'Klar f�f¶r granskning', '�f�?zrendet �f¤r tillr�f¤ckligt komplett f�f¶r granskning.', 'status', 'system_internal', true, false, false, true, 40, '{}'::jsonb),
    ('statuses', 'approved', 'Godk�f¤nd', '�f�?zrendet �f¤r godk�f¤nt utan s�f¤rskilda villkor.', 'status', 'system_internal', true, false, false, true, 50, '{}'::jsonb),
    ('statuses', 'approved_with_conditions', 'Godk�f¤nd med villkor', '�f�?zrendet �f¤r godk�f¤nt med villkor som m�f¥ste f�f¶ljas.', 'status', 'system_internal', true, false, false, true, 60, '{}'::jsonb),
    ('statuses', 'rejected', 'Avslagen', '�f�?zrendet �f¤r avslaget.', 'status', 'system_internal', true, false, false, true, 70, '{}'::jsonb),
    ('statuses', 'completed', 'Avslutad', '�f�?zrendet �f¤r slutredovisat, uppf�f¶ljt och avslutat.', 'status', 'system_internal', true, false, false, true, 80, '{}'::jsonb),

    ('document-phases', 'before_required', 'before_required', 'Dokument som alltid m�f¥ste finnas f�f¶re ans�f¶kan eller granskning.', 'document_phase', 'system_internal', true, false, false, true, 10, '{}'::jsonb),
    ('document-phases', 'before_conditional', 'before_conditional', 'Dokument som kr�f¤vs om viss teknisk p�f¥verkan eller vissa svar finns.', 'document_phase', 'system_internal', true, false, false, true, 20, '{}'::jsonb),
    ('document-phases', 'after_completion', 'after_completion', 'Dokument som ska l�f¤mnas in efter att arbetet har utf�f¶rts.', 'document_phase', 'system_internal', true, false, false, true, 30, '{}'::jsonb),

    ('decision-terms', 'beslut', 'Beslut', 'Formellt st�f¤llningstagande till ans�f¶kan.', 'decision', 'system_generated', true, false, true, true, 10, '{}'::jsonb),
    ('decision-terms', 'villkor', 'Villkor', 'Krav som kopplas till beslutet och som ska f�f¶ljas under genomf�f¶randet.', 'decision', 'system_generated', true, false, true, true, 20, '{}'::jsonb),
    ('decision-terms', 'kontrollpunkt', 'Kontrollpunkt', 'Punkt som f�f¶ljs upp efter utf�f¶rt arbete f�f¶r att verifiera att beslut och utf�f¶rande st�f¤mmer.', 'decision', 'system_generated', true, false, true, true, 30, '{}'::jsonb),
    ('decision-terms', 'komplettering', 'Komplettering', 'Efterfr�f¥gat underlag eller svar som beh�f¶vs f�f¶r fortsatt handl�f¤ggning.', 'decision', 'system_generated', true, false, true, true, 40, '{}'::jsonb),
    ('decision-terms', 'slutredovisning', 'Slutredovisning', 'Underlag som visar att arbetet �f¤r utf�f¶rt och kan avslutas.', 'decision', 'system_generated', true, false, true, true, 50, '{}'::jsonb)
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
on conflict (group_id, code) do update
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
    ('action-types', 'bathroom', 'Renovera badrum', 10, true),
    ('action-types', 'bathroom', 'Bygga nytt badrum', 20, true),
    ('action-types', 'bathroom', 'Installera tv�f¤ttmaskin', 30, true),
    ('action-types', 'bathroom', 'Flytta eller byta golvbrunn', 40, true),
    ('action-types', 'bathroom', 'badrumsrenovering', 50, true),
    ('action-types', 'kitchen', 'Renovera k�f¶k', 10, true),
    ('action-types', 'kitchen', 'Flytta k�f¶k', 20, true),
    ('action-types', 'kitchen', 'k�f¶ksrenovering', 30, true),
    ('action-types', 'wall', '�f�?zndra planl�f¶sning', 10, true),
    ('action-types', 'wall', 'Riva v�f¤gg', 20, true),
    ('action-types', 'wall', 'Bygga v�f¤gg', 30, true),
    ('action-types', 'ventilation', '�f�?zndra ventilation', 10, true),
    ('action-types', 'plumbing', 'Utf�f¶ra VVS-arbete', 10, true),
    ('action-types', 'plumbing', 'VVS', 20, true),
    ('action-types', 'electrical', 'Utf�f¶ra elarbete', 10, true),
    ('action-types', 'surface', 'Ytskiktsrenovering', 10, true),
    ('legal-classifications', 'ombyggnad', 'ombyggnation', 10, true),
    ('action-types', 'kitchen', 'flytt av k�f¶k', 40, true)
) as seed (group_key, term_code, alias, sort_order, is_active)
join public.renoapp_terminology_terms term_row
  on term_row.code = seed.term_code
 and term_row.group_id = (
   select id
   from public.renoapp_terminology_groups
   where key = seed.group_key
 )
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
    ('action-types', 'bathroom', 'maps_to_action_category', 'Kopplad kategori', 'Prim�f¤r koppling till action category.', '{"categoryCode":"vatrum"}'::jsonb, 10, true),
    ('action-types', 'bathroom', 'implies_impacts', 'Impakter', 'V�f¥trumsarbete p�f¥verkar normalt flera tekniska omr�f¥den.', '{"impactCodes":["wet_room","plumbing","electrical"]}'::jsonb, 20, true),
    ('action-types', 'bathroom', 'default_classification', 'Standardklassning', 'F�f¶rvald systemklassning n�f¤r inga ytterligare svar avviker.', '{"classificationCode":"renovering"}'::jsonb, 30, true),
    ('action-types', 'kitchen', 'maps_to_action_category', 'Kopplad kategori', 'Prim�f¤r koppling till action category.', '{"categoryCode":"kok"}'::jsonb, 10, true),
    ('action-types', 'kitchen', 'implies_impacts', 'Impakter', 'K�f¶ksarbete p�f¥verkar normalt VVS och el.', '{"impactCodes":["plumbing","electrical"]}'::jsonb, 20, true),
    ('action-types', 'kitchen', 'default_classification', 'Standardklassning', 'F�f¶rvald systemklassning n�f¤r inga ytterligare svar avviker.', '{"classificationCode":"renovering"}'::jsonb, 30, true),
    ('action-types', 'wall', 'maps_to_action_category', 'Kopplad kategori', 'Prim�f¤r koppling till action category.', '{"categoryCode":"vaggar_planlosning"}'::jsonb, 10, true),
    ('action-types', 'wall', 'implies_impacts', 'Impakter', 'Planl�f¶snings�f¤ndringar antyder strukturell p�f¥verkan.', '{"impactCodes":["structure"]}'::jsonb, 20, true),
    ('action-types', 'wall', 'default_classification', 'Standardklassning', 'V�f¤gg- och planl�f¶snings�f¤ndringar klassas normalt som ombyggnad.', '{"classificationCode":"ombyggnad"}'::jsonb, 30, true),
    ('action-types', 'surface', 'maps_to_action_category', 'Kopplad kategori', 'Prim�f¤r koppling till action category.', '{"categoryCode":"ytskikt"}'::jsonb, 10, true),
    ('action-types', 'surface', 'implies_impacts', 'Impakter', 'Ytskiktsrenovering begr�f¤nsas normalt till surface_only.', '{"impactCodes":["surface_only"]}'::jsonb, 20, true),
    ('action-types', 'surface', 'default_classification', 'Standardklassning', 'Enklare ytskiktsarbete klassas normalt som underh�f¥ll.', '{"classificationCode":"underhall"}'::jsonb, 30, true),
    ('legal-classifications', 'ombyggnad', 'classification_policy', 'Klassningspolicy', 'Ombyggnad ska vara huvudterm och systemgenererad klassning.', '{"preferredAlias":"ombyggnation","userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('legal-classifications', 'underhall', 'classification_policy', 'Klassningspolicy', 'Underh�f¥ll s�f¤tts av systemet n�f¤r arbetet inte �f¤ndrar funktion eller teknisk huvudl�f¶sning.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('legal-classifications', 'renovering', 'classification_policy', 'Klassningspolicy', 'Renovering s�f¤tts av systemet efter analys av �f¥tg�f¤rden.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('legal-classifications', 'nyinstallation', 'classification_policy', 'Klassningspolicy', 'Nyinstallation s�f¤tts av systemet n�f¤r ny funktion tillf�f¶rs.', '{"userSelectable":false,"systemGenerated":true}'::jsonb, 10, true),
    ('document-phases', 'before_required', 'phase_policy', 'Faspolicy', 'Dokumentet m�f¥ste finnas innan ans�f¶kan eller granskning g�f¥r vidare.', '{"timing":"before","requiredByDefault":true}'::jsonb, 10, true),
    ('document-phases', 'before_conditional', 'phase_policy', 'Faspolicy', 'Dokumentet kr�f¤vs bara n�f¤r vissa svar eller impacts finns.', '{"timing":"before","conditional":true}'::jsonb, 10, true),
    ('document-phases', 'after_completion', 'phase_policy', 'Faspolicy', 'Dokumentet efterfr�f¥gas efter att arbetet �f¤r utf�f¶rt.', '{"timing":"after_completion"}'::jsonb, 10, true),
    ('statuses', 'approved', 'workflow_state', 'Workflow policy', 'Godk�f¤nd utan villkor.', '{"isTerminal":false,"allowsConditions":false}'::jsonb, 10, true),
    ('statuses', 'approved_with_conditions', 'workflow_state', 'Workflow policy', 'Godk�f¤nd med villkor som ska f�f¶ljas upp.', '{"isTerminal":false,"allowsConditions":true}'::jsonb, 10, true),
    ('statuses', 'rejected', 'workflow_state', 'Workflow policy', 'Avslag avslutar normalt handl�f¤ggningen.', '{"isTerminal":true}'::jsonb, 10, true),
    ('statuses', 'completed', 'workflow_state', 'Workflow policy', 'Slutf�f¶rt och avslutat �f¤rende.', '{"isTerminal":true,"isClosed":true}'::jsonb, 10, true)
) as seed (group_key, term_code, rule_key, label, description, config, sort_order, is_active)
join public.renoapp_terminology_terms term_row
  on term_row.code = seed.term_code
 and term_row.group_id = (
   select id
   from public.renoapp_terminology_groups
   where key = seed.group_key
 )
on conflict (term_id, rule_key) do update
set
  label = excluded.label,
  description = excluded.description,
  config = excluded.config,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
