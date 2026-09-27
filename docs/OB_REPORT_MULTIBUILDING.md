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
