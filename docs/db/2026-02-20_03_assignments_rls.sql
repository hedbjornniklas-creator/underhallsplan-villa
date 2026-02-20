-- Assignments RLS policies
-- Date: 2026-02-20
-- Prerequisites:
--  - 2026-02-20_01_assignments_org_foundation.sql
--  - 2026-02-20_02_assignments_core.sql

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_links enable row level security;
alter table public.assignment_acceptances enable row level security;
alter table public.outbound_messages enable row level security;

grant select, insert, update, delete on table public.organizations to authenticated;
grant select, insert, update, delete on table public.org_members to authenticated;
grant select, insert, update, delete on table public.assignments to authenticated;
grant select, insert, update, delete on table public.assignment_links to authenticated;
grant select, insert, update, delete on table public.assignment_acceptances to authenticated;
grant select, insert, update, delete on table public.outbound_messages to authenticated;

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using (public.is_org_member(id));

drop policy if exists organizations_insert_self on public.organizations;
create policy organizations_insert_self
  on public.organizations
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and created_by::text = auth.uid()::text
  );

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin
  on public.organizations
  for update
  to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

drop policy if exists organizations_delete_admin on public.organizations;
create policy organizations_delete_admin
  on public.organizations
  for delete
  to authenticated
  using (public.is_org_admin(id));

-- ---------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------
drop policy if exists org_members_select_member on public.org_members;
create policy org_members_select_member
  on public.org_members
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists org_members_insert_admin on public.org_members;
create policy org_members_insert_admin
  on public.org_members
  for insert
  to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists org_members_update_admin on public.org_members;
create policy org_members_update_admin
  on public.org_members
  for update
  to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists org_members_delete_admin on public.org_members;
create policy org_members_delete_admin
  on public.org_members
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------
drop policy if exists assignments_select_member on public.assignments;
create policy assignments_select_member
  on public.assignments
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists assignments_insert_member on public.assignments;
create policy assignments_insert_member
  on public.assignments
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists assignments_update_member on public.assignments;
create policy assignments_update_member
  on public.assignments
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists assignments_delete_admin on public.assignments;
create policy assignments_delete_admin
  on public.assignments
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- assignment_links
-- ---------------------------------------------------------------------
drop policy if exists assignment_links_select_member on public.assignment_links;
create policy assignment_links_select_member
  on public.assignment_links
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists assignment_links_insert_member on public.assignment_links;
create policy assignment_links_insert_member
  on public.assignment_links
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists assignment_links_update_member on public.assignment_links;
create policy assignment_links_update_member
  on public.assignment_links
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists assignment_links_delete_admin on public.assignment_links;
create policy assignment_links_delete_admin
  on public.assignment_links
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- assignment_acceptances
-- ---------------------------------------------------------------------
drop policy if exists assignment_acceptances_select_member on public.assignment_acceptances;
create policy assignment_acceptances_select_member
  on public.assignment_acceptances
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists assignment_acceptances_insert_member on public.assignment_acceptances;
create policy assignment_acceptances_insert_member
  on public.assignment_acceptances
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists assignment_acceptances_update_member on public.assignment_acceptances;
create policy assignment_acceptances_update_member
  on public.assignment_acceptances
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists assignment_acceptances_delete_admin on public.assignment_acceptances;
create policy assignment_acceptances_delete_admin
  on public.assignment_acceptances
  for delete
  to authenticated
  using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- outbound_messages
-- ---------------------------------------------------------------------
drop policy if exists outbound_messages_select_member on public.outbound_messages;
create policy outbound_messages_select_member
  on public.outbound_messages
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists outbound_messages_insert_member on public.outbound_messages;
create policy outbound_messages_insert_member
  on public.outbound_messages
  for insert
  to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists outbound_messages_update_member on public.outbound_messages;
create policy outbound_messages_update_member
  on public.outbound_messages
  for update
  to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists outbound_messages_delete_admin on public.outbound_messages;
create policy outbound_messages_delete_admin
  on public.outbound_messages
  for delete
  to authenticated
  using (public.is_org_admin(org_id));
