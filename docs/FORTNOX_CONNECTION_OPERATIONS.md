# Fortnox-anslutning: driftsättning och pilot

Den här runbooken gäller endast anslutning och autentisering. Den här versionen
skapar eller ändrar inga kunder, fakturor eller andra poster i Fortnox.

## Beslutad lösning

- HusHub använder Fortnox OAuth2 med `account_type=service`.
- Samma centrala integration och Client ID används för flera HusHub-organisationer.
- Varje organisation har högst en anslutning och varje Fortnox `TenantId` får
  vara kopplat till högst en HusHub-organisation.
- Redirect URI i produktion är exakt:
  `https://hushub.se/api/integrations/fortnox/callback`
- Begärd scope i denna leverans är exakt `companyinformation`, `customer` och
  `invoice`. Applikationens validering och databasens constraints avvisar både
  partiella och extra scope-set. Äldre `companyinformation`-anslutningar bevaras
  endast med status `needs_reauthorization`.
- Authorization code och access-/refresh-token används endast i serverns minne
  och lagras inte. Anslutningsraden innehåller TenantId, företagsnamn,
  organisationsnummer, scopes, status, anslutande profil, felkod,
  anslutningsversion och tidsstämplar—aldrig credentials eller tokenvärden.
- OAuth `state` är slumpmässigt, sparas endast som SHA-256-hash, är bundet till
  startande profil och organisation, löper ut efter tio minuter och kan bara
  konsumeras en gång.
- När ett nytt flöde startas för samma organisation blir alla äldre försök
  ersatta. Databasen serialiserar starten och tillåter endast att organisationens
  nyaste OAuth-försök sparar eller ersätter anslutningen, även om en äldre
  callback kommer tillbaka senare.
- Utgångna OAuth-state-rader äldre än 24 timmar rensas opportunistiskt när ett
  nytt anslutningsflöde startar. De innehåller endast hash, aldrig rått state.

Statusen i Settings är den senast verifierade statusen. Den här etappen har
ingen webhook för återkallat Fortnox-medgivande, men en administratör kan välja
**Kontrollera anslutning** för en livekontroll med det sparade TenantId:t. Om
Fortnox avvisar klientuppgifterna, åtkomsten eller behörigheten markeras raden
som `needs_reauthorization`; tillfälliga nät-, rate-limit- eller 5xx-fel ändrar
inte den lagrade statusen. Administratören kan därefter välja
**Återanslut Fortnox**.

## Scopebeslut

Välj `companyinformation`, `customer` och `invoice` i Utvecklarportalen:

- Fortnox scopes ger både läs- och skrivrättighet; det finns inget separat
  read-only-scope.
- Denna anslutningsrelease använder fortfarande bara företagsinformationen och
  skapar ännu inga kunder eller fakturor. Skrivfunktionerna byggs och testas som
  separata steg med idempotens och uttryckligt användargodkännande.
- Alla redan anslutna företag måste återansluta och godkänna det kompletta setet.
  Kontrollera samtidigt att företaget har nödvändig Fortnox-licens.

## 1. Konfigurera Fortnox Utvecklarportal

Gör detta i JNH Consulting AB:s Fortnox Utvecklarportal:

1. Öppna den dolda HusHub-integrationen.
2. Aktivera servicekonto för integrationen.
3. Behåll integrationen dold/opublicerad under pilotfasen.
4. Välj scopen `companyinformation`, `customer` och `invoice`.
5. Sätt Redirect URI till exakt
   `https://hushub.se/api/integrations/fortnox/callback` utan avslutande snedstreck.
6. Spara Client ID och Client Secret i en godkänd lösenords-/hemlighetshanterare.
   Lägg dem inte i Git, SQL, supportärenden, skärmbilder eller chatten.

Fortnox tillåter att en dold integration används via dess Client ID. STYR
behöver därför ingen egen Utvecklarportal. Den Fortnox-användare som godkänner
servicekontot måste vara systemadministratör i det valda Fortnox-företaget.

## 2. Applicera databasmigreringen

Granska och kör följande filer i ordning genom projektets ordinarie Supabase-flöde eller
SQL Editor, före applikationsdeployen:

1. `docs/db/2026-09-09_05_fortnox_connection_foundation.sql`
2. `docs/db/2026-09-10_03_fortnox_customer_invoice_scopes.sql`

Migrationerna är transaktionella och skapar eller uppdaterar:

- `organizations.organization_number` i formatet `XXXXXX-XXXX` med giltig
  Luhn-kontrollsiffra;
