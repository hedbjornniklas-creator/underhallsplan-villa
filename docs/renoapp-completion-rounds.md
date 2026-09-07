# Kompletteringar i RenoApp

## Flode

1. Styrelsens underlagsval sparas som tidigare, men andrar inte en redan skickad begaran.
2. Vid Skicka registreras en separat kompletteringsomgang i samma arende. Endast saknade, begarda uppgifter och uttryckligt markerade rattelser ingar. Fritext kan anvandas for andra fortydliganden.
3. Sokanden far mejl till samma ansokan. En befintlig, ej aterkallad lank fornyas till 14 dagar; annars skapas en ny lank. Ingen ny ansokan skapas.
4. Tidigare handlingar och foretagsuppgifter finns kvar. Grundansokan ar last. Foretagsuppgifter och svar autosparas privat i kompletteringsomgangen. Uppladdade filer finns direkt i arendet.
5. Skicka komplettering kontrollerar bada foretagsbekraftelserna, sparar begarda foretagsuppgifter och svaret atomart och satter status till review (Att granska). Saknade dokument blockerar inte inskickning.
6. Fler kompletteringsomgangar kan skickas. Tidigare handlingar kan inte raderas under en ny omgang. Styrelsen kan oppna fler filer under respektive underlag och samtliga filer ingar i hamtningen.

## Drift

Kor hela `docs/db/2026-09-07_03_renoapp_completion_rounds.sql` i en transaktion innan applikationskoden driftsatts. Migreringen ar inte automatiskt kord i produktion.

Migreringen kravs aven for att lasa gamla arenden med den nya koden. Den bygger pa befintliga tabeller for arenden, meddelanden, underlagsval, deltagare, dokument och case_access_links.

Den senaste aldre kompletteringsbegaran per arende migreras. Aldre kod saknade versionering: exakt vilka val som gallde vid ett tidigare mejl kan inte aterstallas om de senare har andrats. Vid migrering anvands da sparade val. Leveransstatus for aldre mejl ar okand, inte bevisat misslyckad.

Ett nytt mejlfel visas i styrelsens arende med mojlighet till aterforsok. Aterforsok anvander samma begaran och mejlets idempotensnyckel, utan ny historikrad. `sent` betyder att leverantoren har accepterat mejlet, inte att mottagarens inkorg har bekraftat leverans. Ett redan accepterat mejl skickas inte igen genom ett dubbelklick. Studsar/skrapost hanteras inte av denna funktion.

En gammal flik med fel omgang eller sparrevision nekas och maste laddas om. Om en ny begaran ersatter en fortfarande oppen omgang foljer sparat svar och utkast for fortsatt begarda foretagsroller med. Uppgifter som slutade efterfragas ligger kvar i den gamla omgangen. Inga personliga lankar eller sokandens utkast exponeras i den publika listan.

## Verifiering

- `npm run test:renoapp-completion`: PostgreSQL-tester i PGlite samt API- och mejltester med mockade leverantorer. Inga riktiga mejl skickas.
- `node scripts/test-renoapp-completion-ui.mjs`: isolerade lokala browser-fixtures med de riktiga React-vyerna; dator, surfplatta, mobil, rattelseval, fler filer, foretagsuppgifter och sokandens autosparande. Anvand `CHROME_PATH` om Chrome finns pa annan sokvag. Skarmbilder sparas under `tmp/renoapp-completion-ui/`.
- `npx tsc --noEmit --incremental false`.

Efter driftsattning: prova med ett testarende och en egen testmottagare. Begar komplettering, komplettera, begar rattelse, oppna samma ansokan igen och kontrollera att tidigare innehall finns kvar. Andra ett styrelseval utan att skicka och kontrollera att sokandens begaran inte andras. Kontrollera mejlavisering och faktisk leverans separat.

## Jamforelse

Jira Service Management skiljer pa intern information och information som delas med kunden: https://support.atlassian.com/jira-service-management-cloud/docs/attach-files-and-screenshots-to-issues/

Clio samlar dokument och kommunikation i en aterkommande klientportal: https://help.clio.com/hc/en-us/articles/9156800144283-Clio-for-Clients-Client-Actions

Dessa principer har anvants som inspiration. RenoApps regler for kompletteringar och sparade omgangar ar anpassade till det befintliga BRF-flodet.
