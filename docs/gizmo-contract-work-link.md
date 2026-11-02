# Gemensamma arbetsuppgifter i Projektarbete och Avtal

## Beslut 2026-10-29

- Lankade moment delar rubrik, omfattning, forutsattningar, undantag, avradan
  och avtalat kundpris innan avtalet lases. Offert och Val och tillval ar separata.
- Avtalat kundpris lagras i avtalsutkastets prisvillkor och visas aven i
  Projektarbete. Intern kalkyl ar inte ett avtalat pris och skrivs inte dit automatiskt.
- Kopplingen anvander momentets ID, aldrig en gissning utifran rubriken.
  Manuella avtalsrader utan kallkoppling forblir fristaende.
- Lasningen galler redan vid Las for signering, inte forst efter underskrift.
  Lankade projektmoment, deras kalkyl och underlag far da inte andras eller raderas.
  Lasningen skyddas i databasen aven for aldre flikar och direkta skrivningar.
- Lasning skapar en idempotent intern uppgift att registrera underskriven PDF.
  Ansvarig ar aktiv projektansvarig, annars den som laser. Ingen extern delning
  eller e-post till bestallaren sker automatiskt. Registrerad kopia avslutar uppgiften.
  Uppgiften foljs initialt upp efter sju dagar. For aldre versioner med inaktiv
  projektansvarig och lasare valjs en aktiv administrator/medarbetare i samma
  organisation. Saknas aktiva personer skapas ingen otillganglig uppgift.
- Ett nytt utkast far bara skapas efter uttrycklig bekraftelse att versionen inte
  har undertecknats. Registrerad signerad kopia tillater inte upplasning.
- Befintliga frysta avtal, PDF-filer och bilagor skrivs aldrig om. Migreringen
  synkar inte gamla olikheter. Lokevagen 6 ska behalla sin lasta version exakt.
  Befintliga avvikelser visas for granskning, utan automatisk rattning.
- Fragor, lasning och fristaende utskrifter far fortfarande anvandas pa lasta moment.

## Avgransning

Detta ersatter det tidigare beslutet om helt oberoende kopior enbart for uttryckligt
lankade arbetsuppgifter. Parter, avtalsvillkor, betalningsplan och tidsplan behaller
sina befintliga granssnitt. Inga val blir bestallningar eller ATA automatiskt.

## Driftsattning

SQL ska granskas och koras av anvandaren fore publicering. Ingen produktionsdata
eller signerad handling far andras som del av utvecklingens tester.

Kor i denna ordning:

1. `docs/db/2026-10-29_01_contract_work_link.sql`
2. `docs/db/2026-10-29_02_contract_signed_copy_task.sql`

Den andra filen skapar aven en uppgift for befintliga aktiva lasta versioner som
saknar signerad kopia, inklusive Lokevagen. Ingen av filerna skriver om deras
avtalsinnehall eller arbetsrader. Bada filerna kan koras igen utan dubbla uppgifter.

## Implementerat

- Gemensamt kundpris har en enda lagringsplats i avtalsutkastets prisvillkor.
  Projektarbete redigerar det med avtalsrevision, separat fran intern kalkyl.
  Vid lopande pris eller manuell total hanvisas till avtalets prisvillkor i stallet
  for att hitta pa ett pris per moment.
- Databastriggers uppdaterar andrade kundfalt atomart i bada riktningarna och
  skyddar moment, kalkylrader, arbetsdelar, offerter, paketpriser och valda filer.
  Case-laset serialiserar skrivningar mot frysning; gamla revisioner avvisas.
- Projektvyn uppdaterar avtalskopplingen efter avtalsandringar. Avtalsredigeraren
  laser in en nyare projektandring endast nar inget osparat utkast finns.
- Signerad kopia laddas upp med den befintliga skyddade PDF-funktionen under
  Avtal. Uppgiften avslutas i samma databastransaktion som registreringen.
  Ingen signerad PDF kopieras till uppgiftens bilagor eller delas automatiskt.

## Verifiering

