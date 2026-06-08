-- EB drainage/foundation inspection template support
-- Date: 2026-06-08
-- Scope:
-- 1) Add project-level template fields for drainage/foundation inspections
-- 2) Seed a shared drainage checklist with Isodran and Pordran variants
-- 3) Store inspection checkpoint results separately from EB notes
-- 4) Protect checkpoint results with the shared locked-inspection write guard

create extension if not exists pgcrypto;

alter table public.eb_projects
  add column if not exists project_template_key text,
  add column if not exists drainage_system text,
  add column if not exists drainage_inspection_stage text,
  add column if not exists drainage_guidance_version text;

alter table public.eb_projects
  drop constraint if exists eb_projects_drainage_system_check,
  drop constraint if exists eb_projects_drainage_inspection_stage_check;

alter table public.eb_projects
  add constraint eb_projects_drainage_system_check
    check (
      drainage_system is null
      or drainage_system in ('generic', 'isodran', 'pordran', 'other')
    ),
  add constraint eb_projects_drainage_inspection_stage_check
    check (
      drainage_inspection_stage is null
      or drainage_inspection_stage in ('before_backfill', 'after_backfill', 'partial', 'final')
    );

comment on column public.eb_projects.project_template_key is
  'Optional EB project template key. Example: drainage_foundation.';
comment on column public.eb_projects.drainage_system is
  'Drainage/foundation system for the EB drainage template: generic, isodran, pordran or other.';
comment on column public.eb_projects.drainage_inspection_stage is
  'Inspection stage for drainage/foundation controls: before_backfill, after_backfill, partial or final.';
comment on column public.eb_projects.drainage_guidance_version is
  'Free-text reference to the product guidance/version used as inspection basis.';

create table if not exists public.settings_eb_project_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_project_templates_key_check check (btrim(key) <> ''),
  constraint settings_eb_project_templates_label_check check (btrim(label) <> '')
);

drop trigger if exists trg_settings_eb_project_templates_set_updated_at
  on public.settings_eb_project_templates;
create trigger trg_settings_eb_project_templates_set_updated_at
before update on public.settings_eb_project_templates
for each row
execute function public.eb_set_updated_at();

create table if not exists public.settings_eb_template_checkpoints (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.settings_eb_project_templates (key) on delete cascade,
  key text not null unique,
  system_key text not null default 'generic',
  group_key text not null,
  group_label text not null,
  title text not null,
  guidance text,
  verification_method text,
  source_url text,
  photo_required boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_eb_template_checkpoints_key_check check (btrim(key) <> ''),
  constraint settings_eb_template_checkpoints_system_check
    check (system_key in ('generic', 'isodran', 'pordran', 'other')),
  constraint settings_eb_template_checkpoints_group_key_check check (btrim(group_key) <> ''),
  constraint settings_eb_template_checkpoints_group_label_check check (btrim(group_label) <> ''),
  constraint settings_eb_template_checkpoints_title_check check (btrim(title) <> '')
);

create index if not exists settings_eb_template_checkpoints_template_idx
  on public.settings_eb_template_checkpoints (template_key, system_key, sort_order);

drop trigger if exists trg_settings_eb_template_checkpoints_set_updated_at
  on public.settings_eb_template_checkpoints;
create trigger trg_settings_eb_template_checkpoints_set_updated_at
before update on public.settings_eb_template_checkpoints
for each row
execute function public.eb_set_updated_at();

create table if not exists public.eb_inspection_checkpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  eb_project_id uuid not null references public.eb_projects (id) on delete cascade,
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  template_checkpoint_id uuid references public.settings_eb_template_checkpoints (id) on delete set null,
  checkpoint_key text not null,
  template_key text not null,
  system_key text not null default 'generic',
  group_key text not null,
  group_label text not null,
  title text not null,
  guidance text,
  verification_method text,
  source_url text,
  photo_required boolean not null default false,
  status text not null default 'not_checked',
  comment text,
  note_id uuid references public.eb_notes (id) on delete set null,
  sort_order integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eb_inspection_checkpoints_key_check check (btrim(checkpoint_key) <> ''),
  constraint eb_inspection_checkpoints_template_key_check check (btrim(template_key) <> ''),
  constraint eb_inspection_checkpoints_system_check
    check (system_key in ('generic', 'isodran', 'pordran', 'other')),
  constraint eb_inspection_checkpoints_status_check
    check (status in ('not_checked', 'ok', 'deviation', 'not_applicable', 'not_accessible', 'not_verifiable')),
  constraint eb_inspection_checkpoints_title_check check (btrim(title) <> '')
);

