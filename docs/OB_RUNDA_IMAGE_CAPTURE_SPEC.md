# ÖB-runda: mobil bildinsamling och datorbearbetning

Datum: 2026-05-13

Status: implementation-spec. Första implementationen är online-first; offline-läge avvaktas tills vidare.

## Syfte

Skapa en ny sidebar-flik i befintlig ÖB-wizard för ett snabbare arbetsflöde vid okulär besiktning.

Målet är att besiktningsmannen ska kunna gå igenom insida och utsida på mobil, välja aktivt rum eller aktiv komponent, hantera befintliga kontrollpunkter och fota snabbt utan att skapa fullständiga noteringar på plats. Bilderna används främst som minnesstöd och blir rapportmaterial först när de aktivt kopplas till en notering.

## Beslut

- Bygg nytt flöde i en separat sidebar-flik: `ÖB-runda`.
- Rör inte befintliga flikar `Byggnad - utsida` och `Byggnad - insida` i första versionen.
- Fliken har två tydliga lägen:
  - `På plats`: mobiloptimerat.
  - `Bearbeta`: datoroptimerat.
- Funktionen gäller bara överlåtelsebesiktning.
- Kontrollpunkter, statuslogik, rumstyper och utsideskomponenter ska återanvändas från befintligt ÖB-flöde.
- Bilder har ingen bildtext och inga egna anteckningar.
- Snabbanteckningar finns bara på rums-/komponentnivå och är internt stöd.
- Bilder ska alltid spara ursprunglig kontext, även om de senare flyttas eller kopplas om.
- Bara bilder som kopplas till en notering ska följa med i rapporten.
- Samma bild ska inte kunna kopplas till flera noteringar.
- Bilder kan raderas i datorläget.
- Offline/synkkö byggs inte i första versionen.

## Befintliga byggblock

Befintlig ÖB-wizard ligger huvudsakligen här:

- `src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx`
- `src/components/ob/ObWizard.tsx`
- `src/components/ob/ObStepInsida.tsx`
- `src/components/ob/ObStepUtsida.tsx`
- `src/components/ob/ControlPointSearchDialog.tsx`

Nuvarande datamodell som ska återanvändas:

- `inspection_interior_rooms`
- `inspection_exterior_observations`
- `inspection_control_items`
- `inspection_images`
- `settings_interior_*`
- `settings_exterior_*`
- `settings_control_points`
- `settings_control_point_outcomes`

Rapporten hämtar i dag rapportbilder från `inspection_images` där `control_item_id` är satt. Det passar det nya flödet: en bild är bara rapportbild när den kopplas till en notering/kontrollpunkt.

## Sidebar och komponentstruktur

Lägg till en ny section key i `ObSectionKey`, exempelvis:

```ts
| 'runda'
```

Lägg till ny sidebar-rad:

```ts
{ key: 'runda', label: 'ÖB-runda' }
```

Placering: efter `Förutsättningar`, före `Byggnad - utsida` och `Byggnad - insida`.

Föreslagen komponentstruktur:

- `src/components/ob/ObStepRunda.tsx`
- `src/components/ob/round/ObRoundSiteMode.tsx`
- `src/components/ob/round/ObRoundProcessMode.tsx`
- `src/components/ob/round/ObRoundCamera.tsx`
- `src/components/ob/round/ObRoundImageRail.tsx`
- `src/components/ob/round/ObRoundSyncStatus.tsx`
- `src/lib/ob-round/offlineQueue.ts`
- `src/lib/ob-round/imageUpload.ts`
- `src/lib/ob-round/context.ts`

## På Plats

`På plats` ska byggas för mobil först.

### Grundlayout

Överst:

- lägesväljare: `På plats` / `Bearbeta`
- synkstatus: `Synkad`, `Offline`, `Väntar på synk`, `Synkfel`
- aktiv kontext: exempelvis `Entréplan > Kök` eller `Utsida > Tak`

Huvudyta:

- val mellan `Insida` och `Utsida`
- aktivt rum/aktiv komponent
- kontrollpunkter för aktuell rumstyp eller komponent
- intern snabbanteckning
- kamerayta med stor avtryckarknapp

### Insida

Flöde:

1. Välj våningsplan.
2. Lägg till eller välj rum.
3. Rummet är aktivt tills användaren byter rum.
4. Visa kontrollpunkter kopplade till aktuell rumstyp.
5. Tillåt att lägga till befintliga kontrollpunkter via samma sök/dialog som befintlig insida.
6. Tillåt intern snabbanteckning på rummet.
7. Tillåt snabb fotografering.