- Luhn-kontroll och ett databasskydd som hindrar `anon`/`authenticated` från att
  kringgå den behörighetskontrollerade serverrouten för organisationsnumret;
- `fortnox_connections` med en rad per organisation, unikt TenantId, en monoton
  `connection_version` och ett strikt scopekontrakt;
- `fortnox_oauth_states` för kortlivade, hashade engångs-state med en monoton
  försökssekvens och högst ett väntande försök per organisation;
- `create_fortnox_oauth_state(...)` för att serialisera nya försök och ersätta
  äldre väntande försök;
- `consume_fortnox_oauth_state(...)` för atomisk engångskonsumtion;
- `save_fortnox_connection_from_oauth_state(...)` för att atomiskt kontrollera
  att callbacken hör till det nyaste försöket innan anslutningen sparas och
  samtidigt höja anslutningens version;
- `apply_fortnox_connection_verification(...)` för att spara en livekontroll
  endast om både organisation, TenantId och den lästa anslutningsversionen
  fortfarande är aktuella;
- RLS och grants där bastabellerna, alla mutationer och OAuth-state är
  helt serverprivata (`service_role`-only). `anon` och `authenticated` saknar
  både direkt tabellåtkomst och exekveringsrätt till mutationsfunktionerna.
  Den autentiserade statusrutten gör medlemskontroll och returnerar endast den
  säkra statusprojektionen, aldrig TenantId.

Scopeutökningen markerar befintliga `companyinformation`-anslutningar som
`needs_reauthorization` och tillåter därefter bara det historiska setet i det
läget eller det kompletta aktuella setet. Den kan köras om utan att höja
`connection_version` ytterligare för en redan markerad rad.

De lokala migrationstesterna applicerar SQL i en isolerad PGlite-databas. De
innebär inte att migreringen har körts i Supabase.

Kontrollera installationen utan att läsa några hemligheter:

```sql
select
  to_regclass('public.fortnox_connections') is not null as connection_table_ready,
  to_regclass('public.fortnox_oauth_states') is not null as oauth_state_table_ready,
  to_regprocedure(
    'public.create_fortnox_oauth_state(text,uuid,uuid,text[],timestamp with time zone)'
  ) is not null as create_state_function_ready,
  to_regprocedure('public.consume_fortnox_oauth_state(text,uuid)') is not null
    as consume_function_ready,
  to_regprocedure(
    'public.save_fortnox_connection_from_oauth_state(text,uuid,text,text,text,text[],timestamp with time zone)'
  ) is not null as newest_attempt_commit_ready,
  to_regprocedure(
    'public.apply_fortnox_connection_verification(uuid,text,bigint,text,text[],text)'
  ) is not null as versioned_verification_ready;
```

Alla sex värden ska vara `true`.

## 3. Lägg in Vercels miljövariabler

Lägg följande i Vercel-projektets **Production**-miljö. Ändrade variabler kräver
en ny deploy.

| Variabel | Värde | Hantering |
| --- | --- | --- |
| `FORTNOX_CLIENT_ID` | Client ID från JNH:s integration | Server-side; använd inte `NEXT_PUBLIC_` |
| `FORTNOX_CLIENT_SECRET` | Client Secret från JNH:s integration | Hemlighet, endast server-side |
| `FORTNOX_REDIRECT_URI` | `https://hushub.se/api/integrations/fortnox/callback` | Sätt explicit även om koden har samma produktionsstandard |
| `APP_BASE_URL` | `https://hushub.se` | Befintlig serverkonfiguration, utan sökväg; måste ha samma origin som Redirect URI |

Befintliga `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` och
`SUPABASE_SERVICE_ROLE_KEY` måste också vara korrekta. Service role-nyckeln är
serverhemlig. Lägg inte något Fortnox-värde i en `NEXT_PUBLIC_`-variabel.

Lämna Fortnox-variabler tomma i Development/Preview tills den miljön har en
avsiktligt registrerad, exakt callback. För sandbox rekommenderas en separat
dold Fortnox-testintegration och en separat HusHub stagingmiljö.

### Beslutad riskhantering: OAuth-parametrar i Vercels loggar

Fortnox returnerar authorization code och `state` som sökparametrar till
callbackens GET-adress. HusHub lagrar dem inte och applikationskoden loggar inte
hela request-URL:en, sökparametrar eller provider-svaret. Det tar dock inte bort
plattformsrisken: Vercels Runtime Logs visar sökparametrar i requestdetaljer och
en Log Drain kan innehålla `proxy.path` med query-parametrar. Detta sker före
eller utanför Next.js-routehanterarens kontroll; response headers kan inte
förhindra det.

