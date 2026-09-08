# BesiktApp: start för nya användare

## Första etappen, 2026-09-08

Arbetsmodellen är kontaktbaserad start. En intresseanmälan skapar inte konto eller behörighet. Vi lovar ingen provperiod, svarstid, demonstration eller automatisk aktivering. Pris och kommersiella villkor är ännu inte publicerade.

Kodändringar i etapp A:

- BesiktApps startsida, produktsida, intressesida och inloggning hänvisar till kontakt, inte till ett overifierat företagsinbjudningsflöde. RenoApps inbjudningar påverkas inte.
- `PUBLIC_BESIKTAPP_CONTACT_EMAIL` är en uttryckligen godkänd offentlig reservväg: `jn@hedbjorn.se`. Den visas vid formuläret och när formuläret är avstängt. Den är separat från intern mejlkonfiguration och bolagets allmänna kontaktfält.
- ÖB-visitkortet visar endast profilens egna uppgifter. Tomma eller ofullständiga profiler får en uppmaning att komplettera och en synlig länk till profilinställningarna.
- Globala TU-utskriftsmarginaler innehåller inte längre ett fast företagsnamn eller en persons kontaktuppgifter. Rapporternas egna databaserade identitetsuppgifter ändras inte.

## Driftkontroll som återstår före formulärlansering

Lokal kontroll visar att mottagare, avsändare och Resend-nyckel finns, men att avsändaren använder Resends testdomän. Detta bevisar inte fungerande leverans. Produktionsvärden har inte kunnat verifieras från den lokala miljön: ingen Vercel-CLI, projektkoppling eller tillgänglig Vercel-token hittades.

1. Öppna rätt HusHub-projekt i befintlig Vercel-miljö.
2. Kontrollera `BESIKTAPP_INTEREST_TO`, `ASSIGNMENTS_MAIL_FROM` och `RESEND_API_KEY` för Production. Ändra inte den gemensamma avsändaren utan att bedöma påverkan på övriga utskick.
3. Kontrollera verifierad avsändardomän och mottagarbegränsningar hos Resend. Flytta inte nycklar eller privata driftvärden till publik kod.
4. Publicera genom projektets ordinarie flöde. Kontrollera att formuläret visas på `/besiktapp/intresse`.
5. Genomför ett uttryckligen godkänt leveransprov med testdata till rätt mottagare. Bekräfta både leverantörsstatus och mottagen post. Ett accepterat API-anrop räcker inte.
6. Kontrollera svarsfunktionen, studsar, skräppost och vem som bevakar inkorgen.

Ingen produktionsändring, riktig intresseanmälan, kontoskapande eller mejlsändning utförs av komponenttesterna. Reservlänken fungerar efter publicering även om formuläret ännu är stängt.

## Fortsatt genomförande

- Etapp B: kort startbeskrivning på produktsidan, uppföljningsbar förfrågan och ett verifierat inbjudnings-/aktiveringsflöde. Kartlägg befintlig autentisering och företagskoppling först. Användare i olika företag får aldrig sammanblandas.
- Etapp C: återupptagbar profilintroduktion och första uppdraget. Direktstart för användare med endast ÖB; tydligt val för flera tillgängliga arbetsområden.
- Etapp D: användartest och kontrollerad lansering. Testa nya och befintliga konton, begränsade behörigheter, utgångna/återkallade länkar och misslyckade mejl.

## Etapp B1: startbeskrivning och uppföljning

Implementerat lokalt 2026-09-08:

- `/besiktapp` beskriver tre steg: kontaktuppgifter, behov/upplägg och tillgång till rätt arbetsområden. Inga löften om provperiod, direktregistrering eller automatisk inbjudan.
- Ny sida `/admin/access/besiktapp-interest`, länkad från adminstartsidan. Sidans serverkontroll och API kräver `hushub_admin/access_management` med global scope enligt befintlig accessmodell.
- Lista med statusfilter och sidindelning. Status, ansvarigs namn och uppföljningsdatum kan sparas. Statusen är en intern uppföljningsanteckning: ”Aktiverad” skapar inte konto eller behörighet. Ansvarig är ett namn, inte en behörighetstilldelning.
- Förfrågan sparas före aviseringsmejlet när databasläget är aktiverat. Identiska återförsök använder samma post; ändrat innehåll är en ny förfrågan. Leverantörens befintliga idempotensnyckel används fortsatt för mejlen. En accepterad mejlstatus kan inte skrivas över av ett senare misslyckat försök.
- Uppföljningen använder revisionsnummer för att upptäcka samtidiga ändringar. En konflikt ger ett fel och uppmanar till omläsning. Besökarens fria text renderas som text, inte HTML.