Bildens ursprungliga kontext:

- `inspection_id`
- `source_area = interior`
- `origin_interior_room_id`
- `origin_floor_label`
- `origin_room_label`
- `origin_room_type_key`
- `captured_at`

### Utsida

Flöde:

1. Välj `Utsida`.
2. Välj aktiv komponent från befintliga fasta utsideskomponenter.
3. Ha även ett tydligt val `Oklassad utsida` för snabb fotografering när komponentbyte skulle störa rundan.
4. Visa kontrollpunkter kopplade till aktiv komponent.
5. Tillåt att lägga till befintliga kontrollpunkter via samma sök/dialog som befintlig utsida.
6. Tillåt intern snabbanteckning på komponenten.
7. Tillåt snabb fotografering.

Bildens ursprungliga kontext:

- `inspection_id`
- `source_area = exterior`
- `origin_exterior_item_id`, om komponent vald
- `origin_exterior_item_key`, om komponent vald
- `origin_exterior_observation_id`, om komponentens observation finns
- `captured_at`

För `Oklassad utsida` lämnas komponentfält tomma men `source_area = exterior` sätts.

### Kamera

Designmål:

- användaren ska kunna ta flera bilder i rad utan att godkänna varje bild i appen
- ingen bildanteckning
- ingen ljudinspelning
- ingen bildräknare per rum
- bara diskret feedback när bilden sparats lokalt

Teknisk riktning:

- Primärt: `navigator.mediaDevices.getUserMedia` med egen kameravy och avtryckarknapp.
- Fallback: `<input type="file" accept="image/*" capture="environment">`.
- Fallbacken kan ge mer friktion beroende på mobilens webbläsare. Det är acceptabelt som reserv, men inte som primär design.

Bildfilens storage path ska inte bero på slutlig notering. Använd exempelvis:

```text
{inspectionId}/round/{yyyy-mm-dd}/{uuid}.jpg
```

Det gör att bilden kan flyttas, ignoreras eller kopplas till olika kontexter utan att filen behöver flyttas i storage.

## Bearbeta

`Bearbeta` ska vara datoroptimerat och ligga i samma sidebar-flik.

### Layout

Tre arbetsytor:

- Vänster: struktur
  - Insida: våningsplan och rum.
  - Utsida: komponenter.
  - Oklassade bilder.
- Mitten: arbetsyta för vald plats
  - snabbanteckning som internt stöd
  - kontrollpunkter
  - noteringar enligt befintlig statuslogik
  - skapa fri notering på rums-/komponentnivå
- Höger: bildbibliotek/bildstapel
  - scrollbara thumbnails
  - filter
  - markeringsläge
  - åtgärder för markerade bilder

### Bildbibliotek

Filter:

- `Alla`
- `Obehandlade`
- `Kopplade`
- `Ignorerade`
- `Aktuell plats`
- `Oklassade`

Varje bild visar:

- thumbnail
- ursprunglig plats, exempelvis `Entréplan > Kök`
- status
- ikon/markering om den redan är kopplad
- skapad tidpunkt

Ingen bildtext visas eller redigeras.

### Bildstatus

Status kan beräknas och/eller lagras:

- `unprocessed`: ingen `control_item_id` och inte ignorerad.
- `linked`: `control_item_id` är satt.
- `ignored`: användaren har markerat bilden som ignorerad.

En bild med `control_item_id` får inte kunna kopplas till ytterligare en notering. Om användaren vill flytta bilden ska UI:t först koppla loss eller flytta kopplingen, inte duplicera den.

### Koppling till notering

Stöd två arbetssätt:

1. Markera en eller flera bilder i höger bildstapel och välj `Koppla till markerad notering`.
2. Markera en eller flera bilder och välj `Skapa fri notering av bilder`.

Drag and drop kan läggas till senare, men MVP ska fungera med markerade bilder och tydliga knappar. Det är säkrare och bättre för första implementationen.

När bild kopplas till notering:

- uppdatera `inspection_images.control_item_id`
- uppdatera aktuell kontext i befintliga fält:
  - insida: `interior_room_id`
  - utsida: `exterior_observation_id`
- sätt status till `linked`, om status lagras
- rapporten ska därefter ta med bilden eftersom `control_item_id` finns

När fri notering skapas:

