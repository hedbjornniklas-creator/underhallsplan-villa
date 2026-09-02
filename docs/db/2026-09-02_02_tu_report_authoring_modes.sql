-- TU report authoring modes
-- Date: 2026-09-02
-- Scope:
-- 1) Configure standard or AI-assisted authoring per TU report template
-- 2) Copy the selected mode to each investigation so later template edits do not change it
-- 3) Preserve the AI workflow for existing moisture investigations and use standard mode elsewhere

begin;

do $$
declare
  v_backfill_complete boolean := false;
  v_expected_comment constant text :=
    'TU authoring workflow selected for new reports: standard or ai_assisted.';
begin
  alter table public.settings_tu_report_templates
    add column if not exists authoring_mode text not null default 'standard';

  select coalesce(
    col_description('public.settings_tu_report_templates'::regclass, attribute.attnum)
      = v_expected_comment,
    false
  )
  into v_backfill_complete
  from pg_attribute attribute
  where attribute.attrelid = 'public.settings_tu_report_templates'::regclass
    and attribute.attname = 'authoring_mode'
    and not attribute.attisdropped;

  if not v_backfill_complete then
    update public.settings_tu_report_templates
    set
      authoring_mode = 'ai_assisted',
      updated_at = now()
    where key = 'moisture_damage_investigation';
  end if;
end
$$;

alter table public.settings_tu_report_templates
  drop constraint if exists settings_tu_report_templates_authoring_mode_check;

alter table public.settings_tu_report_templates
  add constraint settings_tu_report_templates_authoring_mode_check
    check (authoring_mode in ('standard', 'ai_assisted'));

do $$
declare
  v_backfill_complete boolean := false;
  v_guard_was_enabled boolean := false;
  v_expected_comment constant text :=
    'Immutable TU authoring workflow copied from the selected template at investigation creation.';
begin
  alter table public.technical_investigation_details
    add column if not exists report_authoring_mode text not null default 'standard';

  select coalesce(
    col_description('public.technical_investigation_details'::regclass, attribute.attnum)
      = v_expected_comment,
    false
  )
  into v_backfill_complete
  from pg_attribute attribute
  where attribute.attrelid = 'public.technical_investigation_details'::regclass
    and attribute.attname = 'report_authoring_mode'
    and not attribute.attisdropped;

  if not v_backfill_complete then
    select exists (
      select 1
      from pg_trigger
      where tgrelid = 'public.technical_investigation_details'::regclass
        and tgname = 'trg_guard_locked_inspection_write'
        and not tgisinternal
        and tgenabled <> 'D'
    )
    into v_guard_was_enabled;

    if v_guard_was_enabled then
      alter table public.technical_investigation_details
        disable trigger trg_guard_locked_inspection_write;
    end if;

    begin
      update public.technical_investigation_details
      set report_authoring_mode = case
        when report_template_key = 'moisture_damage_investigation' then 'ai_assisted'
        else 'standard'
      end;
    exception when others then
      if v_guard_was_enabled then
        alter table public.technical_investigation_details
          enable trigger trg_guard_locked_inspection_write;
      end if;
      raise;
    end;

    if v_guard_was_enabled then
      alter table public.technical_investigation_details
        enable trigger trg_guard_locked_inspection_write;
    end if;
  end if;
end
$$;

alter table public.technical_investigation_details
  drop constraint if exists technical_investigation_details_report_authoring_mode_check;

alter table public.technical_investigation_details
  add constraint technical_investigation_details_report_authoring_mode_check
    check (report_authoring_mode in ('standard', 'ai_assisted'));

comment on column public.settings_tu_report_templates.authoring_mode is
  'TU authoring workflow selected for new reports: standard or ai_assisted.';

comment on column public.technical_investigation_details.report_authoring_mode is
  'Immutable TU authoring workflow copied from the selected template at investigation creation.';

commit;
