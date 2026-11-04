# Gemensamma arbetsuppgifter i Projektarbete och Avtal

Senaste beslutet nedan (2026-11-03) ersatter den tidigare separata hanteringen av
offertpriser. Gamla utkast och lasta dokument kopplas inte om automatiskt.

## Beslutsandring 2026-11-03: Prisvillkor I Kalkyl Och Offert Som Sammanstallning

Anvandaren har godkant ett enklare arbetsflode. Detta ersatter beslutet nedan
om en egen Kundpris-flik och dubbla prisredigerare. Inga befintliga priser,
omfattningar, kalkylrader eller frysta dokument far skrivas om vid installation.

- Projektarbete har Omfattning och Kalkyl. Under kalkylen ligger Sa debiteras
  kunden med gemensam eller separat prisform for arbete/material, fasta belopp,
  lopande prisgrunder och planeringsbudget. Befintlig kanonisk lagring ateranvands.
- Anvand kalkylens belopp ar ett uttryckligt val. Det tar kalkylens beraknade
  kundpris med paslag, inte intern kostnad. Att oppna en panel eller andra
  intern kalkyl andrar aldrig ett redan sparat kundpris. Forsta aktiveringen
  granskas och sparas uttryckligen; senare villkorsandringar autosparas.
- Beloppsinmatning borjar exklusive moms. Den befintliga lagringen inklusive
  moms bevaras och raknas bara om vid faktisk inmatning. Byte av visningssatt
  sparar inget och avrundar inte om gamla belopp. Kalkylens momssats visas.
- Ofullstandig kalkyl, blandade momssatser och okand fordelning av klumpsumma,
  ovriga kostnader eller gruppofferter far inte bli ett automatiskt delpris.
  Noll ar fortfarande ett kant belopp. Timpris och paslag gissas inte fran
  interna kostnader. Anvandaren kan fortfarande ange kundvillkor manuellt.
- Offertens prisavsnitt laser dokumentets sparade prisvillkor och visar fasta
  delsummeringar, planeringsbudget och lopande prisgrunder var for sig. Det
  innehaller ingen separat prisform, budgetredigerare eller intern kalkyl.
  Redovisningsval och urval av omfattning/bilagor ar fortfarande dokumentets egna.
- Pennan vid ett offertmoment oppnar samma moments Kalkyl i Projektarbete.
  Den aktuella offertversionen behalls tills en ny gemensam revision ar sparad.
  Befintliga sparfel och osparade utkast far inte forsvinna vid navigering.
- Aldre fristaende klumpsummor, timuppskattningar och ungefarliga priser
  visas oforandrade. Overga till momentens prisvillkor ar ett separat,
  bekraftat val som inte fordelar gamla totalsummor eller timmar och inte
  omtolkar ungefarligt pris som budget. Saknade momentbelopp forblir tomma.
- Read-only patchen docs/db/2026-11-03_05_project_billing_candidates.sql gor
  aldre lopande budgetar med inaktiv totalbas synliga som granskningskandidater.
  Den andrar inga tabellrader, tidigare utkast eller lasta dokument. Fasta
  manuella totalsummor ger fortfarande ingen gissad kandidat per moment.
- Materialflytt mellan moment ar fortsatt pausad enligt anvandarens beslut.
  Ingen flyttfunktion, omklassificering eller produktionsandring ingar har.

Publiceringskontroll 2026-11-04: anvandaren har begart publicering. Den rena
releasekopians 883 Uppdragstester och produktionsbygge passerar. Klicktester
omfattar uttrycklig aktivering, noll/tomt belopp, autosparning, aterforsok efter
sparfel, separata prisformer, offertens penna, mobilvy och lasta moment. SQL _05
ar redan installerad i produktion: funktionskroppen matchar den granskade filen,
anon/authenticated saknar exekveringsratt och service_role behaller sin ratt.
Ingen SQL-skrivning behovdes vid denna publicering. Kontrollhashar har sparats
for Gashagas och Lokevagens arbetsdata, priser, utkast och frysta dokument.

## Beslutsandring 2026-11-03: Kundpris Per Moment I Projektarbete

Anvandaren har uttryckligen beslutat att prisform och kundprisvillkor ska anges
per moment i Projektarbete och anvandas av bade Offert och Avtal. Arbete och
material far ha olika prisformer. Intern kalkyl ar fortfarande separat.

- En egen flik Kundpris skiljer kundvillkor fran Omfattning och intern Kalkyl.
  Valen ar samlat pris eller separat arbete/material. Varje aktiv del kan ha
  fast pris, lopande rakning eller lopande rakning med planeringsbudget.
  Fasta belopp, timpriser och budget anges inklusive moms; sjalvkostnadspaslag
  anges exklusive moms och ar inte moms. Noll och tomt belopp ar olika saker.
- Kundvillkoren lagras en gang per projektmoment i action_case_customer_prices.
  Dokumentutkast har revisionerade projektioner av samma villkor. Projektionerna
  uppdateras atomart, medan redan skickade och frysta snapshots aldrig skrivs om.
  PDF och kundvisning anvander dokumentets sparade version, inte levande kalkyl.
- Befintliga skillnader maste granskas vid uttrycklig aktivering. Kandidater
  fran Offert och Avtal visas utan att valjas automatiskt. Intern kalkyl ar
  aldrig en kandidat. Manuella klumpsummor delas inte upp: byt uttryckligen till
  radbaserat pris i dokumentet och granska beloppen innan momentet kopplas.
  En befintlig gemensam timuppskattning maste ocksa hanteras uttryckligen; dess
  timmar eller timpris fordelas aldrig genom gissning pa de nya delpriserna.
- Efter aktivering autosparas redigering i Projektarbete. Prisformer och belopp
  for dessa moment ar skrivskyddade i Offert och Avtal. Dokumentets redovisningsval
  ar fortfarande separata. Ingen prisandring gor ett kundval till en bestallning.
- Projektlas, medlemskontroll, CAS-revisioner och idempotenta request-ID skyddar
  skrivningarna. Fel bevarar anvandarens inmatning. Aldre flikar far inte tappa
  nya prisvillkor. Lasta moment kan inte anta eller andra den gemensamma modellen.
  Ett helt last avtalsutkast hoppas over aven vid prisandring pa ett annat moment.
- Lokevagen 6, andra lasta avtal, signerade kopior och deras underlag far inte
  migreras eller synkas om. SQL-filen har ingen backfill och andrar inga utkast.

Driftsattning: kor docs/db/2026-11-03_03_project_customer_pricing.sql efter
budgetmigreringen 2026-11-03_01 och de tidigare arbetskopplingarna. Anvandaren
begarde publicering 2026-11-03. Produktionskontrollen visar att samtliga tio
funktionskroppar matchar den testade SQL-filen exakt; tabellerna ar tomma och
ingen befintlig prisinformation har konverterats. Den rena byggkopians 868
Uppdragstester och produktionsbygge passerar. Tidigare beslut nedan ar historik.

Uppfoljningen 2026-11-03_04_project_price_candidate_split.sql hindrar att en
samlad aldre budget kopieras till bada inaktiva delfalten. Byte till separata
prisformer kraver egna belopp, inte en gissad fordelning. Patchen skriver inte
om nagra prisvillkor eller dokument och kan koras igen.

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
