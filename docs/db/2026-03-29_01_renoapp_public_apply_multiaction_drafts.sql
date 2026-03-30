-- RenoApp public apply multi-action and draft support
-- Date: 2026-03-29
-- Additive only / rollback-safe:
--  - Adds descriptions for public renovation types
--  - Adds case-to-action-type join table so one case can cover several renovation types
-- Prerequisite:
--  - 2026-03-26_01_renoapp_mvp_foundation.sql
--  - 2026-03-26_02_renoapp_case_action_type.sql

alter table public.renovation_action_types
  add column if not exists description text;

create table if not exists public.renovation_case_action_types (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.renovation_cases (id) on delete cascade,
  action_type_id uuid not null references public.renovation_action_types (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint renovation_case_action_types_unique
    unique (case_id, action_type_id)
);

create index if not exists renovation_case_action_types_case_idx
  on public.renovation_case_action_types (case_id, created_at desc);

create index if not exists renovation_case_action_types_action_idx
  on public.renovation_case_action_types (action_type_id, created_at desc);

insert into public.renovation_case_action_types (case_id, action_type_id)
select c.id, c.action_type_id
from public.renovation_cases c
where c.action_type_id is not null
  and not exists (
    select 1
    from public.renovation_case_action_types cat
    where cat.case_id = c.id
      and cat.action_type_id = c.action_type_id
  );

update public.renovation_action_types
set description = data.description
from (
  values
    ('bathroom', 'Renovering av badrum, tvättutrymme eller andra våtrum.'),
    ('kitchen', 'Ändringar i kök, köksinredning eller installationer kopplade till kök.'),
    ('wall', 'Rivning, flytt eller uppbyggnad av väggar och planlösningsändringar.'),
    ('plumbing', 'Ändringar i vatten, avlopp eller annan VVS-installation.'),
    ('electrical', 'Ändringar i elinstallationer, fasta elpunkter eller eldragning.'),
    ('ventilation', 'Ändringar som påverkar ventilation eller frånluftssystem.'),
    ('surface', 'Ytskiktsrenovering som målning, golv eller andra ytskikt utan större ingrepp.'),
    ('other', 'Annan åtgärd som inte passar i de vanliga kategorierna.')
) as data(key, description)
where public.renovation_action_types.key = data.key
  and (public.renovation_action_types.description is null or btrim(public.renovation_action_types.description) = '');
