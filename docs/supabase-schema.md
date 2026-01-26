All kod som pratar med databasen ska följa detta schema. Om något saknas: fråga, gissa inte.

# Supabase – Databasschema

Denna fil beskriver databasen som används i projektet.
All databaskod ska följa detta schema.

## Tabell: properties
- id (uuid)
- name (text)
- address (text)

## Tabell: inspections
- id (uuid)
- property_id (uuid → properties.id)
- date (date)
- status (text)

Relationer:
- En property kan ha flera inspections

## Tabell: inspection_control_items
- id (uuid)
- inspection_id (uuid -> inspections.id)
- interior_room_id (uuid -> inspection_interior_rooms.id, nullable)
- exterior_observation_id (uuid -> inspection_exterior_observations.id, nullable)
- control_point_id (uuid -> settings_control_points.id, nullable)
- selected_outcome_id (uuid -> settings_control_point_outcomes.id, nullable)
- title (text)
- note (text)
- sort_order (int)

## Tabell: inspection_overview_selections
- id (uuid)
- inspection_id (uuid -> inspections.id)
- overview_item_id (uuid -> settings_overview_items.id)
- values (jsonb)
- set_index (int)
- created_at (timestamp)
- building_type använder values.floors, values.basement, values.attic (attic visas som "vind" i Insida)

## Tabell: settings_control_point_outcomes
- id (uuid)
- control_point_id (uuid -> settings_control_points.id)
- label (text)
- risk_template (text)
- ftu_template (text)
- sort_order (int)
- is_active (bool)

## Tabell: inspection_exterior_observations
- id (uuid)
- inspection_id (uuid -> inspections.id)
- exterior_item_id (uuid -> settings_exterior_items.id)
- part_label (text)
- note (text)
- values (jsonb)
- created_at (timestamp)

## Tabell: inspection_interior_rooms
- id (uuid)
- inspection_id (uuid -> inspections.id)
- floor_label (text)
- room_label (text)
- room_type_key (text)
- note (text)
- order_index (int)

## Tabell: inspection_images
- id (uuid)
- inspection_id (uuid -> inspections.id)
- control_item_id (uuid -> inspection_control_items.id, nullable)
- file_path (text)
- sort_order (int)
- created_at (timestamp)

## Storage: inspection-images
- Bucket for inspection photos.
- file_path stored in inspection_images.file_path.

