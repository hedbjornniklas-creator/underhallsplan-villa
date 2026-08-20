-- Protect normalized platform assignments from direct browser access.
--
-- Prerequisite:
--   2026-04-08_02_platform_access_foundation.sql
--
-- Application access to this table is server-side through service_role.
-- Keep this migration separate and short so the required table lock does not
-- participate in the longer Uppdrag schema transaction.

begin;

set local lock_timeout = '10s';

alter table public.platform_access_assignments
  enable row level security;

revoke all privileges
  on table public.platform_access_assignments
  from anon, authenticated;

commit;
