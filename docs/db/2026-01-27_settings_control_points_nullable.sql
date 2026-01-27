-- Make question and sort_order optional in settings_control_points
ALTER TABLE public.settings_control_points
  ALTER COLUMN question DROP NOT NULL,
  ALTER COLUMN sort_order DROP NOT NULL;