`test/action-cases-contract-work-db.test.mjs` provar de verkliga migreringarna
med PGlite och Uppdrags tabellvillkor: dubbelriktad synkning, prisuppdelning,
noll/tomma priser, gamla revisioner, organisationsgranser, lasning, vald fil,
osignerad ateroppning, uppgift och idempotens. Ett fryst aldre avtal med avvikande
arbetsdata jamfors falt for falt och maste vara exakt oforandrat efter migrering.

`test/action-cases-contract-work.test.mjs` och kalkylpanelens tester kontrollerar
API-sparrarna, att kalkylpris aldrig ersatter kundpris och att lasning fortfarande
tillater materialmarkering och bestallningsutskrift. UI-testserverns flagga
`--contract-work --contract-signing --cost-table` anvander endast fiktiva data.

## Beslutsandring 2026-11-02: Offert Delar Momentens Omfattning

Anvandaren har uttryckligen andrat gransdragningen: aven Offert ska anvanda samma
rubrik, omfattning, forutsattningar, undantag och avradan for kallkopplade moment
innan de lases. Detta ersatter endast tidigare beslut om separat offertomfattning.
Offertens priser, prisvillkor, interna kalkyl, parter och bilagor forblir separata.
Val och tillval och tidsplanen ingar inte i denna koppling.

- Databasen synkar endast andrade arbetsfalt via momentets ID. En rubriklikhet
  skapar aldrig en koppling. Manuella rader och gamla tillvals/option-rader ar
  fristaende; en offert kan aven anvandas innan ett avtalsutkast finns.
- Inga befintliga skillnader skrivs over nar SQL-filen kors eller ett gammalt
  utkast oppnas. Prisredigering far inte tyst aterfora en gammal omfattning.
- Ett uttryckligen tomt textfalt delas som tomt. Aldre klienter som inte skickar
  valfria falt far inte ta bort sparade forutsattningar, undantag eller avradan.
- Kopplade offertfalt blir skrivskyddade nar momentet ingar i en last version.
  Databasen skyddar detta aven mot gamla flikar. Att ta bort en offertreferens
  raderar inte momentet, och andra offertuppgifter andrar aldrig den lasta versionen.
- Synkning sker i samma transaktion med projektlas och versionskontroller.
  Ett offertanrop far bara flytta sin revision en gang, inte via en trigger-eko.
- Projektvyn laser om arbetsunderlaget efter sparade offerttexter. Offerten laser
  in ny gemensam omfattning endast nar eget utkast ar sparat. En misslyckad
  hamtning visas med aterforsok; text som tillkommer under en hamtning behalls.

Kor `docs/db/2026-11-02_02_offer_work_scope_link.sql` efter den tidigare
avtalskopplingen och fore publicering. Filen ar additiv och kan koras igen.
Anvandaren bekraftade 2026-11-02 att filen ar kord. Lasande produktionskontroll
bekraftar exakta funktionskroppar, tre aktiva triggers och service-only anrop.

Utvidgade PGlite-tester provar de verkliga skrivfunktionerna, UPSERT, tomma och
uteblivna falt, revisionskonflikter, trevagssynkning och exakta frysta dokument.
Komponenttesterna provar saker hamtning och skrivskydd. Klicktestserverns
`--contract-work --independent-contract --shared-work-scope --serve` anvander
bara fiktiva uppgifter. Den ersatter inte databasens transaktionstester.

Den rena verifieringskopians 787 avgransade tester och produktionsbygge passerar.
Klicktestet bekraftar text i alla tre vyerna efter andring fran Offert,
Projektarbete respektive Avtal. Inga produktionsuppgifter har redigerats.
Den nya bekraftelsen for att ersatta ett misslyckat offertutkast anvander en
synlig ruta i sidan i stallet for window.confirm. Komponenttesterna provar
avbryt, bekrafta och lasfel. Uppfoljande klicktest 2026-11-02 bekraftar att den
gamla testfliken ar stangd, Avbryt behaller den lokala texten och Ersatt med
sparad offert aterlaser forst efter det uttryckliga valet. Testfliken och den
lokala servern har stangts. Ingen riktig projektflik har berorts och publicering
ar godkand av anvandaren. Lokevagens sparade projekt, arbetsrader, avtal,
dokument och kundplanering ar oforandrade efter SQL-installationen. Den nya
tidsplanen byggs separat efter detta publiceringspaket.