Fortnox föreskriver det här GET-baserade callbackformatet. Authorization code är
giltig i tio minuter, kan endast användas en gång och kan inte växlas utan
integrationens Client ID, Client Secret och identiska Redirect URI. Access-token,
refresh-token och Client Secret förekommer aldrig i callback-URL:en.

Den 9 september 2026 valdes den befintliga Vercel-callbacken för sandbox och
pilot. Beslutet accepterar den begränsade residualrisken att authorization code
och `state` kan visas i Vercels åtkomstskyddade Runtime Logs. Projektet körde då
på Hobby-planen, vars dokumenterade loggretention var en timme. Detta är ett
uttryckligt riskbeslut, inte teknisk redigering av sökparametrarna.

Ett syntetiskt produktionstest samma dag bekräftade att callbacken svarar med
`303`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` och en
ren `/settings`-adress. Testmarkörerna syntes samtidigt under Search Params i
Vercel, vilket bekräftar den dokumenterade residualrisken. Inga riktiga
Fortnoxvärden användes och inget provideranrop genomfördes.

Följande skydd är obligatoriska så länge den här lösningen används:

1. Kontot ska ha MFA och projekt-/loggåtkomst ska begränsas till minsta
   nödvändiga grupp. Vid beslutstillfället var MFA aktivt och teamet hade en
   medlem.
2. Inga Log Drains får omfatta callbacken. Vid beslutstillfället fanns ingen
   Log Drain. Inventera på nytt om Vercel-planen eller loggkonfigurationen ändras.
3. Applikationskod får aldrig logga hela callback-URL:en, `code`, `state`,
   provider-svar eller tokenvärden.
4. Callback-loggrader får inte kopieras eller delas i supportärenden.
5. Koden ska växlas omedelbart, `state` ska förbrukas atomiskt en gång och
   webbläsaren ska därefter alltid skickas till en ren URL med `303`, `no-store`
   och `no-referrer`. De skydden finns i den här leveransen och täcks av tester.
6. Riskbeslutet ska omprövas om fler scopes läggs till, Vercels åtkomst eller
   retention ändras eller integrationen går från begränsad pilot till bred drift.

Om verksamheten senare kräver en absolut garanti att sökparametrarna aldrig
lagras hos Vercel finns ingen dokumenterad Vercel-inställning som ger det. Då
krävs en separat härdad ingress eller ett annat callbackformat som Fortnox
dokumenterat stöder.

## 4. Verifiera i Fortnox sandbox

Gör detta innan STYR:s riktiga konto används:

1. Bekräfta att de beslutade kontrollerna för callbackloggning ovan fortfarande
   gäller. Skapa därefter en sandbox i JNH:s Utvecklarportal. Fortnox tillåter
   flera samtidiga testmiljöer.
2. Rekommenderat: skapa en separat dold testintegration med servicekonto,
   `companyinformation`, `customer`, `invoice` och callback till en dedikerad
   HTTPS-stagingmiljö:
   `https://<staging-host>/api/integrations/fortnox/callback`.
3. Lägg testintegrationens Client ID/Secret och exakt samma callback i endast
   stagingmiljön. Sätt även stagingmiljöns `APP_BASE_URL` till dess HTTPS-origin.
4. Applicera migreringen i stagingdatabasen och skapa/använd en separat HusHub-
   testorganisation. Spara sandboxföretagets verkliga organisationsnummer på
   testorganisationen; hitta inte på ett nummer.
5. Logga in som organisationsadministratör i HusHub, öppna `/settings`, välj
   testorganisationen och klicka **Anslut Fortnox**.
6. Logga in i sandboxen som systemadministratör, välj rätt testföretag och
   godkänn servicekontot.
7. Kontrollera att återkomsten visar rätt företagsnamn och organisationsnummer,
   att behörigheterna är **Företagsinformation**, **Kundregister** och **Fakturor**
   och att `Senast verifierad` har uppdaterats.
   Klicka därefter **Kontrollera anslutning** och kontrollera att liveverifieringen
   lyckas och uppdaterar tidsstämpeln igen.
8. Testa ett avsiktligt felaktigt HusHub-organisationsnummer. Flödet ska ge
   meddelandet om annat företag och får inte skapa/ersätta anslutningsraden.
9. Kontrollera med ett icke-admin-konto att status kan läsas men att nummer,
   anslutning, livekontroll och återanslutning inte kan ändras.

Verifiera den lagrade raden utan att skriva ut TenantId:

