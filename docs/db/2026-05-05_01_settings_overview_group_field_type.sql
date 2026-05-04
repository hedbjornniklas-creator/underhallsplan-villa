-- Add field type support for overview parameters.
-- Enables generated controls such as automatic year selectors without storing
-- hundreds of year rows in settings_overview_options.

alter table public.settings_overview_groups
  add column if not exists field_type text not null default 'select';

alter table public.settings_overview_groups
  drop constraint if exists settings_overview_groups_field_type_check;

alter table public.settings_overview_groups
  add constraint settings_overview_groups_field_type_check
  check (field_type in ('select', 'year'));

comment on column public.settings_overview_groups.field_type is
  'Control type for overview parameter UI. select uses settings_overview_options; year generates year options in the app.';

update public.settings_overview_groups
set field_type = 'year'
where
  key in ('install_year', 'renewal_year', 'drainage_year')
  or key like '%\_year' escape '\';
