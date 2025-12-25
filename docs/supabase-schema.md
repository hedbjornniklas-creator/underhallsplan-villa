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