```sql
select
  org_id,
  tenant_id ~ '^[0-9]+$' as tenant_id_valid,
  company_name,
  company_organization_number,
  granted_scopes,
  status,
  connection_version > 0 as connection_version_valid,
  connected_at,
  last_verified_at
from public.fortnox_connections
where org_id = '<HUSHUB_TEST_ORG_ID>'::uuid;
```

Förväntat: exakt en rad, `tenant_id_valid = true`,
`connection_version_valid = true`, exakt `companyinformation`, `customer` och
`invoice` samt `status = 'connected'`. Klistra inte in TenantId eller andra riktiga
företagsuppgifter i supportloggar.

## 5. Anslut STYR första gången

Förutsättningar: produktionsmigreringen är installerad, koden är deployad,
Vercel-variablerna är satta, sandboxprovet är godkänt och STYR-användaren är
både aktiv organisationsadministratör i HusHub och systemadministratör i STYR:s
Fortnox.

1. Logga in i HusHub och öppna `https://hushub.se/settings`.
2. Välj STYR:s organisation i Fortnox-kortet om användaren har flera organisationer.
3. Spara STYR:s riktiga organisationsnummer. Kontrollera siffrorna mot
   företagsuppgifterna i Fortnox.
4. Klicka **Anslut Fortnox**.
5. Logga in i Fortnox, välj rätt företag och godkänn som systemadministratör.
6. Efter återkomsten ska kortet visa
   `Fortnox anslutet – STYR Projekt Stockholm AB` och samma organisationsnummer
   som sparades i HusHub.
7. Klicka **Kontrollera anslutning**. Kontrollera därefter `Senast verifierad`,
   behörigheterna **Företagsinformation**, **Kundregister** och **Fakturor** samt
   exakt en databasrad för STYR:s
   HusHub-organisation med kontrollfrågan ovan.
8. Kontrollera en annan HusHub-organisation: den ska fortfarande vara separat
   och inte visa STYR:s anslutning.

Kör inte kund- eller fakturaanrop som del av pilotverifieringen; sådana
funktioner ingår inte i denna version.

## 6. Återanslutning och ändrade scopes

**Kontrollera anslutning** gör ett nytt serveranrop med Client Credentials och
det sparade TenantId:t, läser endast företagsinformation och verifierar TenantId,
organisationsnummer och exakt scope igen. Lyckad kontroll uppdaterar
företagsnamn och `last_verified_at`. Avvisade credentials, åtkomst eller
behörigheter sätter `status = 'needs_reauthorization'`; tillfälliga providerfel
bevarar föregående status så att ett driftavbrott inte felaktigt kräver nytt
medgivande. Centrala konfigurationsfel, till exempel ett felaktigt Client Secret,
bevarar också organisationens status. Resultatet sparas med versionskontroll;
om en återanslutning eller annan livekontroll hinner före kasseras det äldre
resultatet och Settings läser om aktuell status. Endast
organisationsadministratörer kan starta kontrollen och TenantId lämnar aldrig
servern.

**Återanslut Fortnox** startar ett nytt profil- och organisationsbundet state,
verifierar företaget två gånger och ersätter därefter samma organisationsrad.
Det går därför att använda samma knapp efter ändrade behörigheter eller ett
återkallat medgivande. Om flera försök startas för samma organisation kan endast
det nyaste försöket sparas; en äldre callback ska visas som ersatt och får inte
skriva över den nyare anslutningen.

Vid en framtida scopeändring ska portalens scopes, kodens scopekontrakt, tester och
driftdokumentation ändras i samma release. Varje redan ansluten organisation måste
sedan återansluta. Aktivera aldrig ett nytt write-capable scope enbart i portalen
och anta att befintliga anslutningar uppdateras.

## 7. Felsökning

