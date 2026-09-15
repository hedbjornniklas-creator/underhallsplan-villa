-- Minimal synthetic tables plus the reviewed calculation view. No customer rows.
create table public.properties (id uuid primary key, owner uuid not null);
create table public.component_types (
  id uuid primary key default gen_random_uuid(), name text not null,
  default_lifespan_years integer not null
);
create table public.components (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  component_type_id uuid not null references public.component_types(id),
  install_year integer, condition text, last_inspected date, comment text,
  created_at timestamptz default now(),
  constraint components_condition_check check (condition in ('Utmärkt','Bra','Okej','Svag','Dålig'))
);
create table public.actions (
  id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id),
  component_id uuid references public.components(id) on delete set null, title text
);
create view public.components_calc as
 SELECT c.id,
    c.property_id,
    c.component_type_id,
    ct.name AS component_type_name,
    c.install_year,
    c.condition,
    c.last_inspected,
    c.comment,
    ((EXTRACT(year FROM now()))::integer - COALESCE(c.install_year, (EXTRACT(year FROM now()))::integer)) AS age_years,
    ct.default_lifespan_years AS technical_lifespan_years,
        CASE c.condition
            WHEN 'Utmärkt'::text THEN 1.2
            WHEN 'Bra'::text THEN 1.0
            WHEN 'Okej'::text THEN 0.8
            WHEN 'Svag'::text THEN 0.6
            WHEN 'Dålig'::text THEN 0.4
            ELSE 1.0
        END AS condition_factor,
    (round(((ct.default_lifespan_years)::numeric *
        CASE c.condition
            WHEN 'Utmärkt'::text THEN 1.2
            WHEN 'Bra'::text THEN 1.0
            WHEN 'Okej'::text THEN 0.8
            WHEN 'Svag'::text THEN 0.6
            WHEN 'Dålig'::text THEN 0.4
            ELSE 1.0
        END)))::integer AS adjusted_lifespan_years,
    (round((((ct.default_lifespan_years)::numeric *
        CASE c.condition
            WHEN 'Utmärkt'::text THEN 1.2
            WHEN 'Bra'::text THEN 1.0
            WHEN 'Okej'::text THEN 0.8
            WHEN 'Svag'::text THEN 0.6
            WHEN 'Dålig'::text THEN 0.4
            ELSE 1.0
        END) - (((EXTRACT(year FROM now()))::integer - COALESCE(c.install_year, (EXTRACT(year FROM now()))::integer)))::numeric)))::integer AS remaining_years,
        CASE
            WHEN ((round((((ct.default_lifespan_years)::numeric *
            CASE c.condition
                WHEN 'Utmärkt'::text THEN 1.2
                WHEN 'Bra'::text THEN 1.0
                WHEN 'Okej'::text THEN 0.8
                WHEN 'Svag'::text THEN 0.6
                WHEN 'Dålig'::text THEN 0.4
                ELSE 1.0
            END) - (((EXTRACT(year FROM now()))::integer - COALESCE(c.install_year, (EXTRACT(year FROM now()))::integer)))::numeric)))::integer <= 0) THEN 'Röd'::text
            WHEN ((round((((ct.default_lifespan_years)::numeric *
            CASE c.condition
                WHEN 'Utmärkt'::text THEN 1.2
                WHEN 'Bra'::text THEN 1.0
                WHEN 'Okej'::text THEN 0.8
                WHEN 'Svag'::text THEN 0.6
                WHEN 'Dålig'::text THEN 0.4
                ELSE 1.0
            END) - (((EXTRACT(year FROM now()))::integer - COALESCE(c.install_year, (EXTRACT(year FROM now()))::integer)))::numeric)))::integer <= 3) THEN 'Gul'::text
            ELSE 'Grön'::text
        END AS status_color
   FROM (public.components c
     JOIN public.component_types ct ON ((ct.id = c.component_type_id)));