create unique index if not exists eb_inspection_checkpoints_inspection_key_idx
  on public.eb_inspection_checkpoints (inspection_id, checkpoint_key);
create index if not exists eb_inspection_checkpoints_project_idx
  on public.eb_inspection_checkpoints (eb_project_id, sort_order);
create index if not exists eb_inspection_checkpoints_org_idx
  on public.eb_inspection_checkpoints (org_id, updated_at desc);
create index if not exists eb_inspection_checkpoints_note_idx
  on public.eb_inspection_checkpoints (note_id)
  where note_id is not null;

drop trigger if exists trg_eb_inspection_checkpoints_set_updated_at
  on public.eb_inspection_checkpoints;
create trigger trg_eb_inspection_checkpoints_set_updated_at
before update on public.eb_inspection_checkpoints
for each row
execute function public.eb_set_updated_at();

grant select on table
  public.settings_eb_project_templates,
  public.settings_eb_template_checkpoints
to authenticated;

alter table public.eb_inspection_checkpoints enable row level security;

grant select, insert, update, delete on table
  public.eb_inspection_checkpoints
to authenticated;

drop policy if exists eb_inspection_checkpoints_member_all on public.eb_inspection_checkpoints;
create policy eb_inspection_checkpoints_member_all
  on public.eb_inspection_checkpoints
  for all
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

insert into public.settings_eb_project_templates (key, label, description, sort_order, is_active)
values
  (
    'drainage_foundation',
    'Dränering och fuktskydd grund/källarvägg',
    'EB-mall för besiktning av utvändig dränering och fuktskydd vid grundmur/källarvägg.',
    100,
    true
  )
on conflict (key) do update
set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