### Aktivering och driftgräns

1. Granska och kör `docs/db/2026-09-08_01_besiktapp_interest_tracking.sql` i avsedd databas genom ordinarie migrationsflöde. Migrationen har testats i isolerad PGlite, inte körts mot Supabase.
2. Säkerställ rätt administratörsbehörighet, privat servernyckel och befintliga mejlinställningar. Tabellen har RLS och inga policies för webbläsarroller; dessa har även nekats tabellrättigheter. Endast serverns service-roll kan läsa och skriva.
3. Bestäm ansvar för uppföljning, information till besökare samt gallring/hantering av personuppgifter innan verkliga förfrågningar börjar lagras. Ingen automatisk gallring eller radering via UI ingår ännu. Redan mottagna mejlförfrågningar importeras inte automatiskt.
4. Sätt `BESIKTAPP_INTEREST_TRACKING=1` på servern och publicera via ordinarie flöde. Utan flaggan fungerar tidigare mejlflöde och adminlistan visar att den inte är aktiverad. Om flaggan sätts före migrationen stoppar databasfel nya inskick; ingen tyst återgång till mejl sker.
5. Gör godkänt test av formulär → lagrad förfrågan → aviseringsmejl → adminuppföljning. Läs särskilt poster med misslyckad/obekräftad avisering. API-acceptans är inte en leveransbekräftelse från mottagarens inkorg.
6. Återgång: stäng av flaggan för att återgå till tidigare mejlflöde. Detta raderar inte lagrade poster, men listan blir avstängd. Bevaka därför befintliga poster innan återgång.

Ingen flagga, databas, konto, behörighet eller produktion har ändrats av denna etapp. Automatisk bekräftelse till besökaren återstår; bekräftelsen visas än så länge bara på webbsidan.

### Aktivering av användare: kartläggningsresultat

`AccessManagementClient.tsx` tilldelar BesiktApp-moduler med global scope. `org_members`/`organizations` hanteras separat, och `assignments/server.ts` har en automatisk organisationskoppling för användare som saknar sådan. `access/server.ts` kan även använda äldre medlemskap som reservväg när produktassignments saknas. Därför räcker inte en ensam ”skapa konto”-åtgärd för att garantera rätt företagskoppling och begränsad åtkomst.

Nästa del (B2) behöver verifiera hela kedjan: inbjudande administratör → befintligt/nytt företag → mottagande befintligt/nytt konto → rätt medlemskap och moduler. Återkallade inbjudningar, befintligt medlemskap i annat företag och fel mitt i aktiveringen måste testas innan skarpa inbjudningar tillåts. Ingen av dessa befintliga accessregler ändrades i B1.

### Tester av B1

- `npm run test:besiktapp-intake`: 28 tester passerar, inklusive faktisk lokal SQL-migration, unika requestnycklar och nekad tabellåtkomst för anon/authenticated.
- `npm run test:public-products`: 29 tester passerar. Riktad ESLint passerar.
- `node scripts/preview-besiktapp-intake.mjs` startar en isolerad UI-vy med fiktiva uppgifter, utan Supabase eller mejl. Browserkontroll verifierade sparning/återläsning av status, ansvarig och datum samt synligt konfliktfel utan överskrivning. Publik startsektion kontrollerad lokalt.
- Full typkontroll passerade först, men en senare körning stoppade i samtidigt ändrade `test/eb-customer-session.test.ts:78` (HeadersInit-typ). Inga fel rapporterades i B1-filerna. EB-filen lämnades orörd.

## Verifiering av etapp A

`npm run test:public-products` innehåller renderingskontroller för tom, partiell och fullständig profil, meriter, escapad användartext samt offentlig kontakt utan läckage av privata mottagarinställningar. Befintliga tester täcker validering, mejlfel och återförsök med mockad leverans. Komplettera med typkontroll och browserkontroll av de publika sidorna.

Kontroll 2026-09-08: 26/26 tester passerade, riktad ESLint passerade och intressesidan samt BesiktApps inloggningshjälp kontrollerades i lokal webbläsare. Projektets fullständiga typkontroll stoppade i parallellt ändrade `src/components/eb/EbFollowUpOrder.tsx:151` (`retryable` saknas på `EbFollowUpOffer`); det felet ändrades inte inom etapp A. Det stängda formulärets reservkontakt och profilens olika tillstånd verifierades genom komponentrendering, inte genom ett nytt produktionskonto. Ingen ny PDF-export eller riktig mejlleverans genomfördes.
