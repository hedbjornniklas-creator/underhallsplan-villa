Underhållsplan Villa – Tech Overview (v2.2)

Databassanning
- Faktiskt schema och typer genereras i src/types/supabase.ts. Detta dokument beskriver avsedda flöden; vid konflikt gäller typerna i filen.

Stack & verktyg
- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- Supabase: Postgres + RLS, Supabase Auth, Storage bucket property-media
- ESLint + Prettier, npm
- Kör lokalt: npm install && npm run dev (http://localhost:3000)

Systemidé
- En central hub för överlåtelsebesiktning, statusbesiktning och underhållsplanering.
- Samla fastighetsdata en gång, återanvänd i besiktning, risk/FTU och underhållsplan.
- Undvika dubbelregistrering och parallella system.

Navigering & sidor
- /login: Supabase Auth.
- /: Redirect till /properties.
- /properties: Lista fastigheter (filter Utkast/Aktiv/Arkiverad/Alla). “Ny fastighet” skapar rad med status "Utkast" och owner = inloggad användare.
- /properties/[id]: Fastighetssida med basdata (adress, kommun, taxeringsinfo m.m.), omslagsbild (publik URL), byggnader samt länk till överlåtelsebesiktning. Basdata sparas direkt till properties.
- /properties/[id]/buildings: Lista byggnader för fastigheten, byt omslagsbild (signed URL), hantera galleri.
- /properties/[id]/buildings/[buildingId]: Byggnadsdetalj. Basinfo via basic_fields/building_basic_values (kritiska fält markeras), upplysningar via building_disclosures.
- /properties/[id]/ob: Lista överlåtelsebesiktningar för fastigheten.
- /properties/[id]/ob/[inspectionId]: ÖB-wizard med sektioner: overview, grunddata, handlingar (inkl. upplysningar och fel), förutsättningar, utsida, insida, risk, ftu.
- /inspections: Global lista över besiktningar (alla properties, ingen ägarfiltrering i UI).
- /settings/*: Admin för handlingstyper, förutsättningar, utsida/insida/control-points m.m. (gated på profiles.is_admin i client).

Datamodell (Postgres/Supabase)
- properties: id (uuid, PK), owner (profiles.id), name (required), address/postal_code/city/municipality, cadastral_id, plot_area_m2, owner_name, contact_person, property_type, tenure_type (fri sträng), dwelling_type (fri sträng), status (fri sträng), tax_value, planning_status, type_code, cover_path, created_at/last_inspected/last_inspection_at, area_m2/area_sqm, heating/ventilation/roof_type/type_code/property_type. Det finns inget metadata-fält.
- buildings: id, property_id -> properties, name, built_year, notes, cover_path, created_at/updated_at.
- spaces: building_id -> buildings, name, category, floor, cover_path, notes (seedas när byggnad skapas).
- basic_fields: global mall för byggnadsbasinfo (key, label, field_type, options, field_group Bas/Utsida/Insida, is_critical, order_index, is_active). building_basic_values binder building_id + field_id + value_text. Byggnads-sammanfattning läser nycklarna year_built, building_type, floors, area_m2, heating, ventilation.
- building_disclosures: byggnadsvisa upplysningar (title, content, link_url).
- building_media: building_id, path (lagras i bucket), caption, sort_order.
- inspections: property_id -> properties, date, type (str, t.ex. OB), status (str), inspector_name, assignment_number, inspection_side (buyer/seller), scope (semikolon-lista), attendees, attendees_other, inspection_time, client_name, client_contact, defect_disclosures (fri text), created_at.
- inspection_documents: inspection_id -> inspections, document_type_id nullable -> document_types, title, status (present/missing/na), document_date, document_value, note, file_url, created_at/updated_at.
- document_types: code, label, category, scope (building/property), description, is_active, is_default, result_label, result_unit, validity_years, recommended_interval_years, interval_note.
- inspection_disclosures: inspection_id -> inspections, title, note, source_image_url, answer (str), disclosure_item_id nullable -> settings_disclosure_items. I nuvarande UI används en enda rad som fri text; mallfrågor (settings_disclosure_items) används inte ännu.
- inspection_conditions: inspection_id (1:1), furnishing_level m.m. (Används i Förutsättningar-steget).
- settings_overview_items/groups/options och inspection_overview_selections: styr Förutsättningar (selection_mode single/multi_set/per_floor, conditional_on_values, note_enabled).
- settings_exterior_*, settings_interior_*, settings_control_points: styr utsida/insida/kontrollpunkter i ÖB-steget.
- components, component_types, actions, maintenance_templates: grund för underhållsplan/åtgärder kopplade till property (ej färdig UI).

Adminpanel
- /settings/handlingar-upplysningar: CRUD för document_types (alla fält inkl. result_label/unit, intervall, giltighet, scope, is_active/default).
- /settings/forutsattningar: CRUD för overview-items/groups/options som driver inspection_overview_selections.
- /settings/ob-utsida, /settings/ob-insida, /settings/ob-control-points m.fl.: mallar för kontrollpunkter och val i utsida/insida.
- basic_fields hanteras i utsida/insida-settings (används av byggnadssidorna för basinfon).

Åtkomstmodell (RLS)
- Ägarskap kedjas via profiles.id -> properties.owner -> inspections.property_id (+ child-tabeller). inspections har ingen egen owner.
- Klient: fastighetslistan filtrerar på inloggad användare; övriga vyer litar på RLS. is_admin används bara för att visa settings-sidor; det finns ingen klientlogik som visar “alla fastigheter” utan RLS-policies.

Fil- och bildhantering (bucket property-media)
- Fastighetens omslag: upload till {propertyId}/cover.ext med upsert; public URL sparas i properties.cover_path via getPublicUrl (kräver att bucket/tillägg medger publik läsning eller tokens i URL:n).
- Byggnadsomslag: upload {propertyId}/{buildingId}/cover.ext; path sparas i buildings.cover_path; klienten hämtar signerad URL vid render.
- Byggnadsgalleri: upload {propertyId}/{buildingId}/gallery/{uuid.ext}; signerad URL används vid visning och filen tas bort på delete.
- Det finns i nuläget ingen inspelningsmapp per inspectionId.

Kodprinciper
- App Router med server + client components, TypeScript överallt, Tailwind för UI, Protected runt app-sidor.
- Enkel, läsbar kod framför tidig abstraktion. Uppdatera TECH_OVERVIEW innan nya funktioner som påverkar datamodell, flöden eller juridik.

Juridisk ram (översikt)
- Systemet dokumenterar, inte automatiserar juridisk överlåtelsebesiktning.
- Risk- och FTU-texter ska hämtas ur databasen; PDF-export ska bära ansvarstext, upplysningskälla, datum och besiktningsman.

Fortsatt utveckling (kort)
- Koppla risk/FTU-texter från Excel/DB, PDF-export.
- Underhållsplan (10–30 år) och kostnadsprognoser.
- AI-stöd för upplysningar via foto (tillval).