| Symtom | Trolig orsak | Åtgärd |
| --- | --- | --- |
| Serverkonfiguration saknas | Client ID/Secret saknas eller deployen använder gamla env-värden | Kontrollera Production-variablerna i Vercel och gör en ny deploy; visa aldrig Secret |
| Konfigurationsfel direkt efter callback | Redirect URI eller `APP_BASE_URL` är fel | Jämför exakta HTTPS-adresser, callback-sökväg och avsaknad av avslutande snedstreck |
| Settings visar att serverkonfigurationen är ogiltig | Client ID har ogiltigt format eller `APP_BASE_URL` och Redirect URI har olika origin | Korrigera Vercel-variablerna utan att skriva ut Client Secret och deploya igen |
| Anslutningen har löpt ut, redan använts eller ersatts | State är äldre än tio minuter, återspelat, startat i annan session eller följt av ett nyare försök för organisationen | Gå tillbaka till Settings och starta ett nytt flöde i samma inloggade webbläsare; slutför bara det senast startade försöket |
| Godkännandet avbröts/åtkomst nekad | Användaren avbröt, är inte systemadministratör eller servicekonto är av | Slå på servicekonto och låt en Fortnox-systemadministratör godkänna |
| Fel företag/organisationsnummer | Vald Fortnox-tenant matchar inte HusHub-organisationens juridiska nummer | Kontrollera sparat nummer och starta om flödet med rätt Fortnox-företag |
| Företaget redan anslutet till annan organisation | Samma TenantId är redan bundet i HusHub | Utred vilken organisation som är korrekt; radera eller flytta inte raden utan beslutad migrering |
| Saknad behörighet i HusHub | Kontot saknar aktivt org-adminmedlemskap eller exakt Dashboard/Admin-tilldelning | Rätta den befintliga åtkomstmodellen; skapa ingen parallell Fortnox-roll |
| Databasstödet saknas | Migrationerna är inte applicerade i rätt Supabase-projekt | Kör och verifiera `2026-09-09_05` följd av `2026-09-10_03` |
| Fortnox kan inte nås | Timeout, rate limit eller tillfälligt 5xx-fel | Kontrollera Fortnox driftstatus och försök igen; logga inte provider-svar eller credentials |
| Anslutningen ändrades under kontrollen | En återanslutning eller parallell livekontroll hann spara en nyare version | Läs den aktuella statusen som Settings hämtar om; kör bara en ny kontroll om statusen fortfarande behöver verifieras |
| Kontroll visar “Behöver återanslutas” | Fortnox avvisar Client Credentials, access-token, licens eller scope | Kontrollera Fortnox-behörighet och välj **Återanslut Fortnox** som systemadministratör |
| Nytt scope saknas efter portaländring | Befintligt medgivande behåller tidigare scopes | Använd Återanslut efter att kod, portal och licens är klara |

## 8. Avstängning, återkallelse och rollback

- Att ta bort Fortnox-variablerna och deploya om stoppar nya anslutningar men
  återkallar inte ett redan lämnat medgivande hos Fortnox.
- Vid verklig avstängning ska medgivandet/integrationen först tas bort i Fortnox
  av behörig administratör enligt Fortnox aktuella gränssnitt och rutiner.
- Denna etapp har ingen raderingsknapp i HusHub. Radera inte anslutningsrader
  manuellt som en vanlig rollback; de är kopplade till organisationsidentiteten.
- Ta inte bort tabeller eller kolumner vid kodrollback. Behåll den additiva
  migreringen och återställ framåt med en ny migrering.
- Rotation av Client Secret är ett planerat omaktiveringsarbete, inte bara ett
  byte av miljövariabel. Fortnox anger att samtliga kunder måste aktivera
  integrationen på nytt för att nya fungerande tokens ska kunna hämtas.
  Inventera därför alla anslutna HusHub-organisationer, avisera administratörerna,
  rotera Secret i Fortnox, uppdatera Vercel-hemligheten, deploya, verifiera i
  sandbox och låt sedan varje organisation köra **Återanslut Fortnox**. Följ upp
  att samtliga organisationer har en ny verifierad anslutning. Lägg aldrig det
  gamla eller nya värdet i Git.

## Lokala kontroller

```bash
npm run test:fortnox
npx tsc --noEmit
npm run build
```

Riktad ESLint ska också köras för Fortnox-filerna före deploy. Tester använder
syntetiska värden och mockade provideranrop; de skapar inga Fortnox-poster och
genomför ingen riktig anslutning.

## Officiella källor

- [Developer Portal](https://www.fortnox.se/developer/developer-portal)
- [Get Authorization-Code](https://www.fortnox.se/developer/authorization/get-authorization-code)
- [Get Access-Token](https://www.fortnox.se/developer/authorization/get-access-token)
- [Get Access-Token using Client-Credentials](https://www.fortnox.se/developer/authorization/get-access-token-using-client-credentials)
- [Scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes)
- [Errors](https://www.fortnox.se/developer/guides-and-good-to-know/errors)
- [Kom igång med utvecklarportalen – scopes och Client Secret-rotation](https://support.fortnox.se/kom-igang/integrationer/kom-igang-med-utvecklarportalen)
- [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime)
- [Vercel Log Drains – loggschema](https://vercel.com/docs/drains/reference/logs)
