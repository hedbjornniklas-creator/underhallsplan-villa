# Underhållsplan Villa – Tech Overview

En Next.js + Supabase-app för att skapa och hantera underhållsplaner för villor.  
Målet: kombinera översikt från underhållsplaner med arbetssätt från överlåtelsebesiktning (SBR-tänk) i ett modernt, enkelt verktyg.

---

## 1) Stack & verktyg

- **Frontend**: Next.js 16 (App Router), React, TypeScript, Tailwind CSS
- **Auth & DB**: Supabase (Postgres + RLS), Supabase Auth (Email/Password)
- **Fil-lagring**: Supabase Storage (bucket `property-media`)
- **UI-ikoner**: `lucide-react`
- **Kodkvalitet**: ESLint (standard), Prettier (implicit via VS Code-formattering)
- **Paket-hanterare**: npm

Kör lokalt:
```bash
npm install
npm run dev
# http://localhost:3000
Miljövariabler i .env.local:

ini
Kopiera kod
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
2) Katalogstruktur (viktiga filer)
bash
Kopiera kod
src/
  app/
    (auth)/
      layout.tsx                # Layout för auth-flöde (utan sidebar)
      login/page.tsx            # Supabase Auth UI (inloggning)
    (app)/
      layout.tsx                # Huvudlayout (Shell + Topbar + Sidebar)
      page.tsx                  # Översiktssida efter login
      properties/page.tsx       # Lista + skapa fastighet
      properties/[id]/page.tsx  # Fastighetssida (visa/redigera + omslagsbild + "lägg till byggnad")
      properties/[id]/buildings/page.tsx            # Byggnader-lista
      properties/[id]/buildings/[buildingId]/page.tsx # Byggnadsvy: utrymmen + komponenter
      admin/page.tsx            # Admin: dokumenttyper + komponentkatalog
    favicon.ico
    globals.css
    layout.tsx                  # Rotlayout (App Router)
  components/
    Protected.tsx               # Inloggningsskydd (redirect till /login)
    Shell.tsx                   # App-ram (topbar + sidebar + innehåll)
    Topbar.tsx                  # Övre rad (logo, profil, logout-knapp)
    Sidebar.tsx                 # Sidonavigation
  hooks/
    useProfile.ts               # Läser profil + adminflagga
  lib/
    supabaseClient.ts           # Supabase-klient (browser)
public/
  *.svg
3) Navigering & sidor
/login – Inloggning via Supabase Auth UI.

/ – Översikt (visar bl.a. “Röda först”, placeholder för statistik).

/properties – Fastighetslista:

Sök/filtret (Aktiv/Arkiverad/Utkast/Alla)

+ Ny fastighet → skapar utkast & skickar direkt till detaljsidan

/properties/[id] – Fastighetssida:

Visa/Redigera grunddata inline (namn, adress, ägare, byggår, area, uppvärmning, ventilation, senaste besiktning)

Omslagsbild: uppladdning till Supabase Storage (property-media/{propertyId}/cover.ext)

+ Lägg till byggnad → skapar byggnad och leder till byggnadslistan (just nu): /properties/[id]/buildings

/properties/[id]/buildings – (enkel lista) byggnader för fastigheten

/properties/[id]/buildings/[buildingId] – Byggnadssida:

Utrymmen (Spaces): vänsterlista, lägg till utrymme (namn + kategori)

Komponenter (Components): under utrymmen, lägg till komponent (namn, status, install. år, livslängd)

Denna sida är tänkt att bära Handingar & upplysningar och Basinformation-rutor längre fram

/admin – Adminpanel:

Dokumenttyper (document_types): kod, label, kategori, scope (property/building), default, beskrivning

Komponentkatalog (component_types): kod, namn, kategori, standard-livslängd, anteckning

Protected.tsx skyddar alla (app)-sidor (kräver inloggning). (auth)-sidor visas utan sidomeny.

4) Datamodell (Postgres/Supabase)
Kärntabeller
properties

id (uuid PK), owner (uuid), name, address, client_name,
year_built (int), area_m2 (int), heating, ventilation,
last_inspection_at (date), cover_path (text), status ('Utkast'|'Aktiv'|'Arkiverad')

buildings

id (uuid PK), property_id (uuid FK -> properties.id), name, cover_path (text), created_at

spaces

id (uuid PK), building_id (uuid FK -> buildings.id), name, category, created_at

components

Minimal variant används nu (enligt befintlig tabell i databasen):

id (uuid PK), property_id (uuid), component_type_id (uuid),
install_year (int), condition (text), last_inspected (date), comment (text), created_at

(Frontend-formuläret använder nyare fältnamn – dessa mappas senare eller så uppdateras tabellen.)

Admin-tabeller
document_types

id (uuid PK), code, label, category, scope ('property'|'building'), is_default (bool), description

component_types

id (uuid PK), code, name, category, default_lifecycle_years (int), notes

OBS: Vissa tabeller/fält kan saknas i din DB just nu. Lägg till dem via Supabase SQL Editor när du aktiverar respektive funktion.

5) RLS (Row Level Security) – principer
properties: ägaren (eller teamet) får läsa/skriva. Nuvarande prototyp använder enkel ägarkoppling (owner = auth.uid()).

buildings / spaces / components: åtkomst via koppling till properties.owner.

storage (property-media):

Inloggade får ladda upp/uppdatera filer under {propertyId}/... om de äger fastigheten

Läsning: public bucket under prototypen (enkelt) – kan bytas till signerade URLs senare

profiles: is_admin flagga styr åtkomst till /admin

Du har redan lagt RLS-policys bitvis; om fel “RLS violation” dyker upp, kolla att policyn finns för rätt tabell/operation.

6) Viktiga UI-flöden
Skapa fastighet (från /properties)
Klick + Ny fastighet

Appen skapar rad i properties med temporärt namn (status: Utkast)

Redirect → /properties/{id}

Fastighetssidan
Inline-edit (Visa/Redigera) för grunddata

Omslagsbild: laddas upp till property-media/{propertyId}/cover.ext, URL sparas i properties.cover_path

+ Lägg till byggnad: skapar byggnad, valfritt seedar standard-utrymmen, redirect till byggnader

Byggnadssidan
Välj/lägg till Utrymmen (ex. “Badrum”, “Kök”, “Tak”, “Fasad” …)

Per utrymme: lägg till Komponenter (status, år, livslängd – används senare för plan/graf)

Kommer att få rutor för Handlingar & upplysningar och Basinformation (byggnadstyp, stomme, tak m.m.)

Admin
Redigera Dokumenttyper (för den guidade listan i “Handlingar & upplysningar”)

Redigera Komponentkatalog (centrala namn & standard-livslängder)

7) Bildhantering (Supabase Storage)
Bucket: property-media (public under prototyp)

Uppladdning: propertyId/cover.jpg (upsert)

Frontend sparar cover_path i properties

Cache-busting i UI: ?v=timestamp för att tvinga ny bild att laddas

Produktion: byt till privat bucket + signerade URL:er, och lägg caching-regler i Next.js.

8) Kodkonventioner
TypeScript i App Router (server/client-komponenter).

“Skydda” sidor med <Protected> som kollar supabase.auth.getUser().

Enkla, funktionella komponenter.

Tailwind för layout/spacing/typografi.

useProfile() för att hämta profil + admin.

9) Bygga vidare – plan
Handlingar & upplysningar:

Visa en checklista (från document_types där scope='building')

För varje rad: checkbox + datum + länk till uppladdat dokument

DB-tabell: t.ex. building_documents (id, building_id, document_type_id, present (bool), date, file_url)

Basinformation (byggnad):

Tabell building_facts (id, building_id, key, value) eller kolumner direkt på buildings

Komponenter:

Knyt till component_types + statusfärger (Grön/Gul/Röd) och räkna plan/budget framåt

Plan & Budget:

Generera 10-års vy med kostnader per år, exportera till PDF

Behörighet:

“Inspektör ser allt” vs “Kund ser sin fastighet” → nya policys och rollhantering

Deployment:

Vercel (Next.js) + Supabase (prod-projekt).

Signerade filer (produktion): byt Storage-läget.

10) Git & repo
Repo: underhallsplan-villa

Vanligt flöde:

bash
Kopiera kod
git pull
git checkout -b feature/xyz
# jobba, committa
git push -u origin feature/xyz
# öppna Pull Request på GitHub
Dokumentation i docs/:

TECH_OVERVIEW.md (detta dokument)

DB_NOTES.md (DDL, policies, seed)

ROUTES.md (sidor och URL-struktur)

TODO.md (nästa steg / backlog)

11) Vanliga fel & lösningar
RLS violation (insert/update)
→ Saknas policy för tabell/operation eller fel owner. Verifiera auth.uid() i policyn.

next/image “unconfigured host”
→ Lägg till Supabase-domänen i next.config.ts under images.remotePatterns.

Bild byts inte i UI efter uppladdning
→ Använd cache-buster (?v=Date.now()) och/eller key={src} på <Image>.

404 på nya sidor
→ Kontrollera mappstruktur under src/app/... och att filen heter page.tsx.

12) Juridik (översikt, ej rådgivning)
Detta är inte en traditionell överlåtelsebesiktning (ÖB).

Tjänsten bör beskrivas tydligt i villkor/avtal: omfattning, metod, ansvarsbegränsningar, försäkring, standardtexter.

När export (PDF) kommer – inkludera ansvarsbegränsning, upplysningskällor, datum och signatur.

Kontakt/ägarskap
Ägande: STYR Projekt Stockholm AB

Repo: (GitHub) underhallsplan-villa

Huvudansvar: Niklas (produkt), ev. utvecklare/partners läggs till efter behov.