# Flera byggnader i utlåtandet

Beslut 2026-09-27 efter granskning av det första utlåtandet med Garage.

## Ny rapportlayout (layoutVersion 2)

- Extrabyggnader redovisas efter huvudbyggnadens besiktningsdel, före Bilaga 1.
  Rubrik och innehållsförteckning använder byggnadens namn, utan bilagenummer.
- Byggnadsbild och eventuell omfattningstext är en introduktion, inte en
  besiktningsnotering. Tom introduktion får ingen automatisk `--`-bedömning.
- Varje extrabyggnad börjar på en ny sida med byggnadens namn i en större
  blå rubrik (20 pt), blå skiljelinje och centrerad byggnadsbild utan ram.
  Formateringen lagras i rapportmallen; äldre mallar behåller sin tidigare
  mindre rubrik och bildplacering. Fortsättningssidor behåller diskret rubrik.
- Rubriker följer med efterföljande innehåll. Notering, risk, FTU och bilder
  hålls ihop när gruppen ryms på en sida. Längre grupper kan fortsätta på flera
  sidor med byggnads-/platsrubrik; inga texter eller bilder utelämnas.
- Frivillig hemsida finns i ÖB:s profilinställningar. Tomt fält utelämnas i
  nya utlåtanden. Hemsidan kopieras till rapportsnapshoten.
- Nya rapportmallar anger `coverImageFrame: false` på omslaget: ingen kantlinje
  eller grå bakgrund runt bilden. Storlek, centrering och bildproportioner
  behålls. Sparade mallar utan detta val behåller tidigare utseende, även om
  de redan använder `layoutVersion: 2`.

## Historik och avgränsning

Versionsmarkören ligger i den sparade rapportmallen (`reportSpec`). Saknad
markör betyder tidigare layout, inklusive tidigare bilageordning. Den nya
layouten väljs endast när en ny mall skapas för förhandsvisning/publicering.
Redan lagrade PDF:er, snapshots och besiktningsuppgifter skrivs inte om.
En hemsida som saknas i en fryst profil hämtas aldrig från dagens profil.

Våningsplanen lämnas oförändrade nu. Gemensam hantering av Plan 0 och negativa/
positiva plan i hela programmet är ett separat kvarstående arbete efter att
det aktuella utlåtandet är klart. Vinduppgifterna lämnas enligt användarens
beslut. Den överflödiga noteringen har användaren tagit bort själv.

## Digital kundvy

Kundlänken använder `ReportSnapshotView`, inte den paginerade PDF-komponenten.
Extrabyggnader ska visas även där, efter huvudbyggnaden och före bilagorna,
med egen rubrik, centrerad byggnadsbild, omfattning, förutsättningar och samtliga
noteringar, risktexter, FTU-texter och noteringsbilder.

Underlaget är endast `snapshot.reportData.mock.appendices.buildings`. Att
visa tidigare utelämnat, redan fryst innehåll är en visningsrättning: ingen
snapshot, lagrad PDF eller besiktning skrivs om. Saknas byggnader i en äldre
snapshot hämtas de inte från dagens besiktning eller bibliotek.

Regression: `node --experimental-strip-types --test test/report-snapshot-buildings.test.ts`
och `node scripts/test-report-snapshot-buildings.mjs`. Dessa testar den faktiska
kundkomponenten, inte bara PDF-komponenten i ett webbläsarfönster.

### Informationskontroll 2026-11-19

Möbleringen för huvudbyggnaden använder nu samma textanpassning i PDF-visaren
och den digitala visaren. Värdet hämtas ur publicerad `inspection_conditions`,
inte ur aktuell besiktning. Fullt/delvis möblerad, omöblerad och äldre fritext
testas. Extrabyggnadernas egna sparade möbleringsvärden behålls.

Den digitala visaren läser även rapportmallens sparade textkällor för uppdrag,
förutsättningar, muntliga uppgifter, besiktningsmannens medlemskap, upplysningarnas
förklaringar och bilagor. Frysta statiska texter och uttryckligt tomma fält ersätts
inte med dagens malltext. Generell FTU-information som redan ingår i den sparade
PDF-mallen visas också digitalt, för huvudbyggnad och extrabyggnader.

Granskade uppgifter:

- Objekt, uppdragsgivare, omfattning, datum/tid och närvarande: publicerat underlag.
- Besiktningsmannens namn, behörighet, certifiering och kontaktuppgifter: fryst profil.
- Handlingar, status, noteringar, ägarupplysningar och renoveringar: publicerat underlag.
- Väder, byggnadsdata och varje extrabyggnads information: respektive frysta byggnadsdel.
- Noteringar, risk, FTU och bilder: endast publicerade block; tomma texter fylls inte på.
- Mätvärden, kommentarer och signeringsuppgifter för tilläggsuppdrag: frysta bilagor.
- Statusbesiktning: behåller sina separata, redan frysta originaltexter.

Kvarstående historisk begränsning: äldre ÖB-mallar kan innehålla enbart ett ID
till en standardtext eller villkorsbilaga, inte en kopia av textversionen. Dessa
referenser läses fortfarande med befintlig mallhantering; den exakta historiska
ordalydelsen kan inte återskapas ur ID:t. Arkiverad PDF är originalet. Detta arbete
skriver inte om äldre snapshots för att fylla luckan. Bild- och logotypadresser
är frysta, men arbetet inför ingen ny versionslagring av de länkade bildfilerna.
Den digitala layouten är inte en sidtrogen PDF-kopia och återger inte alla
bolagsuppgifter från PDF-sidfoten. Inga nya företagsuppgifter hämtas i efterhand.

