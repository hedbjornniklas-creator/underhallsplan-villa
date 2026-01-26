Om något inte finns här eller i src/types/supabase.ts, så finns det inte. Gissa inte.
Kontrollpunkter, utfall (chips), risk & FTU
Detta system använder en normaliserad datamodell där kontrollpunkter (vad som kontrolleras)
är strikt åtskilda från utfall (vad som observeras).

Syften:
- Juridisk robusthet enligt SBR‑praxis
- Enhetliga besiktningar oberoende av besiktningsman
- Återanvändbar data mellan ÖB, statusbesiktning och UHP
- Skalbar struktur

Tabeller:

settings_control_points
- Definierar kontrollpunkter
- Innehåller titel, beskrivning, scope och koppling till komponent
- Innehåller inga risk- eller FTU-texter

settings_control_point_outcomes
- Definierar möjliga utfall (chips)
- Ett utfall per rad
- Kopplat till kontrollpunkt
- Innehåller severity, risk_template och ftu_template

inspection_control_items
- Instans av kontrollpunkt i en besiktning
- Pekar på control_point_id och selected_outcome_id
- Styr färg, risk och FTU i UI och utlåtande

inspection_overview_selections
- Sparar val för Förutsättningar (values JSON)
- För building_type: keys floors, basement, attic
- attic-värdet används för att visa "vind" i Insida (label via settings_overview_groups key attic + settings_overview_options.value)

UI-status:
- Röd: ej behandlad
- Grön: inget att notera
- Gul: utfall valt

Risk- och FTU-texter hämtas alltid från settings_control_point_outcomes.

settings_control_point_options används inte i nuvarande arkitektur och betraktas som legacy.

Report/utlatande - dataflow (schema-level)
- Suggestion mapping uses inspection_control_items.selected_outcome_id to settings_control_point_outcomes (risk_template/ftu_template).
- Exterior: settings_exterior_items + inspection_exterior_observations + inspection_control_items (exterior_observation_id).
- Interior: inspection_interior_rooms + inspection_control_items (interior_room_id).
- Photos: inspection_images (control_item_id) with storage bucket inspection-images.
- Public URLs in report are built via NEXT_PUBLIC_SUPABASE_URL + /storage/v1/object/public/inspection-images/{path}.

