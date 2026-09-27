-- Optional website for future reports. No historical report data is changed.
begin;
alter table public.profiles add column if not exists company_website text;
grant select(company_website), insert(company_website), update(company_website) on public.profiles to authenticated;
comment on column public.profiles.company_website is 'Optional company website, copied into new report snapshots.';
commit;
notify pgrst, 'reload schema';
