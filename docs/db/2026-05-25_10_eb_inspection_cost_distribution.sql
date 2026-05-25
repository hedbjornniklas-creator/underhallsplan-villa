-- EB inspection cost distribution
-- Date: 2026-05-25
-- Scope:
-- 1) Store how the inspection cost should be distributed between parties
-- 2) Render the value in the EB statement when filled in

alter table public.eb_inspection_details
  add column if not exists inspection_cost_distribution text;

comment on column public.eb_inspection_details.inspection_cost_distribution is
  'Free-text description of how the inspection cost is distributed between the parties.';
