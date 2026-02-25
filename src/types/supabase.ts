export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          component_id: string | null
          cost_sek: number | null
          id: string
          plan_year: number | null
          priority: string | null
          property_id: string
          room_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          component_id?: string | null
          cost_sek?: number | null
          id?: string
          plan_year?: number | null
          priority?: string | null
          property_id: string
          room_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          component_id?: string | null
          cost_sek?: number | null
          id?: string
          plan_year?: number | null
          priority?: string | null
          property_id?: string
          room_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components_calc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_fields: {
        Row: {
          created_at: string
          field_group: string | null
          field_type: string
          id: string
          is_active: boolean
          is_critical: boolean
          key: string
          label: string
          options: Json | null
          order_index: number
        }
        Insert: {
          created_at?: string
          field_group?: string | null
          field_type: string
          id?: string
          is_active?: boolean
          is_critical?: boolean
          key: string
          label: string
          options?: Json | null
          order_index?: number
        }
        Update: {
          created_at?: string
          field_group?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          is_critical?: boolean
          key?: string
          label?: string
          options?: Json | null
          order_index?: number
        }
        Relationships: []
      }
      building_basic_values: {
        Row: {
          building_id: string
          field_id: string
          id: string
          updated_at: string
          value_text: string | null
        }
        Insert: {
          building_id: string
          field_id: string
          id?: string
          updated_at?: string
          value_text?: string | null
        }
        Update: {
          building_id?: string
          field_id?: string
          id?: string
          updated_at?: string
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_basic_values_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_basic_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "basic_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      building_disclosures: {
        Row: {
          building_id: string
          content: string | null
          created_at: string
          id: string
          link_url: string | null
          title: string
        }
        Insert: {
          building_id: string
          content?: string | null
          created_at?: string
          id?: string
          link_url?: string | null
          title: string
        }
        Update: {
          building_id?: string
          content?: string | null
          created_at?: string
          id?: string
          link_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_disclosures_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      building_facts: {
        Row: {
          building_id: string
          created_at: string
          id: string
          key: string
          value: string | null
        }
        Insert: {
          building_id: string
          created_at?: string
          id?: string
          key: string
          value?: string | null
        }
        Update: {
          building_id?: string
          created_at?: string
          id?: string
          key?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_facts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      building_media: {
        Row: {
          building_id: string
          caption: string | null
          created_at: string
          id: string
          path: string
          sort_order: number | null
        }
        Insert: {
          building_id: string
          caption?: string | null
          created_at?: string
          id?: string
          path: string
          sort_order?: number | null
        }
        Update: {
          building_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          path?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "building_media_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          built_year: number | null
          cover_path: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          built_year?: number | null
          cover_path?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          built_year?: number | null
          cover_path?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buildings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      component_types: {
        Row: {
          category: string | null
          code: string | null
          default_lifespan_years: number
          id: string
          is_active: boolean | null
          maintenance_interval_years: number | null
          name: string
          notes: string | null
          scope: string | null
        }
        Insert: {
          category?: string | null
          code?: string | null
          default_lifespan_years: number
          id?: string
          is_active?: boolean | null
          maintenance_interval_years?: number | null
          name: string
          notes?: string | null
          scope?: string | null
        }
        Update: {
          category?: string | null
          code?: string | null
          default_lifespan_years?: number
          id?: string
          is_active?: boolean | null
          maintenance_interval_years?: number | null
          name?: string
          notes?: string | null
          scope?: string | null
        }
        Relationships: []
      }
      components: {
        Row: {
          comment: string | null
          component_type_id: string
          condition: string | null
          created_at: string | null
          id: string
          install_year: number | null
          last_inspected: string | null
          property_id: string
        }
        Insert: {
          comment?: string | null
          component_type_id: string
          condition?: string | null
          created_at?: string | null
          id?: string
          install_year?: number | null
          last_inspected?: string | null
          property_id: string
        }
        Update: {
          comment?: string | null
          component_type_id?: string
          condition?: string | null
          created_at?: string | null
          id?: string
          install_year?: number | null
          last_inspected?: string | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "components_component_type_id_fkey"
            columns: ["component_type_id"]
            isOneToOne: false
            referencedRelation: "component_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          applies_to: string | null
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          interval_note: string | null
          is_active: boolean
          is_default: boolean | null
          label: string
          recommended_interval_years: number | null
          result_label: string | null
          result_unit: string | null
          scope: string | null
          validity_years: number | null
        }
        Insert: {
          applies_to?: string | null
          category?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          interval_note?: string | null
          is_active?: boolean
          is_default?: boolean | null
          label: string
          recommended_interval_years?: number | null
          result_label?: string | null
          result_unit?: string | null
          scope?: string | null
          validity_years?: number | null
        }
        Update: {
          applies_to?: string | null
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          interval_note?: string | null
          is_active?: boolean
          is_default?: boolean | null
          label?: string
          recommended_interval_years?: number | null
          result_label?: string | null
          result_unit?: string | null
          scope?: string | null
          validity_years?: number | null
        }
        Relationships: []
      }
      inspection_conditions: {
        Row: {
          building_form: string | null
          building_subtype: string | null
          building_type: string | null
          building_year: number | null
          created_at: string | null
          facade: string | null
          foundation: string | null
          frame: string | null
          furnishing_level: string | null
          heating: string | null
          id: string
          inspection_id: string
          joists: string | null
          oral_info: string | null
          roof: string | null
          sewer: string | null
          special_conditions: string | null
          updated_at: string | null
          ventilation: string | null
          water: string | null
          weather: string | null
          weather_note: string | null
          windows: string | null
        }
        Insert: {
          building_form?: string | null
          building_subtype?: string | null
          building_type?: string | null
          building_year?: number | null
          created_at?: string | null
          facade?: string | null
          foundation?: string | null
          frame?: string | null
          furnishing_level?: string | null
          heating?: string | null
          id?: string
          inspection_id: string
          joists?: string | null
          oral_info?: string | null
          roof?: string | null
          sewer?: string | null
          special_conditions?: string | null
          updated_at?: string | null
          ventilation?: string | null
          water?: string | null
          weather?: string | null
          weather_note?: string | null
          windows?: string | null
        }
        Update: {
          building_form?: string | null
          building_subtype?: string | null
          building_type?: string | null
          building_year?: number | null
          created_at?: string | null
          facade?: string | null
          foundation?: string | null
          frame?: string | null
          furnishing_level?: string | null
          heating?: string | null
          id?: string
          inspection_id?: string
          joists?: string | null
          oral_info?: string | null
          roof?: string | null
          sewer?: string | null
          special_conditions?: string | null
          updated_at?: string | null
          ventilation?: string | null
          water?: string | null
          weather?: string | null
          weather_note?: string | null
          windows?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_conditions_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: true
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_control_answers: {
        Row: {
          answer_value: string | null
          control_point_id: string
          created_at: string
          exterior_observation_id: string | null
          id: string
          inspection_id: string
          interior_room_id: string | null
          note: string | null
          updated_at: string
        }
        Insert: {
          answer_value?: string | null
          control_point_id: string
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id: string
          interior_room_id?: string | null
          note?: string | null
          updated_at?: string
        }
        Update: {
          answer_value?: string | null
          control_point_id?: string
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id?: string
          interior_room_id?: string | null
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_control_answers_control_point_id_fkey"
            columns: ["control_point_id"]
            isOneToOne: false
            referencedRelation: "settings_control_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_answers_exterior_observation_id_fkey"
            columns: ["exterior_observation_id"]
            isOneToOne: false
            referencedRelation: "inspection_exterior_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_answers_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_control_items: {
        Row: {
          control_point_id: string | null
          created_at: string
          exterior_observation_id: string | null
          id: string
          inspection_id: string
          interior_room_id: string | null
          note: string | null
          selected_outcome_id: string | null
          sort_order: number
          status: string | null
          title: string
          updated_at: string
        }
        Insert: {
          control_point_id?: string | null
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id: string
          interior_room_id?: string | null
          note?: string | null
          selected_outcome_id?: string | null
          sort_order?: number
          status?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          control_point_id?: string | null
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id?: string
          interior_room_id?: string | null
          note?: string | null
          selected_outcome_id?: string | null
          sort_order?: number
          status?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_control_items_control_point_id_fkey"
            columns: ["control_point_id"]
            isOneToOne: false
            referencedRelation: "settings_control_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_items_exterior_observation_id_fkey"
            columns: ["exterior_observation_id"]
            isOneToOne: false
            referencedRelation: "inspection_exterior_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_items_interior_room_id_fkey"
            columns: ["interior_room_id"]
            isOneToOne: false
            referencedRelation: "inspection_interior_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_control_point_answers: {
        Row: {
          control_point_id: string
          created_at: string
          exterior_observation_id: string | null
          id: string
          inspection_id: string
          interior_room_id: string | null
          note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          control_point_id: string
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id: string
          interior_room_id?: string | null
          note?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          control_point_id?: string
          created_at?: string
          exterior_observation_id?: string | null
          id?: string
          inspection_id?: string
          interior_room_id?: string | null
          note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_control_point_answers_control_point_id_fkey"
            columns: ["control_point_id"]
            isOneToOne: false
            referencedRelation: "settings_control_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_point_answers_exterior_observation_id_fkey"
            columns: ["exterior_observation_id"]
            isOneToOne: false
            referencedRelation: "inspection_exterior_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_point_answers_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_control_point_answers_interior_room_id_fkey"
            columns: ["interior_room_id"]
            isOneToOne: false
            referencedRelation: "inspection_interior_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_disclosures: {
        Row: {
          answer: string
          created_at: string
          disclosure_item_id: string | null
          id: string
          inspection_id: string
          note: string | null
          source_image_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          answer?: string
          created_at?: string
          disclosure_item_id?: string | null
          id?: string
          inspection_id: string
          note?: string | null
          source_image_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          disclosure_item_id?: string | null
          id?: string
          inspection_id?: string
          note?: string | null
          source_image_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_disclosures_disclosure_item_id_fkey"
            columns: ["disclosure_item_id"]
            isOneToOne: false
            referencedRelation: "settings_disclosure_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_disclosures_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_documents: {
        Row: {
          created_at: string | null
          document_date: string | null
          document_type_id: string | null
          document_value: number | null
          file_url: string | null
          id: string
          inspection_id: string
          note: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          document_date?: string | null
          document_type_id?: string | null
          document_value?: number | null
          file_url?: string | null
          id?: string
          inspection_id: string
          note?: string | null
          status: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          document_date?: string | null
          document_type_id?: string | null
          document_value?: number | null
          file_url?: string | null
          id?: string
          inspection_id?: string
          note?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_documents_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_exterior_observations: {
        Row: {
          created_at: string | null
          exterior_item_id: string
          id: string
          inspection_id: string
          note: string | null
          part_label: string | null
          updated_at: string | null
          values: Json
        }
        Insert: {
          created_at?: string | null
          exterior_item_id: string
          id?: string
          inspection_id: string
          note?: string | null
          part_label?: string | null
          updated_at?: string | null
          values?: Json
        }
        Update: {
          created_at?: string | null
          exterior_item_id?: string
          id?: string
          inspection_id?: string
          note?: string | null
          part_label?: string | null
          updated_at?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inspection_exterior_observations_exterior_item_id_fkey"
            columns: ["exterior_item_id"]
            isOneToOne: false
            referencedRelation: "settings_exterior_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_exterior_observations_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_exterior_selections: {
        Row: {
          created_at: string
          exterior_item_id: string
          id: string
          inspection_id: string
          location_key: string | null
          note: string | null
          set_index: number
          updated_at: string | null
          values: Json
        }
        Insert: {
          created_at?: string
          exterior_item_id: string
          id?: string
          inspection_id: string
          location_key?: string | null
          note?: string | null
          set_index?: number
          updated_at?: string | null
          values?: Json
        }
        Update: {
          created_at?: string
          exterior_item_id?: string
          id?: string
          inspection_id?: string
          location_key?: string | null
          note?: string | null
          set_index?: number
          updated_at?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inspection_exterior_selections_exterior_item_id_fkey"
            columns: ["exterior_item_id"]
            isOneToOne: false
            referencedRelation: "settings_exterior_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_exterior_selections_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_images: {
        Row: {
          control_item_id: string | null
          created_at: string
          exterior_observation_id: string | null
          file_path: string
          id: string
          inspection_id: string
          interior_room_id: string | null
          label: string | null
          sort_order: number
        }
        Insert: {
          control_item_id?: string | null
          created_at?: string
          exterior_observation_id?: string | null
          file_path: string
          id?: string
          inspection_id: string
          interior_room_id?: string | null
          label?: string | null
          sort_order?: number
        }
        Update: {
          control_item_id?: string | null
          created_at?: string
          exterior_observation_id?: string | null
          file_path?: string
          id?: string
          inspection_id?: string
          interior_room_id?: string | null
          label?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_images_control_item_id_fkey"
            columns: ["control_item_id"]
            isOneToOne: false
            referencedRelation: "inspection_control_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_images_exterior_observation_id_fkey"
            columns: ["exterior_observation_id"]
            isOneToOne: false
            referencedRelation: "inspection_exterior_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_images_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_images_interior_room_id_fkey"
            columns: ["interior_room_id"]
            isOneToOne: false
            referencedRelation: "inspection_interior_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_interior_observations: {
        Row: {
          created_at: string
          field_key: string
          id: string
          inspection_id: string
          note: string | null
          room_id: string
          updated_at: string
          values: Json
        }
        Insert: {
          created_at?: string
          field_key: string
          id?: string
          inspection_id: string
          note?: string | null
          room_id: string
          updated_at?: string
          values?: Json
        }
        Update: {
          created_at?: string
          field_key?: string
          id?: string
          inspection_id?: string
          note?: string | null
          room_id?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inspection_interior_observations_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_interior_observations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "inspection_interior_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_interior_rooms: {
        Row: {
          created_at: string
          floor_label: string
          id: string
          inspection_id: string
          note: string | null
          order_index: number
          room_label: string
          room_type_key: string
          updated_at: string
          values: Json
        }
        Insert: {
          created_at?: string
          floor_label: string
          id?: string
          inspection_id: string
          note?: string | null
          order_index?: number
          room_label: string
          room_type_key: string
          updated_at?: string
          values?: Json
        }
        Update: {
          created_at?: string
          floor_label?: string
          id?: string
          inspection_id?: string
          note?: string | null
          order_index?: number
          room_label?: string
          room_type_key?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inspection_interior_rooms_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_overview_selections: {
        Row: {
          created_at: string
          floor_key: string | null
          id: string
          inspection_id: string
          note: string | null
          overview_item_id: string
          set_index: number
          updated_at: string
          values: Json
        }
        Insert: {
          created_at?: string
          floor_key?: string | null
          id?: string
          inspection_id: string
          note?: string | null
          overview_item_id: string
          set_index?: number
          updated_at?: string
          values?: Json
        }
        Update: {
          created_at?: string
          floor_key?: string | null
          id?: string
          inspection_id?: string
          note?: string | null
          overview_item_id?: string
          set_index?: number
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "inspection_overview_selections_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_overview_selections_overview_item_id_fkey"
            columns: ["overview_item_id"]
            isOneToOne: false
            referencedRelation: "settings_overview_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          assignment_number: string | null
            assignment_confirmation_delivered_date: string | null
          cover_path: string | null
          attendees: string | null
          attendees_other: string | null
          client_contact: string | null
          client_name: string | null
          created_at: string | null
          date: string | null
          defect_disclosures: string | null
          id: string
          inspection_side: string | null
          inspection_time: string | null
          inspector_name: string | null
          property_id: string
          scope: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          assignment_number?: string | null
            assignment_confirmation_delivered_date?: string | null
          cover_path?: string | null
          attendees?: string | null
          attendees_other?: string | null
          client_contact?: string | null
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          defect_disclosures?: string | null
          id?: string
          inspection_side?: string | null
          inspection_time?: string | null
          inspector_name?: string | null
          property_id: string
          scope?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          assignment_number?: string | null
            assignment_confirmation_delivered_date?: string | null
          cover_path?: string | null
          attendees?: string | null
          attendees_other?: string | null
          client_contact?: string | null
          client_name?: string | null
          created_at?: string | null
          date?: string | null
          defect_disclosures?: string | null
          id?: string
          inspection_side?: string | null
          inspection_time?: string | null
          inspector_name?: string | null
          property_id?: string
          scope?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_templates: {
        Row: {
          action_name: string
          action_type: string
          category: string | null
          component_type_id: string | null
          created_at: string | null
          id: string
          interval_note: string | null
          is_active: boolean | null
          notes: string | null
          recommended_interval_years: number | null
          typical_lifespan_effect_years: number | null
          updated_at: string | null
        }
        Insert: {
          action_name: string
          action_type: string
          category?: string | null
          component_type_id?: string | null
          created_at?: string | null
          id?: string
          interval_note?: string | null
          is_active?: boolean | null
          notes?: string | null
          recommended_interval_years?: number | null
          typical_lifespan_effect_years?: number | null
          updated_at?: string | null
        }
        Update: {
          action_name?: string
          action_type?: string
          category?: string | null
          component_type_id?: string | null
          created_at?: string | null
          id?: string
          interval_note?: string | null
          is_active?: boolean | null
          notes?: string | null
          recommended_interval_years?: number | null
          typical_lifespan_effect_years?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_templates_component_type_id_fkey"
            columns: ["component_type_id"]
            isOneToOne: false
            referencedRelation: "component_types"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          certification_number: string | null
          company_address: string | null
          company_city: string | null
          company_name: string | null
          company_orgno: string | null
          company_postal_code: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_admin: boolean
          logo_path: string | null
          logo_url: string | null
          membership_number: string | null
          org_name: string | null
          phone: string | null
          sbr_group: string | null
          sbr_status: string | null
        }
        Insert: {
          avatar_path?: string | null
          certification_number?: string | null
          company_address?: string | null
          company_city?: string | null
          company_name?: string | null
          company_orgno?: string | null
          company_postal_code?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_admin?: boolean
          logo_path?: string | null
          logo_url?: string | null
          membership_number?: string | null
          org_name?: string | null
          phone?: string | null
          sbr_group?: string | null
          sbr_status?: string | null
        }
        Update: {
          avatar_path?: string | null
          certification_number?: string | null
          company_address?: string | null
          company_city?: string | null
          company_name?: string | null
          company_orgno?: string | null
          company_postal_code?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_admin?: boolean
          logo_path?: string | null
          logo_url?: string | null
          membership_number?: string | null
          org_name?: string | null
          phone?: string | null
          sbr_group?: string | null
          sbr_status?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          area_m2: number | null
          area_sqm: number | null
          cadastral_id: string | null
          city: string | null
          client_name: string | null
          contact_person: string | null
          cover_path: string | null
          created_at: string | null
          dwelling_type: string | null
          heating: string | null
          id: string
          last_inspected: string | null
          last_inspection_at: string | null
          municipality: string | null
          name: string
          owner: string
          owner_name: string | null
          planning_status: string | null
          plot_area_m2: number | null
          postal_code: string | null
          property_type: string | null
          roof_type: string | null
          status: string | null
          tax_value: number | null
          tenure_type: string | null
          type_code: string | null
          ventilation: string | null
          year_built: number | null
        }
        Insert: {
          address?: string | null
          area_m2?: number | null
          area_sqm?: number | null
          cadastral_id?: string | null
          city?: string | null
          client_name?: string | null
          contact_person?: string | null
          cover_path?: string | null
          created_at?: string | null
          dwelling_type?: string | null
          heating?: string | null
          id?: string
          last_inspected?: string | null
          last_inspection_at?: string | null
          municipality?: string | null
          name: string
          owner?: string
          owner_name?: string | null
          planning_status?: string | null
          plot_area_m2?: number | null
          postal_code?: string | null
          property_type?: string | null
          roof_type?: string | null
          status?: string | null
          tax_value?: number | null
          tenure_type?: string | null
          type_code?: string | null
          ventilation?: string | null
          year_built?: number | null
        }
        Update: {
          address?: string | null
          area_m2?: number | null
          area_sqm?: number | null
          cadastral_id?: string | null
          city?: string | null
          client_name?: string | null
          contact_person?: string | null
          cover_path?: string | null
          created_at?: string | null
          dwelling_type?: string | null
          heating?: string | null
          id?: string
          last_inspected?: string | null
          last_inspection_at?: string | null
          municipality?: string | null
          name?: string
          owner?: string
          owner_name?: string | null
          planning_status?: string | null
          plot_area_m2?: number | null
          postal_code?: string | null
          property_type?: string | null
          roof_type?: string | null
          status?: string | null
          tax_value?: number | null
          tenure_type?: string | null
          type_code?: string | null
          ventilation?: string | null
          year_built?: number | null
        }
        Relationships: []
      }
      room_activities: {
        Row: {
          activity_type: string
          date: string
          id: string
          ncs: string | null
          note: string | null
          product: string | null
          room_id: string
        }
        Insert: {
          activity_type: string
          date: string
          id?: string
          ncs?: string | null
          note?: string | null
          product?: string | null
          room_id: string
        }
        Update: {
          activity_type?: string
          date?: string
          id?: string
          ncs?: string | null
          note?: string | null
          product?: string | null
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_activities_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          id: string
          name: string
          note: string | null
          property_id: string
        }
        Insert: {
          id?: string
          name: string
          note?: string | null
          property_id: string
        }
        Update: {
          id?: string
          name?: string
          note?: string | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_basinfo_fields: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          input_type: string | null
          is_active: boolean | null
          is_required: boolean | null
          label: string
          options: Json | null
          order_index: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          input_type?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          label: string
          options?: Json | null
          order_index?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          input_type?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          label?: string
          options?: Json | null
          order_index?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      settings_condition_options: {
        Row: {
          created_at: string | null
          group_code: string
          id: string
          is_active: boolean | null
          label: string
          order_index: number | null
          parent_group_code: string | null
          parent_value_code: string | null
          value_code: string
        }
        Insert: {
          created_at?: string | null
          group_code: string
          id?: string
          is_active?: boolean | null
          label: string
          order_index?: number | null
          parent_group_code?: string | null
          parent_value_code?: string | null
          value_code: string
        }
        Update: {
          created_at?: string | null
          group_code?: string
          id?: string
          is_active?: boolean | null
          label?: string
          order_index?: number | null
          parent_group_code?: string | null
          parent_value_code?: string | null
          value_code?: string
        }
        Relationships: []
      }
      settings_control_point_options: {
        Row: {
          control_point_id: string
          created_at: string
          creates_risk: boolean
          ftu_code: string | null
          id: string
          is_active: boolean
          label: string
          risk_code: string | null
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          control_point_id: string
          created_at?: string
          creates_risk?: boolean
          ftu_code?: string | null
          id?: string
          is_active?: boolean
          label: string
          risk_code?: string | null
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          control_point_id?: string
          created_at?: string
          creates_risk?: boolean
          ftu_code?: string | null
          id?: string
          is_active?: boolean
          label?: string
          risk_code?: string | null
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_control_point_options_control_point_id_fkey"
            columns: ["control_point_id"]
            isOneToOne: false
            referencedRelation: "settings_control_points"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_control_points: {
        Row: {
          created_at: string
          default_ftu_code: string | null
          default_risk_code: string | null
          description: string | null
          exterior_item_key: string | null
          id: string
          is_active: boolean
          key: string
          label: string | null
          question: string | null
          risk_tags: Json | null
          room_type_key: string | null
          scope: string
          sort_order: number | null
          tags: Json | null
          title: string
          trigger_component_keys: Json | null
          trigger_foundation_types: Json | null
          trigger_room_types: Json | null
          trigger_tags: Json | null
          trigger_year_from: number | null
          trigger_year_to: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_ftu_code?: string | null
          default_risk_code?: string | null
          description?: string | null
          exterior_item_key?: string | null
          id?: string
          is_active?: boolean
          key: string
          label?: string | null
          question?: string | null
          risk_tags?: Json | null
          room_type_key?: string | null
          scope: string
          sort_order?: number | null
          tags?: Json | null
          title: string
          trigger_component_keys?: Json | null
          trigger_foundation_types?: Json | null
          trigger_room_types?: Json | null
          trigger_tags?: Json | null
          trigger_year_from?: number | null
          trigger_year_to?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_ftu_code?: string | null
          default_risk_code?: string | null
          description?: string | null
          exterior_item_key?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string | null
          question?: string | null
          risk_tags?: Json | null
          room_type_key?: string | null
          scope?: string
          sort_order?: number | null
          tags?: Json | null
          title?: string
          trigger_component_keys?: Json | null
          trigger_foundation_types?: Json | null
          trigger_room_types?: Json | null
          trigger_tags?: Json | null
          trigger_year_from?: number | null
          trigger_year_to?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      settings_disclosure_items: {
        Row: {
          code: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          label: string
          order_index: number | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          order_index?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          order_index?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      settings_exterior_groups: {
        Row: {
          created_at: string | null
          field_type: string
          id: string
          is_active: boolean
          item_id: string
          key: string
          label: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          item_id: string
          key: string
          label: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          field_type?: string
          id?: string
          is_active?: boolean
          item_id?: string
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_exterior_groups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "settings_exterior_items"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_exterior_items: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      settings_exterior_options: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          trigger_tags: Json | null
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_exterior_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "settings_exterior_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_interior_groups: {
        Row: {
          created_at: string
          field_type: string
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_type?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_type?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      settings_interior_options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          trigger_tags: Json | null
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_interior_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "settings_interior_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_interior_room_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      settings_overview_groups: {
        Row: {
          conditional_on_group_key: string | null
          conditional_on_values: Json | null
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          overview_item_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          conditional_on_group_key?: string | null
          conditional_on_values?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          overview_item_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          conditional_on_group_key?: string | null
          conditional_on_values?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          overview_item_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_overview_groups_overview_item_id_fkey"
            columns: ["overview_item_id"]
            isOneToOne: false
            referencedRelation: "settings_overview_items"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_overview_items: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          note_enabled: boolean
          selection_mode: Database["public"]["Enums"]["overview_selection_mode"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          note_enabled?: boolean
          selection_mode?: Database["public"]["Enums"]["overview_selection_mode"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          note_enabled?: boolean
          selection_mode?: Database["public"]["Enums"]["overview_selection_mode"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      settings_overview_options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          trigger_tags: Json | null
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          trigger_tags?: Json | null
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_overview_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "settings_overview_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_text_snippets: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          notes_internal: string | null
          source: string | null
          tags: Json | null
          text: string
          title: string
          type: string
          updated_at: string
          version: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes_internal?: string | null
          source?: string | null
          tags?: Json | null
          text: string
          title: string
          type: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes_internal?: string | null
          source?: string | null
          tags?: Json | null
          text?: string
          title?: string
          type?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      spaces: {
        Row: {
          building_id: string
          category: string | null
          cover_path: string | null
          created_at: string
          floor: string | null
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          building_id: string
          category?: string | null
          cover_path?: string | null
          created_at?: string
          floor?: string | null
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          building_id?: string
          category?: string | null
          cover_path?: string | null
          created_at?: string
          floor?: string | null
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spaces_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      components_calc: {
        Row: {
          adjusted_lifespan_years: number | null
          age_years: number | null
          comment: string | null
          component_type_id: string | null
          component_type_name: string | null
          condition: string | null
          condition_factor: number | null
          id: string | null
          install_year: number | null
          last_inspected: string | null
          property_id: string | null
          remaining_years: number | null
          status_color: string | null
          technical_lifespan_years: number | null
        }
        Relationships: [
          {
            foreignKeyName: "components_component_type_id_fkey"
            columns: ["component_type_id"]
            isOneToOne: false
            referencedRelation: "component_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      overview_selection_mode: "single" | "multi_set" | "per_floor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      overview_selection_mode: ["single", "multi_set", "per_floor"],
    },
  },
} as const

