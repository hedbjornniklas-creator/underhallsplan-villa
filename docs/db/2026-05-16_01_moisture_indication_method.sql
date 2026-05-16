-- Moisture indication method for OB moisture appendix
-- Date: 2026-05-16
-- Scope:
-- 1) Allow moisture control rows to distinguish fuktindikering from RF/FK/other controls

alter table if exists public.inspection_moisture_control_rows
  drop constraint if exists inspection_moisture_control_rows_measurement_type_check;

alter table if exists public.inspection_moisture_control_rows
  add constraint inspection_moisture_control_rows_measurement_type_check
    check (measurement_type in ('rf', 'fk', 'indication', 'other'));
