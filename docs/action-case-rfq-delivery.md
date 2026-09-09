# Offertunderlag via mottagarlank

## Driftsattning

1. Kontrollera att tidigare migrationer for Uppdrag, inklusive
   `2026-09-09_04_action_case_package_pricing.sql`, ar installerade.
2. Kor `docs/db/2026-09-09_08_action_case_rfq_delivery_links.sql`.
   Migrationen ar transaktionell och kan koras igen utan att skriva om utskick.
3. Kontrollera serverinstallningarna `APP_BASE_URL` (kanonisk HTTPS-adress),
   `ASSIGNMENTS_MAIL_FROM`, `RESEND_API_KEY` och befintlig Supabase service-role.
4. Driftsatt appen. Ingen historisk e-post skickas om automatiskt.
5. Verifiera i testmiljo med en intern mottagare: fler an 5 MB valda bilder,
   forhandsgranskning, ett utskick, mobil bildvisning, originalnedladdning,
   aterkallning och nekad atkomst med en annan fils ID.

Kontaktvalet anvander `workspace.people` fran Uppdrag. Valet fyller i namn och
e-post men skapar inga nya kontakter, deltagare eller atkomstrattigheter.

## Leverans och atkomst

- Nya forfragningar skickas med en lank, inte med filernas base64-data i mejlet.
  Hogst 30 valda filer. Befintlig grans pa 25 MB per uppladdad originalfil kvarstar.
- Varje utskick far en egen oforanderlig kopia av text, filmetadata och filbytes.
  Originalen och befintliga deltagarbehorigheter andras inte.
- Filkopior finns i den privata bucketen `action-case-rfq-files` utan
  browserpolicies. Leveransraden och befintligt idempotent send-claim sparas i
  samma databastransaktion efter att kopiorna forberetts.
- Lanken ar en delbar bearer-lank: den som har den kan lasa just detta underlag.
  Den galler i 90 dagar fran forsta send-claim och kan aterkallas. Filadresser
  signeras for 60 sekunder; redan nedladdade filer kan inte aterkallas.
- Tokenhash lagras i leveranstabellen. Den frysta mejlpayloaden innehaller den
  fullstandiga mottagarlanken och ska darfor ocksa behandlas som hemlig.
- Ingen atkomst till interna priser, offertdokument fran andra UE eller andra
  filer i arendet ges via lanken. Ett separat arendeportalstilltrade skapas inte.
- Vid oklart mejlresultat anvands samma payload och idempotensnyckel vid nytt
  forsok. Aldre paborjade utskick behaller sina ursprungliga bifogade filer;
  de konverteras inte till lankar i efterhand.

## Fel, aterstallning och lagring

- Misslyckad kopiering stoppar utskicket och tar bort kandidatkopiorna.
- Om claim misslyckas tas kopior bort bara nar en efterfoljande lasning sakert
  visar att ingen leveransrad skapades. Vid osaker databasanslutning lamnas
  kopiorna privata i stallet for att riskera att radera ett skickat underlag.
- Det finns ingen automatisk gallring av utgangna leveranser eller osakra
  kandidatkopior i detta steg. De ar inte publikt tillgangliga. Vid framtida
  gallring maste varje leverans-ID jamforas med databasen; gallra aldrig endast
  utifran datum eller lankens aterkallningsstatus.
- Vid aterstallning av appversion: behall tabellen och bucketen. De behovs for
  redan utskickade lankar. Ta inte bort skickade kopior eller mejlpayloads.

## Lokal verifiering

`node --experimental-strip-types --test test/action-cases-*.test.mjs`

`node scripts/test-action-case-costing-ui.mjs`

Databastester anvander PGlite; mejl och lagringsanrop testas med kontrollerade
stubbar. UI-tester kor verkliga komponenter med syntetiska data i 1440 och
390 pixels bredd. Inga produktionsmejl eller produktionsandringar ingar.