with seed_rows (
  key,
  system_key,
  group_key,
  group_label,
  title,
  guidance,
  verification_method,
  source_url,
  photo_required,
  sort_order
) as (
  values
    ('drainage_docs_contract', 'generic', 'documents', 'Handlingar och underlag', 'Offert, avtal och omfattning är redovisade', 'Kontrollera att omfattning, system, väggsträckor, undantag och ansvar för återfyllning/efterfyllning framgår.', 'Granska handlingar och notera avvikelser eller saknade underlag.', null, false, 100),
    ('drainage_docs_drawings', 'generic', 'documents', 'Handlingar och underlag', 'Dränerings- och dagvattenritning finns eller ska upprättas', 'Ritningen ska visa dränledning, dagvatten, brunnar, anslutningar och avledning.', 'Granska handling/relationsunderlag och jämför med synliga brunnar och foton.', null, false, 110),
    ('drainage_docs_photo_documentation', 'generic', 'documents', 'Handlingar och underlag', 'Fotodokumentation finns för dolda moment', 'Efter återfyllning kan flera moment endast verifieras med foton eller egenkontroll.', 'Kontrollera att foton är daterade eller tydligt kopplade till kontrollpunkt/arbetsmoment.', null, true, 120),
    ('drainage_interior_baseline', 'generic', 'baseline', 'Invändig status före/vid besiktning', 'Invändiga fuktgenomslag, sprickor och skador är noterade', 'Dokumentera befintliga invändiga indikationer så de kan skiljas från entreprenadfel eller tidigare skador.', 'Okulär kontroll invändigt och fotodokumentation där åtkomst finns.', 'https://www.isodran.se/arbetsinstruktioner/kallarvagg', true, 200),
    ('drainage_moisture_load', 'generic', 'risk', 'Fuktbelastning och riskbild', 'Fuktbelastning, marklutning och motlutande terräng är bedömd', 'Bedöm om fuktbelastningen påverkar krav på systemuppbyggnad, säkerhetsduk och dagvattenavledning.', 'Okulär kontroll av terräng, marknivåer, stuprör och källarens användning.', null, false, 300),
    ('drainage_excavation_geometry', 'generic', 'excavation', 'Schakt och grundmur', 'Schakt är utförd till rätt nivå och med hänsyn till grundläggningen', 'Kontrollera att schaktning inte underminerar grundläggning och att dränering kan placeras på avsedd nivå.', 'Okulär kontroll och mätning där schakten är öppen. Efter återfyllning krävs foton/egenkontroll.', null, true, 400),
    ('drainage_wall_cleaned', 'generic', 'wall', 'Schakt och grundmur', 'Grundmur är rengjord och täta skikt är borttagna i erforderlig omfattning', 'Täta skikt ska inte hindra avsedd uttorkning från grundmuren.', 'Okulär kontroll före skivmontage. Efter återfyllning verifieras via foto/egenkontroll.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 500),
    ('drainage_wall_repairs', 'generic', 'wall', 'Schakt och grundmur', 'Sprickor, fogar och skador i grundmur är lagade/tätade', 'Skador ska vara åtgärdade innan skivor och dukar byggs in.', 'Okulär kontroll före montage och granskning av foton.', null, true, 510),
    ('drainage_footing_slope', 'generic', 'footing', 'Grundsula och anslutningar', 'Utstickande grundsula har frånlut/hålkäl eller annan föreskriven avjämning', 'Vatten ska ledas ut från väggen och inte bli stående mot grundmuren/sulan.', 'Okulär kontroll och mätning före montage/återfyllning. Efter återfyllning krävs foto.', null, true, 600),
    ('drainage_pipe_level_fall', 'generic', 'drainage', 'Dräneringsledning och brunnar', 'Dräneringsledning/dränkloss är placerad på rätt nivå med fall', 'Kontrollera nivå mot grundsula/konstruktion, fall, anslutning och avledning.', 'Mätning/avvägning i öppen schakt, kontroll av foton och relationsritning.', null, true, 700),
    ('drainage_inspection_wells', 'generic', 'drainage', 'Dräneringsledning och brunnar', 'Inspektions- och dräneringsbrunnar ger kontrollmöjlighet', 'Dräneringen ska kunna kontrolleras i tillräcklig omfattning.', 'Okulär kontroll av brunnar, lägen och dokumenterad ledningsdragning.', null, true, 710),
    ('drainage_stormwater_handling', 'generic', 'stormwater', 'Dagvatten och markyta', 'Takavvattning och dagvattenhantering är säkerställd', 'Stuprör och dagvatten ska avledas fackmässigt så att vatten inte belastar grundmuren.', 'Okulär kontroll, granskning av ritning och vid behov spolning/funktionskontroll.', 'https://www.isodran.se/arbetsinstruktioner/kallarvagg', false, 800),
    ('drainage_backfill_surface', 'generic', 'backfill', 'Återfyllning och markplanering', 'Återfyllning och färdig marklutning är utförd enligt systemanvisning', 'Kontrollera massor närmast skivor/duk, större stenar, täta ytliga massor och lutning från huset.', 'Okulär kontroll efter återfyllning och granskning av foton från återfyllnad.', null, true, 900),
    ('drainage_handover', 'generic', 'handover', 'Överlämning', 'Egenkontroll, fotodokumentation och relationshandlingar är överlämnade', 'Kontrollera att beställaren får underlag för dolda moment och framtida felsökning.', 'Granska överlämnade handlingar och notera saknade delar.', null, false, 1000),

    ('isodran_filter_fabric_slope', 'isodran', 'fabric', 'Isodrän: dukar och skivor', 'Isodrän filterduk är placerad hela vägen till schaktbotten', 'Filterduken ska ligga mellan schaktvägg och makadam/lös Leca enligt Isodräns checklista.', 'Okulär kontroll i öppen schakt eller fotodokumentation.', 'https://www.isodran.se/uploads/a285ceff5b3c909366d5d3f671faec08.pdf', true, 1110),
    ('isodran_board_strength', 'isodran', 'boards', 'Isodrän: dukar och skivor', 'Rätt hårdhet på Isodrän-skiva är vald utifrån schaktdjup/jordtryck', 'Kontrollera kvalitet mot dimensionering och jord-/schaktförutsättningar.', 'Granska produktmärkning, följesedel eller foto och jämför med dimensioneringstabell.', 'https://www.isodran.se/uploads/8290664d962f4c504bc3ca4c11ee3e54.pdf', true, 1120),
    ('isodran_boards_footing', 'isodran', 'boards', 'Isodrän: dukar och skivor', 'Isodrän-skivor runt grundsula är monterade enligt anvisning', 'Utförande vid grundsula ska följa valt Isodrän-detaljutförande.', 'Okulär kontroll före återfyllning eller fotodokumentation.', 'https://www.isodran.se/arbetsinstruktioner/kallarvagg', true, 1130),
    ('isodran_pipe_material', 'isodran', 'drainage', 'Isodrän: dränmaterial', 'Tillräckligt med makadam eller lös Leca finns runt dräneringsrör', 'Materialet ska ge avsedd dränerande funktion kring röret.', 'Okulär kontroll i öppen schakt eller fotodokumentation.', 'https://www.isodran.se/uploads/a285ceff5b3c909366d5d3f671faec08.pdf', true, 1140),
    ('isodran_safety_fabric', 'isodran', 'fabric', 'Isodrän: dukar och skivor', 'Isodrän säkerhetsduk används vid motlutande terräng eller djupa schakter', 'Säkerhetsduk ska kontrolleras när terrängen lutar mot byggnaden eller schakten är djup.', 'Okulär kontroll/fotodokumentation och kontroll mot riskbedömning.', 'https://www.isodran.se/arbetsinstruktioner/kallarvagg', true, 1150),
    ('isodran_cap_fabric_cover_strip', 'isodran', 'cover_strip', 'Isodrän: täcklist', 'Filterdukskappa/filterduk är korrekt monterad vid täcklist', 'Kontrollera överlapp, avslut och att duken hindrar igensättning av skivans ovankant.', 'Okulär kontroll före återfyllning eller fotodokumentation.', 'https://www.isodran.se/uploads/a285ceff5b3c909366d5d3f671faec08.pdf', true, 1160),
    ('isodran_cover_strip_fastening', 'isodran', 'cover_strip', 'Isodrän: täcklist', 'Täcklist är fäst med slagnit c/c högst 150 mm', 'Infästning ska kontrolleras mot anvisning och ojämnheter i vägg.', 'Mät stickprov av infästningsavstånd och kontrollera foton.', 'https://www.isodran.se/uploads/a285ceff5b3c909366d5d3f671faec08.pdf', true, 1170),
    ('isodran_cover_strip_seal', 'isodran', 'cover_strip', 'Isodrän: täcklist', 'Tätning mellan täcklist och vägg är utförd med Isodrän tätmassa/tätningslist', 'Tätningen ska hindra vatten från att rinna bakom skivorna.', 'Okulär kontroll och foto före färdig marknivå.', 'https://www.isodran.se/uploads/a285ceff5b3c909366d5d3f671faec08.pdf', true, 1180),
    ('isodran_isocert_self_check', 'isodran', 'handover', 'Isodrän: överlämning', 'ISOCERT-checklista eller egenkontroll med fotodokumentation är överlämnad', 'Krav/underlag för att kunna verifiera dolda moment och entreprenörens egenkontroll.', 'Granska överlämnad checklista och fotobilagor.', 'https://www.isodran.se/uploads/bebb580bffcec0e6711ca53bbf1af40c.pdf', false, 1190),

    ('pordran_wall_tight_joints', 'pordran', 'wall', 'Pordrän: grundmur', 'Skarvar, fogar och sprickor i grundmur är tätade', 'Pordrän anger att vertikala och horisontella skarvar samt sprickor ska tätas.', 'Okulär kontroll före montage eller fotodokumentation.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2110),
    ('pordran_wall_render_leca', 'pordran', 'wall', 'Pordrän: grundmur', 'Lättklinker, hålsten eller lättbetong är slammad före montage', 'Väggmaterial med öppna fogar/porer ska slammas innan Pordränskivor monteras.', 'Okulär kontroll/fotodokumentation av vägg före skivmontage.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2120),
    ('pordran_board_strength', 'pordran', 'boards', 'Pordrän: skivor', 'Rätt typ/hårdhet Pordränskiva är vald', 'Kontrollera val mot schaktdjup, återfyllnadsmaterial och eventuell hårdgjord yta/packning.', 'Granska produktmärkning, följesedel eller foto mot dimensionering.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2130),
    ('pordran_boards_mounted', 'pordran', 'boards', 'Pordrän: skivor', 'Pordränskivor är monterade utan glipor och täcker grundmuren', 'Skivorna ska ligga an mot väggen och täcka avsedd yta upp till föreskriven nivå.', 'Okulär kontroll före återfyllning eller fotodokumentation.', 'https://www.pordran.se/wp-content/uploads/2023/11/Pordran_arbetsinstruktion_web.pdf', true, 2140),
    ('pordran_footing_membrane', 'pordran', 'footing', 'Pordrän: grundsula', 'Utstickande grundsula har fall och flytmembran eller plastfolie enligt valt utförande', 'Valet påverkas av uttorkningsbehov och grundläggningsförutsättningar.', 'Okulär kontroll och foto av fall, membran/plastfolie och skivmontage.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2150),
    ('pordran_drain_solution', 'pordran', 'drainage', 'Pordrän: dränering', 'Pordränkloss eller BDR-dränrör med makadam/singel är korrekt valt och utfört', 'Pordränkloss ersätter dräneringsrör och makadam i vissa utföranden; BDR-rör ska vara minst 110 mm.', 'Okulär kontroll/mätning i öppen schakt och granskning av foton/ritning.', 'https://www.pordran.se/wp-content/uploads/2023/11/Pordran_arbetsinstruktion_web.pdf', true, 2160),
    ('pordran_fabric_overlap', 'pordran', 'fabric', 'Pordrän: fiberduk och säkerhetsduk', 'Fiberduk är placerad ner till schaktbotten med cirka 250 mm överlapp', 'Fiberduken ska täcka mellan schaktslänt och dränkloss/makadam.', 'Okulär kontroll i öppen schakt eller fotodokumentation.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2170),
    ('pordran_safety_fabric', 'pordran', 'fabric', 'Pordrän: fiberduk och säkerhetsduk', 'Säkerhetsduk används vid motlutande terräng eller schakter djupare än 3 meter', 'Säkerhetsduken används vertikalt och ska inte vikas ut över dränkloss/dräneringsskikt.', 'Okulär kontroll/fotodokumentation och kontroll mot riskbild.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2180),
    ('pordran_cover_strip', 'pordran', 'cover_strip', 'Pordrän: täcklist', 'Täcklist är monterad, tätad och fäst enligt Pordräns anvisning', 'Kontrollera tätmassa, nivå under mark, skarvar och slagnit c/c högst 150 mm.', 'Okulär kontroll och stickprovsmätning före färdig marknivå.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2190),
    ('pordran_backfill', 'pordran', 'backfill', 'Pordrän: återfyllning', 'Återfyllning är utförd med rätt massor och utan större stenar mot skivor/duk', 'Stenar större än 100 mm ska inte ligga mot Pordränskiva eller fiberduk, och färdig mark ska luta från byggnaden.', 'Okulär kontroll efter återfyllning och granskning av foton från återfyllnad.', 'https://www.pordran.se/anvisningar-och-fakta/kallare/', true, 2200),
    ('pordran_checklist_photos', 'pordran', 'handover', 'Pordrän: överlämning', 'Pordrän-checklista och foton per godkänd kontrollpunkt är redovisade', 'Pordräns manuella checklista anger att fotodokumentation ska bifogas för kontrollpunkter som besvaras med ja.', 'Granska checklista och bildbilagor med kontrollpunktsnummer.', 'https://www.pordran.se/wp-content/uploads/2024/11/CHECKLISTA-MANUELL.pdf', false, 2210)
)
insert into public.settings_eb_template_checkpoints (
  template_key,
  key,
  system_key,
  group_key,
  group_label,
  title,
  guidance,
  verification_method,
  source_url,
  photo_required,
  sort_order,
  is_active
)
select
  'drainage_foundation',
  seed_rows.key,
  seed_rows.system_key,
  seed_rows.group_key,
  seed_rows.group_label,
  seed_rows.title,
  seed_rows.guidance,
  seed_rows.verification_method,
  seed_rows.source_url,
  seed_rows.photo_required,
  seed_rows.sort_order,
  true
from seed_rows
on conflict (key) do update
set
  template_key = excluded.template_key,
  system_key = excluded.system_key,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  title = excluded.title,
  guidance = excluded.guidance,
  verification_method = excluded.verification_method,
  source_url = excluded.source_url,
  photo_required = excluded.photo_required,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

alter table public.document_types
  add column if not exists applicable_modules text not null default 'ob';

with seed_rows (
  code,
  label,
  result_label,
  sort_order
) as (
  values
    ('EB_DOC_DRAINAGE_CONTRACT', 'Offert/avtal för dräneringsentreprenad', 'Datum', 300),
    ('EB_DOC_DRAINAGE_DRAWING', 'Dräneringsritning', 'Överlämnas', 310),
    ('EB_DOC_DRAINAGE_STORMWATER_DRAWING', 'Dagvattenritning', 'Överlämnas', 320),
    ('EB_DOC_DRAINAGE_PHOTO_DOCUMENTATION', 'Fotodokumentation av dolda moment', 'Överlämnas', 330),
    ('EB_DOC_DRAINAGE_SELF_CHECK', 'Egenkontroll/checklista för dräneringsarbeten', 'Överlämnas', 340),
    ('EB_DOC_DRAINAGE_RELATION_DRAWING', 'Relationshandling drän- och dagvatten', 'Överlämnas', 350),
    ('EB_DOC_DRAINAGE_ISOCERT', 'ISOCERT-underlag/checklista', 'Överlämnas', 360)
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
  'EB dränering och fuktskydd',
  'building',
  'eb',
  'all',
  'Underlag för EB-mall dränering och fuktskydd grund/källarvägg.',
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
  result_label
) as (
  values
    ('EB_DOC_DRAINAGE_CONTRACT', 'Offert/avtal för dräneringsentreprenad', 'Datum'),
    ('EB_DOC_DRAINAGE_DRAWING', 'Dräneringsritning', 'Överlämnas'),
    ('EB_DOC_DRAINAGE_STORMWATER_DRAWING', 'Dagvattenritning', 'Överlämnas'),
    ('EB_DOC_DRAINAGE_PHOTO_DOCUMENTATION', 'Fotodokumentation av dolda moment', 'Överlämnas'),
    ('EB_DOC_DRAINAGE_SELF_CHECK', 'Egenkontroll/checklista för dräneringsarbeten', 'Överlämnas'),
    ('EB_DOC_DRAINAGE_RELATION_DRAWING', 'Relationshandling drän- och dagvatten', 'Överlämnas'),
    ('EB_DOC_DRAINAGE_ISOCERT', 'ISOCERT-underlag/checklista', 'Överlämnas')
)
update public.document_types document_type
set
  label = seed_rows.label,
  category = 'EB dränering och fuktskydd',
  scope = 'building',
  applicable_modules = 'eb',
  applies_to = 'all',
  description = 'Underlag för EB-mall dränering och fuktskydd grund/källarvägg.',
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

do $$
declare
  v_table text := 'eb_inspection_checkpoints';
begin
  if to_regprocedure('public.guard_locked_inspection_child_write()') is null then
    raise notice 'guard_locked_inspection_child_write() is missing; apply inspection lock migration first.';
    return;
  end if;

  execute format(
    'drop trigger if exists trg_guard_locked_inspection_write on public.%I',
    v_table
  );
  execute format(
    'create trigger trg_guard_locked_inspection_write
      before insert or update or delete on public.%I
      for each row
      execute function public.guard_locked_inspection_child_write()',
    v_table
  );
end
$$;
