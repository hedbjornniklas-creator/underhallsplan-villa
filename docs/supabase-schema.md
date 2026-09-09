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

## Tabell: inspection_report_links
- id (uuid)
- org_id (uuid → organizations.id)
- inspection_id (uuid → inspections.id)
- assignment_id (uuid → assignments.id, nullable)
- token_hash (text, unik; endast hash av den publika länktoken lagras)
- delivery_mode (text: link_pdf eller link_only)
- snapshot_schema_version (text, nullable)
- snapshot_payload (jsonb, fryst utlåtande för ÖB, TU eller EB)
- pdf_base64 (text, nullable; äldre lagringsformat)
- pdf_sha256 (text, nullable)
- pdf_storage_bucket (text, nullable)
- pdf_storage_path (text, nullable)
- pdf_size_bytes (bigint, nullable)
- pdf_status (text: pending, processing, ready eller failed)
- pdf_error (text, nullable)
- pdf_attempts (int)
- pdf_max_attempts (int, standard 3)
- pdf_started_at (timestamp, nullable)
- pdf_generated_at (timestamp, nullable)
- pdf_next_attempt_at (timestamp, nullable)
- pdf_locked_at (timestamp, nullable)
- pdf_locked_by (text, nullable)
- created_by (uuid → profiles.id, nullable)
- created_at (timestamp)
- revoked_at (timestamp, nullable)

PDF-kön är gemensam för ÖB, TU och EB. Service-role-arbetaren reserverar och
slutför jobb atomiskt via `claim_inspection_report_pdf_jobs` och
`finish_inspection_report_pdf_job`. Supabase Cron anropar den skyddade
applikationsrutten varje minut; misslyckade eller avbrutna jobb återköas med
begränsad backoff och högst tre försök. Ett aktivt jobb betraktas tidigast som
inaktuellt efter sex minuter (standard tio), vilket ligger över den fem minuter
långa maximala applikationskörningen.

## Tabell: inspection_report_pdf_cron_requests
- request_id (bigint, primärnyckel; pg_net-anropets id)
- requested_at (timestamp)

Tabellen innehåller inga URL:er, headers eller hemligheter. Den används av
`inspection_report_pdf_cron_configuration_status()` för att koppla senaste
schemalagda anrop till dess HTTP-status i `net._http_response`.

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

## Modul: Uppdrag v1

Fullständigt schema, constraints, RPC:er och RLS finns i
`docs/db/2026-08-20_01_operational_tasks_foundation.sql`.
Den korta förmigrationen
`docs/db/2026-08-20_00_platform_access_assignments_rls.sql` stänger direkt
webbläsaråtkomst till den gemensamma behörighetstabellen och ska köras separat
före Uppdrag-migrationen.

Kärntabeller:
- `organization_contacts`: externa och valfritt profilkopplade mottagare per organisation.
- `operational_tasks`: rotuppdrag och underuppdrag; skaparen är uppdragsansvarig och varje uppdrag har exakt en mottagare.
- `task_requirements`, `task_events`, `task_attachments`: kontrollpunkter, audit trail och färdigbevis.
- `task_deadline_change_requests`: begärd förlängning och uppdragsansvarigs beslut.
- `task_access_links`: enbart SHA-256-hash av personliga, tidsbegränsade externa länkar.
- `task_followup_rules`, `task_messages`, `task_message_deliveries`, `task_automation_jobs`: uppföljnings- och kommunikationskö.
- `task_ai_runs`, `task_ai_suggestions`: auditerbara Gizmo-körningar och människogranskade förslag.

V1-gränser per organisation är två undernivåer, fem öppna barn per uppgift,
fem AI-barn per uppgift, tre väntande AI-förslag per rot och femton aktiva
efterkommande uppgifter.
Binära bevis lagras privat i Storage-bucket `task-evidence` (25 MB per fil);
servern använder service role och signerade läslänkar.

Atomiska Uppdrag-RPC:er hanterar skapande av rot-/underuppdrag, statusövergång,
kontrollpunktsbeslut, deadlinebegäran/-beslut och rotation av externa länkar.
Kontrollpunkter som verifieras binds till ett konkret bevis när regeln kräver det.

## Modul: Fortnox-anslutning

Fullständigt schema, constraints, RPC och RLS finns i
`docs/db/2026-09-09_05_fortnox_connection_foundation.sql`.

- `organizations.organization_number`: nullable juridiskt organisationsnummer i
  kanoniskt format `XXXXXX-XXXX` med Luhn-kontroll. En trigger hindrar
  webbläsarrollerna `anon` och `authenticated` från att ändra värdet utanför den
  behörighetskontrollerade serverrouten.
- `fortnox_connections`: en anslutning per `org_id`; TenantId är unikt mellan
  organisationer. Företagsnamn, verifierat organisationsnummer, beviljade
  scopes, status, anslutande profil, en monoton `connection_version` och
  tidsstämplar lagras. En constraint kräver exakt ett scope,
  `companyinformation`; extra scopes kan inte lagras. Tabellen innehåller inga
  Client Secrets, authorization codes eller access-/refresh-token.
- Den sammansatta främmande nyckeln
  `(org_id, company_organization_number)` säkerställer att Fortnox-företagets
  verifierade juridiska identitet matchar HusHub-organisationen.
- `fortnox_oauth_states`: SHA-256-hash av slumpmässigt state, monoton
  `attempt_sequence`, organisation, startande profil, exakt
  `companyinformation`, utgångstid och konsumtionstid. Rått state lagras inte.
  Ett unikt partiellt index tillåter högst ett väntande försök per organisation.
  Utgångna rader äldre än 24 timmar rensas opportunistiskt när ett nytt flöde
  startar.
- `create_fortnox_oauth_state(...)`: låser organisationen, konsumerar äldre
  väntande försök och skapar det nya försöket atomiskt.
- `consume_fortnox_oauth_state(text, uuid)`: atomiskt engångsuttag som kräver
  rätt profil, okonsumerat state och framtida utgångstid.
- `save_fortnox_connection_from_oauth_state(...)`: låser samma organisation och
  sparar endast om inget försök med högre `attempt_sequence` finns. En sen
  callback från ett äldre försök kan därför inte skriva över den nyaste och en
  lyckad save höjer `connection_version`.
- `apply_fortnox_connection_verification(...)`: uppdaterar status och höjer
  versionen endast när organisation, TenantId och förväntad `connection_version`
  fortfarande matchar. Resultat från en äldre eller parallell kontroll kan
  därför inte skriva över en återanslutning eller nyare kontroll.
- Webbläsarroller saknar helt tabellåtkomst till `fortnox_connections` och
  `fortnox_oauth_states`, och kan inte exekvera Fortnox-mutationsfunktionerna;
  bastabeller och mutationer är `service_role`-only med RLS aktiverat.
  Settings-status läses via en serverroute som först filtrerar på den aktuella
  profilens aktiva medlemskap och bara returnerar säkra fält utan TenantId.
- En organisationsadministratör kan starta en liveverifiering via serverrouten
  `/api/integrations/fortnox/verify`. Den använder TenantId endast på servern,
  uppdaterar `last_verified_at` vid lyckad kontroll och sätter
  `needs_reauthorization` när Fortnox permanent avvisar organisationens
  anslutning. Tillfälliga fel och centrala integrationskonfigurationsfel lämnar
  den lagrade statusen oförändrad.

