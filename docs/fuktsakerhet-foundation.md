# Fuktsäkerhet – modulgrund

Påbörjad 2026-09-28 efter godkänd undersökning och byggplan. Detta är den första utvecklingsetappen: projekt, identiteter, åtkomst och grunduppgifter. Fackunderlag och kundhandlingar från kunskapsarkivet kopieras inte in i appens repository.

## Funktioner i denna etapp

- Eget arbetsområde under BesiktApp på `/dashboard-v1`, adress `/fuktsakerhet`.
- Egen modulbehörighet `dashboard/moisture_safety`. TU-behörighet eller gammal administratörsflagga aktiverar inte automatiskt modulen.
- Organisationsval och organisationsbundna projekt, kundval och API-anrop.
- Projektlista med sökning och ett formulär för att skapa projekt.
- Befintlig fastighet väljs uttryckligen. Alternativt skapas en ny fastighet och nya byggnader i samma transaktion som projektet.
- Fastighetsbeteckning, kommun, adress och stabila fastighets-/byggnads-ID:n; flera byggnader i samma projekt.
- Kund från organisationens befintliga kundregister, eller komplettering senare.
- Omfattning: inventering, beskrivning och/eller projektering. Prisgrund: ännu inte bestämt, fast pris eller löpande.
- Redigering av projektets grunduppgifter, omfattning, kund och byggnadsurval med versionskontroll.
- Retry av skapande återanvänder projekt-ID och samma innehåll; en osäker nätverksrespons får inte skapa flera fastigheter/projekt.
- Guiden skiljer tillgänglig grunddata från kommande funktioner. Den påstår inte att avtal, handlingar, besök, AI, dokumentleverans eller fakturering redan är byggda.

Prisgrund är endast ett planeringsfält. Denna etapp skapar inget accepterat avtal, inget debiteringsunderlag och ingen faktura. Kund-/fastighetsuppgifter i denna arbetsvy är levande registeruppgifter. Frysta avtals- och dokumentversioner kommer i leveransetappen.

## Modell och åtkomst

`moisture_projects` är en egen domän, inte en TU-besiktning. `moisture_project_buildings` binder valda fysiska byggnader till projektet. Alla läsningar sker med serverkontrollerad organisation. Fastighetens `owner` är åtkomstägare och ska inte användas som juridisk fastighetsägare.

Tillgängligt fastighetsurval är egna fastigheter eller fastigheter som redan uttryckligen kopplats till ett fuktprojekt i aktuell organisation. Att två personer finns i samma organisation ger inte automatiskt tillgång till varandras samtliga fastigheter. En vald kund måste tillhöra organisationen, och en vald byggnad måste tillhöra projektets fastighet.

Projektets fastighet kan inte bytas i denna etapp. Komplettering av gemensamma fastighetsuppgifter sker genom fastighetsregistret med dess behörigheter. Borttagning ur projektets byggnadsurval raderar inte den fysiska byggnaden. När fältdata och godkända avtal tillkommer behöver ändrat urval få domänspecifika spärrar och ändringshistorik.

RPC-anrop för skapande/ändring är endast tillgängliga för serverns service-roll. De verifierar aktörens aktiva organisationsmedlemskap och datakopplingar igen. API:t verifierar modulbehörighet, använder explicit `orgId`, har begränsad JSON-storlek, skyddar mot främmande webbursprung och returnerar svenska fel utan databasdetaljer. Cachelagring av projekt-API-svar är avstängd.

## Installation och verifiering

Migration: `docs/db/2026-09-28_02_moisture_foundation.sql`. Den registrerar modulen och skapar projektmodellen och RPC-funktionerna. Den tilldelar inte användare automatiskt. Modulen kan tilldelas genom befintlig behörighetsadministration efter installerad migration.

Migrationen ska repeteras i testmiljö och därefter hanteras genom ordinarie releaseprocess. Att en SQL-fil finns i Git innebär inte att den är installerad. Utan datagrunden visar modulen ett bestående fel med förklaring. Denna implementation kör inte produktions-SQL, kundutskick eller fakturaanrop.

Testkommando: `npm run test:moisture`. Testerna använder syntetiska data och lokala testdubblar/SQL-miljö. Kontrollera dessutom typkontroll, ändrade filers lint och mobil/dator-vyer. Organisationstilldelning, verkliga databasbehörigheter och Next/Supabase-integration behöver bekräftas i en testinstallation före aktivering.

Verifierat lokalt den 28 september: 37 modultester godkända, däribland sju körda SQL-prov i PGlite. Därutöver passerar 16 befintliga regressionsprov för organisationsval, plattformsåtkomst och TU-profilnavigation. SQL-proven täcker bland annat återkallat medlemskap, främmande organisations kund, fel fastighet/byggnad, transaktionsåterställning, revisionskonflikt och upprepat skapande.

En isolerad förhandsvisning finns för faktisk React/CSS med syntetiskt API: `node scripts/preview-moisture.mjs --test`. Utan `--test` stannar den lokala servern öppen för manuell granskning. Den läser inga miljöhemligheter och kan inte anropa produktions-API. Detta kompletterar testinstallationen; det ersätter inte ett inloggat Next/Supabase-flöde.

Förhandsvisningens browserprov passerar vid 320, 390 och 1280 px samt faktisk 200 procents textförstoring i lista, skapaformulär och projektdetalj. Prov omfattar validering utan dataskrivning, nätfel med oförändrat skapande-ID/innehåll vid retry, revisionskonflikt med bevarad text, lyckad sparning och avbrutet organisationsbyte med osparade ändringar. Full TypeScript-kontroll och ESLint på ändrade filer passerar. Skärmbilder och byggd testbundle ligger i ignorerade `tmp/moisture-preview/`.

## Fortsatt byggordning

1. Offert/uppdragsbekräftelse med FS-villkor, prisformer, acceptans och versionsbunden leveransgrund.
2. Handlingar med original/revisioner och separata val för analys respektive leverans.
3. Platsbesök och stabila mätpunkter: TU:s insamling, ÖB:s platsnavigation och EB:s tillfällesmodell som återbruksunderlag.
4. Fackguide, risker, granskning och dokumentversioner med PDF-bilaga och länk.
5. AI med synlig lästäckning, källhänvisningar, konfliktvisning och godkänn/redigera/avvisa.
6. Digital kundarbetsyta och Fortnox enligt den tidigare planen.

Inga generella fuktgränsvärden, gamla malltexter eller avtalsvillkor har införts som godkända fackregler i denna etapp.