- insida: skapa `inspection_control_items` med `interior_room_id`, `control_point_id = null`, `title = 'Fri notering'`
- utsida: skapa `inspection_control_items` under relevant `inspection_exterior_observations` med `control_point_id = null`, `title = 'Fri notering'`
- koppla valda bilder till den nya kontrollposten

Viktigt för utsida: om bilden ska kunna följa med i rapport ska den kopplas till `inspection_control_items`, inte bara till `inspection_exterior_observations`, eftersom rapportmappningen använder `inspection_images.control_item_id`.

## Snabbanteckningar

Snabbanteckningar är internt stöd och ska inte gå till rapport.

Exempel:

```text
Avvikande doft i rummet.
```

Skapa separat tabell i stället för att återanvända `inspection_interior_rooms.note`, eftersom befintliga `note`-fält kan ha rapportbetydelse.

Föreslagen tabell:

```text
inspection_round_quick_notes
```

Fält:

- `id uuid primary key`
- `inspection_id uuid not null references inspections(id)`
- `source_area text not null check in ('interior', 'exterior')`
- `interior_room_id uuid null references inspection_interior_rooms(id)`
- `exterior_observation_id uuid null references inspection_exterior_observations(id)`
- `exterior_item_id uuid null references settings_exterior_items(id)`
- `note text not null default ''`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Unikhet:

- högst en snabbanteckning per `inspection_id + interior_room_id`
- högst en snabbanteckning per `inspection_id + exterior_item_id`

## Datamodell för bilder

Rekommendation: utöka `inspection_images` i stället för att skapa en separat bildtabell.

Skäl:

- rapporten använder redan `inspection_images`
- befintliga bildfunktioner använder samma bucket
- en bild kan bli rapportbild genom att `control_item_id` sätts
- single-use-regeln blir naturlig, eftersom bilden bara har ett `control_item_id`

Föreslagna nya kolumner:

```text
capture_source text not null default 'legacy_upload'
source_area text null check in ('interior', 'exterior')
origin_interior_room_id uuid null references inspection_interior_rooms(id)
origin_exterior_observation_id uuid null references inspection_exterior_observations(id)
origin_exterior_item_id uuid null references settings_exterior_items(id)
origin_floor_label text null
origin_room_label text null
origin_room_type_key text null
origin_exterior_item_key text null
captured_at timestamptz not null default now()
processing_status text not null default 'unprocessed'
local_capture_id text null
ignored_at timestamptz null
ignored_by uuid null references profiles(id)
```

Constraints:

- `capture_source in ('legacy_upload', 'ob_round')`
- `processing_status in ('unprocessed', 'linked', 'ignored')`
- unik `inspection_id + local_capture_id` där `local_capture_id is not null`

Statusregler:

- när `control_item_id` sätts: `processing_status = 'linked'`
- när bild ignoreras: `processing_status = 'ignored'`, `ignored_at = now()`
- när bild kopplas loss: `processing_status = 'unprocessed'`, om den inte är ignorerad

Radering:

- i `Bearbeta` raderas både storagefil och rad i `inspection_images`
- om bilden inte är synkad raderas bara lokal IndexedDB-post

## Offline och synk (senare)

Offlinekravet gäller främst `På plats`, men avvaktas tills vidare. Första versionen sparar direkt mot Supabase och visar fel om bild eller ändring inte kan sparas.

Senare version bör stödja:

- visa tidigare hämtad besiktning efter att sidan öppnats online
- välja aktivt rum/komponent från cachad data
- ta bilder offline
- spara bilder som Blob i IndexedDB
- spara snabbanteckningar offline
- spara kontrollpunktsstatus offline för redan laddade kontrollpunkter
- lägga till rum från cachade rumstyper
- lägga till kontrollpunkter från cachad kontrollpunktskatalog
- synka när uppkoppling finns

Första versionen behöver inte stödja:

- komplett ny rapportnotering offline
- PDF/rapportgenerering offline
- avancerad konfliktlösning mellan flera enheter

Synkkö:

- varje lokal åtgärd får `local_mutation_id`
- varje lokal bild får `local_capture_id`
- IndexedDB lagrar:
  - metadata
  - Blob
  - kontext
  - köstatus
  - senaste fel
- vid synk:
  1. skapa/uppdatera nödvändiga rum/observationer/control items
  2. ladda upp bildfil till `inspection-images`
  3. skapa rad i `inspection_images`
  4. markera lokal post som synkad

