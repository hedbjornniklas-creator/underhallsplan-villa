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

## Etapp B2: inbjudan och kontoaktivering

Implementerat lokalt 2026-09-08, avstängt tills driftkontrollen är gjord:

- `/admin/access/besiktapp-invitations`, länkad från intresselistan, kräver global `hushub_admin/access_management`. Administratören väljer mottagare, ett befintligt eller nytt företag och uttryckligen valda arbetsområden (ÖB, EB, TU). En granskningsruta visas före utskick. Inga administratörsrättigheter ingår.
- En personlig länk gäller i sju dagar. Endast SHA-256-hashen lagras. Token ligger i URL-fragmentet, inte i sidans GET-adress eller referrer. Sidan är noindex och använder no-referrer. API-svar cachas inte. Länken måste ändå behandlas som en hemlighet; mejlsystem och webbläsarhistorik kan innehålla den.
- Upprepade skapandeförsök med samma request-ID skickar inte fler mejl. ”Skicka ny länk” byter token och gör den gamla ogiltig. Återkallelse gäller ännu ej accepterade inbjudningar; den tar inte bort en redan aktiverad användares behörighet. Revisionskontroll skyddar mot samtidiga adminändringar.
- `/besiktapp/aktivera` visar mottagare, företag och moduler. Befintliga konton loggar in med sitt lösenord; nya väljer ett lösenord på minst 12 tecken. Ett befintligt lösenord ändras aldrig av inbjudan. Fel inloggat konto måste bytas. Att öppna länken aktiverar inget: det krävs ett uttryckligt formulärinskick.
- Databasfunktionen kontrollerar verifierad e-post, giltig inbjudan och modulregister. Profil, företagsmedlemskap, valda modulbehörigheter och accepterad status hanteras i samma SQL-transaktion. Befintlig profilinformation bevaras. Redan accepterade inbjudningar ger samma användare ett idempotent svar utan att återaktivera senare borttagna behörigheter.
- Befintlig BesiktApp-behörighet (även inaktiv), äldre administratörsmarkering, annat företagsmedlemskap eller inaktivt/administrativt medlemskap stoppar automatisk aktivering. Samma företags aktiva besiktningsmannamedlemskap kan användas. Detta är en avsiktligt begränsad första version, inte ett verktyg för företagsbyte eller ändring av befintlig BesiktApp-access.
- Behörigheterna använder modulvis global scope enligt befintlig BesiktApp-modell. Den här etappen bygger inte om befintliga accessregler eller RenoApp. Aktiveringen uppdaterar inte automatiskt intresselistans uppföljningsstatus.
- Efter aktivering leder en ensam modul direkt till `/ob`, `/eb` eller `/tu`; flera moduler leder till `/dashboard-v1`. Profilintroduktionen i etapp C återstår.

### Viktig transaktionsgräns

Supabase Auths kontoskapande och databasens behörighetstransaktion är två separata operationer. Om kontot skapats men SQL-aktiveringen misslyckas behålls kontot utan tilldelning från SQL-transaktionen. Användaren får instruktionen att logga in med det nya lösenordet och försöka igen eller kontakta support. Inget konto raderas automatiskt. Produktionsmiljöns befintliga Auth-triggers och standardbehörigheter måste granskas före aktivering: testmiljön bevisar inte deras beteende.

### Driftkontroll före pilot

1. Granska och installera `docs/db/2026-09-08_02_besiktapp_invitations.sql` genom ordinarie migrationsflöde. Kontrollera befintliga org-/profil-/access-tabeller och att valbara moduler och inspector-rollen finns aktiva. Tabellen och RPC-funktionen tillåter endast service-rollen, inte anon/authenticated.
2. Kontrollera Auth-triggers, e-postinställningar och att ett nytt konto utan tilldelning inte får oavsiktlig standardåtkomst. Verifiera företagsisolering och modulbegränsning med riktiga appkontroller i avskild testmiljö, inklusive RenoApp-only-konto och avbruten aktivering.
3. Kontrollera `APP_BASE_URL` (rätt HTTPS-origin), `ASSIGNMENTS_MAIL_FROM`, `RESEND_API_KEY` och verifierad avsändardomän. Behåll övriga utskicks beroenden. Kontrollera att mejlets fragmentlänk bevaras genom klickspårning och mejlklienter. Gör ett godkänt verkligt leveransprov; ”accepterat av mejlleverantören” bevisar inte inkorgsleverans.
4. Komplettera den instanslokala anropsbegränsningen med driftens edge/WAF-skydd. Den lokala begränsningen är inte distribuerad och återställs vid omstart. Säkerställ att proxyloggar/APM inte samlar in token eller lösenord från POST-kroppar.
5. Bestäm personuppgiftshantering, gallring och vem som hanterar konto-/företagskonflikter. Inga prisvillkor eller provperioder införs av denna funktion.
6. Sätt först därefter `BESIKTAPP_INVITATIONS=1` och publicera genom ordinarie flöde. Utan flaggan kan inga inbjudningar skapas, läsas eller accepteras via dessa API:er. Återgång: stäng av flaggan; redan tilldelade behörigheter tas inte bort.

Ingen migration, flagga, produktionsbehörighet, skarpt konto eller riktigt mejl har skapats eller ändrats under utvecklingen.

### Tester av B2

- `npm run test:besiktapp-invitations`: 7 testgrupper passerar. Faktisk SQL i isolerad PGlite kontrollerar identitet, företagskonflikter, modulval, utgångna/återkallade länkar, idempotens, nekad direktåtkomst samt återställning vid ett simulerat fel mitt i tilldelningen. Mockade tjänste-/API-tester täcker Auth-fel, befintliga konton, origin/body-validering, tokenrotation och utskicksåterförsök.
- `npm run test:besiktapp-intake` och `npm run test:public-products` passerar. Full typkontroll och riktad ESLint passerade vid denna kontroll.
- `node scripts/preview-besiktapp-invitations.mjs` startar en isolerad UI-vy med mockad Auth och API. Webbläsartest verifierade granskning före utskick, tömda fält efter simulerat utskick, nya kontots lösenordsbekräftelse, synligt fel vid olika lösenord, aktiveringsbekräftelse med direktlänk till ÖB och hjälp vid ogiltig länk. Formulärlayouten granskades visuellt på desktop. Mobil och skarp Supabase-/mejl-integration återstår inför pilot.

## Verifiering av etapp A

`npm run test:public-products` innehåller renderingskontroller för tom, partiell och fullständig profil, meriter, escapad användartext samt offentlig kontakt utan läckage av privata mottagarinställningar. Befintliga tester täcker validering, mejlfel och återförsök med mockad leverans. Komplettera med typkontroll och browserkontroll av de publika sidorna.

Kontroll 2026-09-08: 26/26 tester passerade, riktad ESLint passerade och intressesidan samt BesiktApps inloggningshjälp kontrollerades i lokal webbläsare. Projektets fullständiga typkontroll stoppade i parallellt ändrade `src/components/eb/EbFollowUpOrder.tsx:151` (`retryable` saknas på `EbFollowUpOffer`); det felet ändrades inte inom etapp A. Det stängda formulärets reservkontakt och profilens olika tillstånd verifierades genom komponentrendering, inte genom ett nytt produktionskonto. Ingen ny PDF-export eller riktig mejlleverans genomfördes.
