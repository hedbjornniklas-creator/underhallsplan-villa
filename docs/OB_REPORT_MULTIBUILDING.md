# Flera byggnader i utlåtandet

Beslut 2026-09-27 efter granskning av det första utlåtandet med Garage.

## Ny rapportlayout (layoutVersion 2)

- Extrabyggnader redovisas efter huvudbyggnadens besiktningsdel, före Bilaga 1.
  Rubrik och innehållsförteckning använder byggnadens namn, utan bilagenummer.
- Byggnadsbild och eventuell omfattningstext är en introduktion, inte en
  besiktningsnotering. Tom introduktion får ingen automatisk `--`-bedömning.
- Rubriker följer med efterföljande innehåll. Notering, risk, FTU och bilder
  hålls ihop när gruppen ryms på en sida. Längre grupper kan fortsätta på flera
  sidor med byggnads-/platsrubrik; inga texter eller bilder utelämnas.
- Frivillig hemsida finns i ÖB:s profilinställningar. Tomt fält utelämnas i
  nya utlåtanden. Hemsidan kopieras till rapportsnapshoten.

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
