-- Generated schema-only fixture from the pinned export. No customer rows.
-- UUID extension shim is supplied by the local test harness.
CREATE TYPE public.overview_selection_mode AS ENUM ('single','multi_set','per_floor');
CREATE TABLE public."document_types" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "category" text,
  "scope" text DEFAULT 'building'::text,
  "description" text,
  "is_default" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "applies_to" text,
  "result_label" text,
  "result_unit" text,
  "validity_years" integer,
  "recommended_interval_years" integer,
  "interval_note" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "applicable_modules" text DEFAULT 'ob'::text NOT NULL
);
CREATE TABLE public."settings_disclosure_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text,
  "label" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true,
  "order_index" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."settings_basinfo_fields" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code" text,
  "label" text NOT NULL,
  "input_type" text DEFAULT 'text'::text,
  "options" jsonb,
  "is_required" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  "order_index" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."settings_condition_options" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "group_code" text NOT NULL,
  "value_code" text NOT NULL,
  "label" text NOT NULL,
  "order_index" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "parent_group_code" text,
  "parent_value_code" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."settings_overview_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "selection_mode" public.overview_selection_mode DEFAULT 'single'::public.overview_selection_mode NOT NULL,
  "note_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applies_to" text[]
);
CREATE TABLE public."settings_overview_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "overview_item_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "conditional_on_group_key" text,
  "conditional_on_values" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "field_type" text DEFAULT 'select'::text NOT NULL
);
CREATE TABLE public."settings_overview_options" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "trigger_tags" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "system_value" text
);
CREATE TABLE public."settings_exterior_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);
CREATE TABLE public."settings_exterior_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "item_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "field_type" text DEFAULT 'select'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."settings_exterior_options" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "trigger_tags" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public."settings_interior_room_types" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 10 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_interior_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 10 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "field_type" text DEFAULT 'select'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_interior_options" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 10 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "trigger_tags" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_control_points" (
  "id" uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  "scope" text NOT NULL,
  "exterior_item_key" text,
  "room_type_key" text,
  "title" text NOT NULL,
  "question" text,
  "sort_order" integer,
  "trigger_foundation_types" jsonb,
  "trigger_year_from" integer,
  "trigger_year_to" integer,
  "trigger_room_types" jsonb,
  "trigger_component_keys" jsonb,
  "trigger_tags" jsonb,
  "default_risk_code" text,
  "default_ftu_code" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "key" text NOT NULL,
  "label" text,
  "description" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "risk_tags" jsonb DEFAULT '[]'::jsonb,
  "applies_to" text[]
);
CREATE TABLE public."settings_control_point_options" (
  "id" uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
  "control_point_id" uuid NOT NULL,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "creates_risk" boolean DEFAULT false NOT NULL,
  "risk_code" text,
  "ftu_code" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_text_snippets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "text" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "source" text,
  "version" text,
  "tags" jsonb,
  "notes_internal" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_control_point_outcomes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "control_point_id" uuid NOT NULL,
  "outcome_key" text NOT NULL,
  "label" text NOT NULL,
  "severity" smallint DEFAULT 0,
  "note_template" text,
  "risk_template" text,
  "ftu_template" text,
  "tags" jsonb,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_addon_services" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."settings_certifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "category" text DEFAULT 'certification'::text NOT NULL,
  "requires_number" boolean DEFAULT false NOT NULL,
  "requires_valid_to" boolean DEFAULT false NOT NULL,
  "number_label" text,
  "valid_to_label" text
);
ALTER TABLE public.document_types ADD CONSTRAINT "document_types_scope_check" CHECK ((scope = ANY (ARRAY['property'::text, 'building'::text])));
ALTER TABLE public.document_types ADD CONSTRAINT "document_types_pkey" PRIMARY KEY (id);
ALTER TABLE public.document_types ADD CONSTRAINT "document_types_code_key" UNIQUE (code);
ALTER TABLE public.settings_disclosure_items ADD CONSTRAINT "settings_disclosure_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_basinfo_fields ADD CONSTRAINT "settings_basinfo_fields_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_condition_options ADD CONSTRAINT "settings_condition_options_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_overview_items ADD CONSTRAINT "settings_overview_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_overview_items ADD CONSTRAINT "settings_overview_items_key_key" UNIQUE (key);
ALTER TABLE public.settings_overview_groups ADD CONSTRAINT "settings_overview_groups_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_overview_groups ADD CONSTRAINT "settings_overview_groups_overview_item_id_key_key" UNIQUE (overview_item_id, key);
ALTER TABLE public.settings_overview_options ADD CONSTRAINT "settings_overview_options_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_overview_options ADD CONSTRAINT "settings_overview_options_group_id_value_key" UNIQUE (group_id, value);
ALTER TABLE public.settings_exterior_items ADD CONSTRAINT "settings_exterior_items_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_exterior_items ADD CONSTRAINT "settings_exterior_items_key_key" UNIQUE (key);
ALTER TABLE public.settings_exterior_groups ADD CONSTRAINT "settings_exterior_groups_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_exterior_groups ADD CONSTRAINT "settings_exterior_groups_item_id_key_key" UNIQUE (item_id, key);
ALTER TABLE public.settings_exterior_options ADD CONSTRAINT "settings_exterior_options_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_exterior_options ADD CONSTRAINT "settings_exterior_options_group_id_value_key" UNIQUE (group_id, value);
ALTER TABLE public.settings_interior_room_types ADD CONSTRAINT "settings_interior_room_types_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_interior_room_types ADD CONSTRAINT "settings_interior_room_types_key_key" UNIQUE (key);
ALTER TABLE public.settings_interior_groups ADD CONSTRAINT "settings_interior_groups_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_interior_groups ADD CONSTRAINT "settings_interior_groups_key_key" UNIQUE (key);
ALTER TABLE public.settings_interior_options ADD CONSTRAINT "settings_interior_options_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_interior_options ADD CONSTRAINT "settings_interior_options_group_id_value_key" UNIQUE (group_id, value);
ALTER TABLE public.settings_control_points ADD CONSTRAINT "settings_control_points_scope_check" CHECK ((scope = ANY (ARRAY['exterior'::text, 'interior'::text])));
ALTER TABLE public.settings_control_points ADD CONSTRAINT "settings_control_points_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_control_point_options ADD CONSTRAINT "settings_control_point_options_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_control_points ADD CONSTRAINT "settings_control_points_key_unique" UNIQUE (key);
ALTER TABLE public.settings_text_snippets ADD CONSTRAINT "settings_text_snippets_type_check" CHECK ((type = ANY (ARRAY['risk'::text, 'ftu'::text])));
ALTER TABLE public.settings_text_snippets ADD CONSTRAINT "settings_text_snippets_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_text_snippets ADD CONSTRAINT "settings_text_snippets_type_code_unique" UNIQUE (type, code);
ALTER TABLE public.settings_control_point_outcomes ADD CONSTRAINT "settings_control_point_outcomes_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_control_point_outcomes ADD CONSTRAINT "settings_control_point_outcomes_unique" UNIQUE (control_point_id, outcome_key);
ALTER TABLE public.settings_addon_services ADD CONSTRAINT "settings_addon_services_key_check" CHECK (((btrim(key) <> ''::text) AND (key ~ '^[a-z0-9_]+$'::text)));
ALTER TABLE public.settings_addon_services ADD CONSTRAINT "settings_addon_services_name_check" CHECK ((btrim(name) <> ''::text));
ALTER TABLE public.settings_addon_services ADD CONSTRAINT "settings_addon_services_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_overview_items ADD CONSTRAINT "settings_overview_items_applies_to_check" CHECK (((applies_to IS NULL) OR (applies_to <@ ARRAY['buyer'::text, 'seller'::text, 'apartment'::text])));
ALTER TABLE public.settings_control_points ADD CONSTRAINT "settings_control_points_applies_to_check" CHECK (((applies_to IS NULL) OR (applies_to <@ ARRAY['buyer'::text, 'seller'::text, 'apartment'::text])));
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_key_check" CHECK (((btrim(key) <> ''::text) AND (key ~ '^[a-z0-9_]+$'::text)));
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_name_check" CHECK ((btrim(name) <> ''::text));
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_pkey" PRIMARY KEY (id);
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_category_check" CHECK ((category = ANY (ARRAY['certification'::text, 'membership'::text])));
ALTER TABLE public.settings_overview_groups ADD CONSTRAINT "settings_overview_groups_field_type_check" CHECK ((field_type = ANY (ARRAY['select'::text, 'year'::text])));
ALTER TABLE public.settings_overview_groups ADD CONSTRAINT "settings_overview_groups_overview_item_id_fkey" FOREIGN KEY (overview_item_id) REFERENCES public.settings_overview_items(id) ON DELETE CASCADE;
ALTER TABLE public.settings_overview_options ADD CONSTRAINT "settings_overview_options_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public.settings_overview_groups(id) ON DELETE CASCADE;
ALTER TABLE public.settings_exterior_groups ADD CONSTRAINT "settings_exterior_groups_item_id_fkey" FOREIGN KEY (item_id) REFERENCES public.settings_exterior_items(id) ON DELETE CASCADE;
ALTER TABLE public.settings_exterior_options ADD CONSTRAINT "settings_exterior_options_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public.settings_exterior_groups(id) ON DELETE CASCADE;
ALTER TABLE public.settings_interior_options ADD CONSTRAINT "settings_interior_options_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public.settings_interior_groups(id) ON DELETE CASCADE;
ALTER TABLE public.settings_control_point_options ADD CONSTRAINT "settings_control_point_options_control_point_id_fkey" FOREIGN KEY (control_point_id) REFERENCES public.settings_control_points(id) ON DELETE CASCADE;
ALTER TABLE public.settings_control_point_outcomes ADD CONSTRAINT "settings_control_point_outcomes_control_point_id_fkey" FOREIGN KEY (control_point_id) REFERENCES public.settings_control_points(id) ON DELETE CASCADE;
ALTER TABLE public.settings_addon_services ADD CONSTRAINT "settings_addon_services_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.settings_addon_services ADD CONSTRAINT "settings_addon_services_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.settings_certifications ADD CONSTRAINT "settings_certifications_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.addon_services_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.settings_certifications_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE TRIGGER trg_settings_addon_services_set_updated_at BEFORE UPDATE ON public.settings_addon_services FOR EACH ROW EXECUTE FUNCTION public.addon_services_set_updated_at();
CREATE TRIGGER trg_settings_basinfo_fields_updated_at BEFORE UPDATE ON public.settings_basinfo_fields FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settings_certifications_set_updated_at BEFORE UPDATE ON public.settings_certifications FOR EACH ROW EXECUTE FUNCTION public.settings_certifications_set_updated_at();
CREATE TRIGGER set_timestamp_settings_control_points BEFORE UPDATE ON public.settings_control_points FOR EACH ROW EXECUTE FUNCTION public.set_timestamp();
CREATE TRIGGER trg_settings_disclosure_items_updated_at BEFORE UPDATE ON public.settings_disclosure_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settings_text_snippets_updated_at BEFORE UPDATE ON public.settings_text_snippets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "document_types read authed" ON public."document_types" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "document_types write authed" ON public."document_types" AS PERMISSIVE FOR ALL TO "authenticated" USING (true) WITH CHECK (true);
CREATE POLICY "settings_overview_groups_admin_write" ON public."settings_overview_groups" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
CREATE POLICY "settings_overview_groups_select_auth" ON public."settings_overview_groups" AS PERMISSIVE FOR SELECT TO "public" USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "settings_overview_items_admin_write" ON public."settings_overview_items" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
CREATE POLICY "settings_overview_items_select_auth" ON public."settings_overview_items" AS PERMISSIVE FOR SELECT TO "public" USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "settings_overview_options_admin_write" ON public."settings_overview_options" AS PERMISSIVE FOR ALL TO "public" USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
CREATE POLICY "settings_overview_options_select_auth" ON public."settings_overview_options" AS PERMISSIVE FOR SELECT TO "public" USING ((auth.role() = 'authenticated'::text));
ALTER TABLE public."document_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."settings_overview_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."settings_overview_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."settings_overview_options" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public."document_types" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_disclosure_items" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_basinfo_fields" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_condition_options" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_overview_items" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_overview_groups" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_overview_options" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_exterior_items" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_exterior_groups" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_exterior_options" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_interior_room_types" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_interior_groups" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_interior_options" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_control_points" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_control_point_options" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_text_snippets" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_control_point_outcomes" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_addon_services" TO anon,authenticated,service_role;
GRANT ALL ON public."settings_certifications" TO anon,authenticated,service_role;