Regression: `test/report-digital-consistency.test.ts`, `test/report-furnishing-level.test.ts`
och befintliga snapshot-, status-, publicerings- och byggnadstester. Webbläsartestet
ovan kontrollerar även möblering och sparat uppdragsdatum vid 320–1600 px.
Ingen SQL, sparning av besiktningsdata eller omskapande av arkiverad PDF ingår.

### Word-exportens bildstorlek 2026-11-24

- Fotografier i Word-kopian kodas som JPEG med kvalitet 78, högst 1400 pixlar
  på längsta sidan och utan uppskalning. Telefonbilder roteras efter orientering.
  Genomskinliga bilder, SVG och lokala rapportlogotyper behåller PNG.
- Cirka 5 MB för hela Word-filen är ett riktmärke, inte en hård gräns.
  Många bilder får ge en större fil; inga bilder tas bort för att nå målet.
- Gränsen för inbäddade bildkopior är fortsatt 64 MiB. Originalfilerna får en
  separat total nedladdningsbudget på 256 MiB; varje källbild är fortfarande
  begränsad till 10 MiB och 40 miljoner pixlar. Högst 250 unika bilder och
  högst 64 MiB färdig Word-fil gäller fortfarande. Inga bilder utelämnas tyst.
- Tillåtna bildadresser, nekade omdirigeringar, timeout och befintliga
  behörighets- och versionskontroller behålls. Endast exportens minneskopior
  förändras. Inga bildfiler, besiktningsuppgifter eller snapshots skrivs om.
- Word-svaret strömmas i 64 KiB-block. Detta följer Vercels rekommendation för
  stora binära svar och undviker gränsen för buffrade funktionssvar:
  https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Ingen SQL, miljöändring eller ändring av PDF-arkivering behövs.

Regression: `test/word-image-compression.test.ts` och `test/ob-word-export.test.ts`
provar JPEG/PNG, transparens, orientering, oförändrade källbytes, separata
storleksgränser, rätt DOCX-medietyper samt exakta strömmade bytes över 4,5 MB.

Verifierat lokalt 2026-09-27: 30 regressionstester och TypeScript-kontroll
godkända. Kundvyn testad vid 375, 390, 768, 1280 och 1600 px, med flera
byggnader, öppning/stängning av noteringsbilder och äldre rapport utan
extrabyggnader. Skärmbilder på mobil och dator visuellt granskade. Rättningen
kräver ingen SQL och är ännu inte publicerad.

## SBR-avgränsning

SBR:s offentliga information beskriver rapportens innehåll men ger inget
uttryckligt besked om placering/rubrik för extrabyggnader. Mallarna kräver
medlemsinloggning. Placeringen ovan är därför ett produktbeslut, inte en
verifierad SBR-godkänd malländring. Villkorstexterna och deras ordning ändras
inte. Versionsraden i SBR-sidfoten ändras inte utan verifierat mallunderlag.

- https://sbr.se/overlatelsebesiktning-goda-rad/
- https://medlem.sbr.se/medlemsformaner/expertgruppernas-mallar/

## Driftsättning

Kör `docs/db/2026-09-27_01_profile_company_website.sql` före publicering.
Den lägger bara till en nullable profilkolumn och kolumnspecifika rättigheter;
befintlig RLS gäller. Om kolumnen saknas fungerar rapporten fortfarande utan
hemsida och inställningsfältet är inte aktiverat.

Användaren bekräftade 2026-09-27 att SQL-filen är körd. En efterföljande
skrivskyddad API-kontroll i produktionsprojektet verifierade att kolumnen
`company_website` kan läsas (utan att hämta profilrader). Ingen profil eller
historisk rapport ändrades vid kontrollen.

Verifiering: `test/report-building-layout.test.ts`, `test/report-pagination.test.ts`
och `node scripts/test-report-building-layout.mjs`. Webbläsartestet använder
syntetiska uppgifter, riktiga rapportkomponenter och lokala standardtexter.

### Publicerat 2026-09-27

- Avgränsad release: `bc92d06883cb867c1202866047d2e277f0825597`, baserad på
  dåvarande `origin/main` (`0350f5c637efd72a12a8c3facab3eb1d78525524`).
  Endast de 19 rapport-/profilfilerna ingår; övrigt lokalt arbete är orört.
- 78 regressionstester och webbläsartesterna godkända i releasekopian.
  Optimerat Next-bygge, TypeScript och samtliga 62 statiska sidor godkända.
  Lokal byggverifiering använde stagingkonfiguration, inte produktionsnycklar.
- Vercel visar Ready i Production, med rätt commit och domänen `hushub.se`:
  https://vercel.com/niklas-projects-65efdd50/underhallsplan-villa/B2eBg4n51x3somn8DoHMzMzjj73r
- Inloggad, skrivskyddad kontroll på hushub.se visar `Hemsida (valfritt)`.
  Inga profilfält ändrades vid kontrollen.
- Den aktuella tvåbyggnadsbesiktningens liveförhandsgranskning lästes utan
  utskick eller arkivering. PDF-läget har 34 sidor: Garage börjar på sida 21,
  Bilaga 1 på sida 27. Samtliga bilder laddas; inga överhöga A4-sidor eller
  ensamma avsnittsrubriker hittades i den färdigberäknade layouten.
- Den tidigare tillhandahållna kundlänken och dess lagrade PDF svarar HTTP 200.
  PDF:ens 19 960 502 byte är identiska före/efter publicering (SHA-256
  `2a748b7aaef26cdeb0451a22d41f14b974ba3e6bf56ce5a5a6a0b68355bd9839`).
  Ingen historisk PDF återskapades och inga kundmejl skickades.