Om besiktningen är låst vid synk ska operationer stoppas och visas som synkfel.

## Kontrollpunkter

Använd befintlig statuslogik:

- `inspection_control_items.status`
- `inspection_control_items.selected_outcome_id`
- `settings_control_point_outcomes`
- befintlig sökdialog för att lägga till kontrollpunkter

Ingen separat statusmodell ska skapas för ÖB-runda.

På plats ska kontrollpunkter kunna hanteras snabbt, men fotografering får aldrig kräva vald kontrollpunkt.

## Rapportbeteende

Ingen rapportändring ska behövas för MVP om kopplade bilder använder `inspection_images.control_item_id`.

Regler:

- Obehandlade bilder visas inte i rapport.
- Ignorerade bilder visas inte i rapport.
- Bilder utan `control_item_id` visas inte i rapport.
- Bilder med `control_item_id` visas under aktuell notering, enligt befintlig rapportmappning.
- Ingen bildtext/caption ska renderas.

Om `processing_status` införs bör rapportfrågor på sikt filtrera bort `ignored`, även om de normalt saknar `control_item_id`.

## Implementation i etapper

### Etapp 1: Grunddata och sidebar

- Lägg till DB-migration för bildmetadata och `inspection_round_quick_notes`.
- Regenerera Supabase-typer.
- Lägg till `runda` i `ObSectionKey`.
- Lägg till sidebar-fliken `ÖB-runda`.
- Skapa tom `ObStepRunda` med lägesväljare.

### Etapp 2: På plats online-first

- Bygg mobilvy för insida:
  - våningsplan
  - rum
  - kontrollpunkter
  - intern snabbanteckning
  - kamera
- Bygg mobilvy för utsida:
  - komponent
  - `Oklassad utsida`
  - kontrollpunkter
  - intern snabbanteckning
  - kamera
- Spara bilder direkt till `inspection_images` med `capture_source = 'ob_round'`.

### Etapp 3: Bearbeta

- Bygg datorlayout med vänster struktur, mittpanel och höger bildstapel.
- Lista alla bilder från ÖB-rundan.
- Filtrera bilder.
- Markera bilder.
- Koppla bilder till befintlig notering.
- Skapa fri notering av markerade bilder.
- Ignorera bild.
- Radera bild.

### Etapp 4: Offline (pausad)

- Lägg till IndexedDB-cache för runddata och bildkö.
- Spara bilder lokalt offline.
- Lägg till synkstatus.
- Synka bilder och snabbanteckningar när uppkoppling finns.
- Hantera synkfel tydligt.

### Etapp 5: Polering

- Snabba mobilinteraktioner.
- Tangentbordsvänlig datorbearbetning.
- Bildförhandsvisning i större modal.
- Flytta/omklassificera ursprunglig eller aktuell kontext.
- Eventuell drag and drop från bildstapel till notering.

## Acceptanskriterier

- Användaren kan öppna `ÖB-runda` i sidebar utan att befintliga `Insida` och `Utsida` påverkas.
- På mobil kan användaren välja våningsplan och rum, ta flera bilder i följd och byta rum när rundan går vidare.
- Bilder tagna i ett rum visar senare vilket rum de togs i.
- På utsida kan användaren fota både mot vald komponent och som `Oklassad utsida`.
- Snabbanteckning på rum/komponent visas i `ÖB-runda` men inte i rapport.
- Kontrollpunkter i `ÖB-runda` använder samma statuslogik som befintligt flöde.
- Obehandlade bilder visas inte i rapport.
- När bild kopplas till en notering visas den i rapporten.
- Samma bild kan inte kopplas till två noteringar.
- Bild kan raderas i datorläget.
- Offlinebilder sparas inte lokalt i första versionen; användaren ska få tydligt fel om uppladdning/sparning inte fungerar.

## Risker och begränsningar

- Kontinuerlig kamera i webbläsare kräver `getUserMedia`, HTTPS och mobilens kamera-behörighet.
- iOS/Safari kan bete sig annorlunda än Chrome/Android; fallback behövs.
- IndexedDB har lagringskvot. Komprimera bilder innan lokal lagring och uppladdning.
- Konflikter mellan flera enheter hanteras enkelt i MVP. Senaste synk vinner, förutom när besiktningen är låst.
- Befintlig rapportmappning för utsida visar bilder via `control_item_id`; därför måste bildkoppling till rapportnotering ske via `inspection_control_items`.
