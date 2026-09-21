# Klarlagganden i RenoApp

## Omfattning

Pilot for kommunfragan med nyckeln
`har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan`.
Alternativets maskinnyckel ar `needs_investigation`. Detta ar inte en generell
tolkning av fritext, ett nytt krav pa alla ansokningar eller en ny arendestatus.

1. Sokanden kan valja "Jag behover undersoka detta" och skicka grundansokan.
2. En separat klarlaggandepunkt skapas med ursprungligt svar och fragerubrik.
   Ingen kompletteringsbegaran skickas automatiskt.
3. Styrelsen valjer "Ta med i kompletteringsbegaran". Valet bakgrundssparas med
   den befintliga serialiserade sparko-modellen. Fel visas och blockerar utskick.
4. Skicka komplettering fryser fraga, svarsalternativ och revision tillsammans
   med samma omgangs handlingar och foretagsuppgifter. Det befintliga mejlet och
   den personliga lanken ateranvands. Senare val andrar inte skickat innehall.
5. Sokanden far separata falt for bara de begarda fragorna. Utkast sparas i
   omgangen; grundansokans svar forandras inte av autosparande.
6. Vid inskickning sparas svaret atomart med kompletteringen. Ett bestamt svar
   ger `answered`, fortsatt utredning ger `pending` och kraver en forklaring.
   Ovriga grunduppgifter, svar och tidigare filer ligger kvar.
7. Styrelsen kan bedoma inkommet svar som klarlagt (`resolved`) eller fragan som
   inte relevant (`not_relevant`), med motivering. Oppna punkter visas sakligt
   men blockerar inget beslut. Godkannande, villkorat godkannande och avslag
   kraver beslutsmotivering; villkorat godkannande kraver aven villkorstext.
   Beslut andrar inte klarlaggandets svar, status eller bedomningshistorik.
8. En ny begaran kan skickas i samma arende. Bedomningen kan ateroppnas med
   motivering innan arendet avslutats. En fraga i en oppen skickad omgang far
   inte slutbedomas innan sokanden svarat eller omgangen ersatts.

Underlagsforslagen beraknas av den befintliga motorn fran inskickade svar.
Ett nytt svar andrar inte en redan skickad underlagslista och skickar inga
nya krav automatiskt. Saknade dokument blockerar fortfarande inte inskickning;
begarda foretagsbekraftelser och klarlaggandesvar kontrolleras daremot.

## Data och sakerhet

- `renoapp_case_clarifications`: ursprung, aktuellt svar, bedomning och revision.
- `renoapp_completion_requests.items`: fryst begaran med svarsalternativ.
- `renoapp_completion_requests.draft.clarificationAnswers`: privata utkast.
- Den fullstandiga interna meddelandeloggen sparar tidigare svar, nytt svar,
  omgang och motiveringar. Interna sparhandelser laggs inte till bland skickade
  meddelanden i den befintliga historikvyn.
- Endast serverns service-roll far anropa funktionerna/lasa klarlaggandetabellen.
  Servern kontrollerar BRF-behorighet respektive personligt token innan atkomst.
- Samma arendes rad lases for publicering, komplettering och bedomning. Gamla
  omgangar, fel revision, aterkallade lankar och obehoriga frageandringar nekas.
- Pilotansokan sparas som utkast tills svaren ar sparade. Overgangen till
  inskickad skapar klarlaggandet i samma transaktion, innan godkannande ar mojligt.
- Vid denna overgang sparas aven godkannandet av renoveringsreglerna i samma
  skrivning som statusen. Utkastsparande registrerar fortfarande inget
  godkannande. Regelversionen kontrolleras av databasens befintliga trigger.
  Rattingen 2026-09-19 kraver ingen ny SQL-migration.

## Driftsattning

Ingenting har automatiskt korts i produktion genom denna kodandring.

### Andrat beslutsansvar 2026-09-21

Kor `docs/db/2026-09-21_01_renoapp_board_decision_authority.sql` efter den
befintliga klarlaggandemigrationen och fore publicering av den uppdaterade koden.
Den ersatter godkannandesparren men behaller registreringen av osakra svar vid
inskickning. Inga befintliga svar, beslut eller bedomningar andras. Utkast far
inte godkannas eller avslas. Beslutsmotivering valideras i granssnitt och server
for nya beslut; tidigare beslut utan motivering ligger kvar oforandrade.
Kontrollpunkterna i styrelsens beslutsvy visas neutralt och i alfabetisk ordning,
utan filtrering eller fargkodning efter allvarlighetsgrad. Befintliga katalogfalt
for risk/allvarlighetsgrad bevaras; detta ar ingen databasrensning.

Vid nyinstallation: kor grundstegen nedan och sedan migrationen 2026-09-21.
Kor inte om enbart den aldre grundmigrationen efterat, eftersom den skulle
aterinfora den tidigare beslutssparren.

### Grundinstallation

1. Verifiera backup och att tidigare migration for kompletteringsomgangar finns.
2. Kor hela `docs/db/2026-09-16_01_renoapp_clarifications.sql`.
   Den ar bakatkompatibel och aktiverar inget nytt svarsalternativ.
3. Publicera koden. Verifiera befintliga arenden och vanliga kompletteringar.
   Den nya koden kraver grundmigrationen aven nar inga klarlagganden finns.
4. Kor `docs/db/2026-09-16_02_renoapp_municipal_clarification_pilot.sql` forst
   efter verifierad koddeploy. Den lagger till ETT alternativ och uppdaterar
   kommunfragans hjalptext; befintliga Ja/Nej-alternativ och kopplingar andras inte.
5. Prova hela kedjan i en testforening med egen mottagaradress: osakert svar,
   begaran, komplettering, nytt underlagsforslag och uttrycklig bedomning.
   Verifiera verklig mejlleverans separat.

Kontrollera fragans nyckel, svarsalternativ och Ja-svarets befintliga kopplingar
fore aktivering. Pilotskriptet avbryter om den aktiva kommunfragan saknas.
Skripten kan koras igen utan dubbla alternativ. Befintliga fall migreras inte
till osakra svar och databasen rensas inte.

Vid paus: inaktivera pilotens nya svarsalternativ for nya ansokningar forst
nar inga oppna omgangar anvander det, eller ersatt dessa omgangar kontrollerat.
Behall kod och historik for redan skapade klarlagganden. Rulla inte tillbaka
till en version som saknar kompletteringsvyn medan sadana arenden finns.

## Tester

Svarens befintliga maskinnycklar ska bevaras vid sparande, inklusive understreck.
De far inte normaliseras som nya sluggar: `needs_investigation` ar inte samma
alternativ som `needs-investigation`. Regressionstestet `test/renoapp-answer-keys.test.ts`
kontrollerar bade utkast, inskickning och matchningen till sparade alternativ-ID:n.
Tidigare bortfallna svar aterstalls inte automatiskt av kodrattingen. Berorda
arenden maste granskas separat; saknade svar far inte gissas eller massifyllas.

```sh
node --experimental-strip-types --test test/renoapp-clarifications.test.ts test/renoapp-completion.test.ts test/renoapp-completion-api.test.ts
node scripts/test-renoapp-clarifications-ui.mjs
node scripts/test-renoapp-completion-ui.mjs
npx tsc --noEmit --incremental false
```

Databastester kor Postgres i PGlite. API- och webblasartester anvander isolerade
testdata utan produktionsdatabas eller mejlleverans. Bilder hamnar under
`tmp/renoapp-clarifications-ui/`. `--serve` startar en lokal visning med testdata.
