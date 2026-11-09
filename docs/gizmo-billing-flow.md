# Gizmo: faktureringsflöde

## Status

Releaseunderlag 2026-11-09. SQL-filen
`docs/db/2026-11-09_02_project_billing_flow.sql` måste köras före publicering.
Den kräver projektavslut och projektfördelning av leverantörsfakturor från
2026-11-07. Migrationen kan köras igen och fyller inte på befintliga projekt.

Detta ersätter inte Projektarbetes kalkyl eller någon prisredigerare.
Kundens överenskommelse och den interna kostnaden är olika uppgifter.
Att ett tillval finns, har ett pris eller är valt är inte en beställning.

## Beslutade grundregler

1. Faktiska manuella kostnader och arbetstimmar får registreras innan fakturan
   kommer. Ett uppskattat kostnadsbelopp är däremot inte ett faktiskt utfall.
   Underlag eller projektansvarigs motiverade undantag krävs före debitering.
2. Ett fakturaunderlag är inte en faktura. En verklig kundfaktura kan täcka flera
   underlag och delar av deras rader. Övrigt belopp på samma faktura visas separat.
   Ingen betalningsstatus registreras eller härleds.
3. Löpande arbete med planeringsbudget kräver dokumenterad avstämning vid 80 %
   förbrukning eller bedömt överskridande. Datum, deltagare, besked, underlag och
   återstående bedömning sparas. Budgeten höjs inte automatiskt.
4. Belopp beräknas konsekvent i heltalsöre. Påslag är inte moms; intern kostnad
   och debitering visas exklusive moms. Kundens sparade prisgrund är inklusive
   moms och omräknas med uttrycklig kundmomssats. Moms på nya underlag summeras
   per momssats. Ingen särskild funktion för öresdifferenser införs.

Fortnox används manuellt för att skapa fakturan och hantera dess slutliga
avrundning. Exakt beräkning eller inställning i användarens Fortnox-konto har
inte verifierats; den kontrollen blockerar enligt användarens besked inte denna
etapp. Äldre fakturaunderlags beräkningssätt ändras inte.

## Arbetsgång

Öppna **Betalning och fakturering → Fakturering**.

1. Under **Kostnader**, välj **Hämta överenskommelse**. Befintlig avtalsdel,
   betalplansrad eller ÄTA hämtas utan att skriva om dess pris. Ange vem som
   godkänt, datum och hänvisning till avtal/beställning/mejl samt kundmoms.
   Detta dokumenterar ett godkännande utanför Gizmo; det skapar inget digitalt
   godkännande och skickar inget meddelande.
2. För fast pris: **Gör avtalad del fakturerbar**, ange belopp och uppfyllt
   faktureringsvillkor. Tidigare poster räknas av från samma fasta pris.
   Interna kostnader för den fasta delen får registreras men ger inte extra
   kunddebitering.
3. För löpande arbete: **Lägg till kostnad**. Registrera faktisk kostnad eller
   arbetstid, alternativt välj en fördelad leverantörsfakturarad. Endast den
   aktuella projekt-/ÄTA-andelen används. Leverantörsfakturan ska vara granskad
   före kunddebitering. Kostnadsformuläret autosparar giltiga uppgifter.
4. **Granska och gör fakturerbart** använder den dokumenterade prisversionens
   timpris eller påslag. Det är ett uttryckligt steg, inte autosparning av ett
   godkännande. Saknat påslag eller timpris förblir okänt, aldrig automatiskt 0.
5. Under **Att fakturera**, markera poster och justera vid behov delbelopp.
   Skapa underlaget. Valda belopp reserveras atomiskt och kan inte användas i
   ett annat underlag samtidigt. Positiva och negativa poster hålls isär.
6. Under **Underlag och fakturor**, hämta PDF. Innehållet är fryst och visar
   kundbelopp, avsändare, fakturakund och projektnamn från underlaget, inte den
   interna kalkylen eller interna anteckningar. PDF:en bifogas fakturan som
   skapas separat i Fortnox.
7. **Registrera Fortnox-faktura**: ange verkligt nummer, datum och de faktiskt
   fakturerade delbeloppen. Samma faktura får flera underlag men inte dubbla
   registreringar för samma avsändare och fakturanummer inom projektet.
8. Efter kontroll av frågor, kostnader och rester: bekräfta faktureringsavstämning
   klar. Projektets befintliga avslutsflöde kräver fortfarande **Arbetet klart**,
   **Färdigfakturerat** och avslutade frågor. Databasen hindrar avslut om den nya
   faktureringsavstämningen är öppen. Ej registrerade beställningar kan inte
   antas vara fakturerade; projektansvarig gör slutavstämningen manuellt.

## Rättningar och tidigare fakturor

- En senare leverantörsfaktura kopplas till samma manuella kostnad med
  länkknappen. Skapa inte ett nytt inköp för samma händelse. Efter granskning
  beräknas endast skillnaden. Fakturerade belopp och gamla PDF:er behålls.
- Innan en ofakturerad kostnad rättas öppnas granskningen med ett skäl.
  Reserverade belopp måste först hanteras. **Makulera** frigör ett helt
  oanvänt underlag. **Frigör rest** återför endast ofakturerad rest till kön,
  även efter delfakturering. Underlagets innehåll skrivs inte om.
- Kredit registreras separat. Ett prisavdrag är inte en ny debiteringsrätt.
  Vid omfakturering spärras ersättningsposten tills den verkliga krediten har
  registrerats. Automatiska kostnadsrättningar och manuella krediter räknas
  tillsammans så att en kostnad inte överkrediteras.
- Kostnader som inte ska kunddebiteras och återstående debitering som avstås
  hanteras uttryckligen med skäl. De raderas inte ur historiken.
- Tidigare manuella underlag bevaras. När det nya flödet börjar användas blir
  gamla redigerare skrivskyddade även från äldre öppna flikar. Stäm av verkliga
  fakturor före nya debiteringar; gamla PDF:er tolkas inte som obetalda fakturor.
- **Registrera tidigare fastprisfaktura** räknar av redan fakturerade fasta delar
  utan att skapa en ny utskrifts-PDF eller ny debitering. Tidigare löpande
  debitering registreras via sina faktiska kostnader, underlag och det tidigare
  fakturanumret. Ett fritt ingångsbelopp för löpande arbete skulle annars kunna
  räknas dubbelt när fakturans kostnader läggs in senare och tillåts därför inte.
- En sen kostnad kan återöppna faktureringsavstämningen, inte avtalet eller den
  interna kalkylen. Projektstatus ändras inte automatiskt.

## Säkerhet och avgränsning

Endast projektansvarig kan ändra faktureringsregistret. API:t återanvänder
befintlig organisations-/modulbehörighet; RPC:erna kontrollerar medlemskap,
projektansvarig och organisation igen. Frågeantal som avser dolda frågor
lämnas inte ut till andra medarbetare. Inget nytt kundportalflöde införs.

Faktureringsregistret, dess händelser och leverantörskopplingar ligger i nya
serverprivata tabeller. Sparning använder förväntad version, källfingeravtryck
och exakt anropsidentitet. Osäkra svar kan återförsökas utan dubbla poster.
Misslyckade eller ofullständiga kostnadsutkast behålls lokalt per användare och
projekt. En verklig versionskonflikt ersätts aldrig genom tyst överskrivning.

Reserverade/fakturerade leverantörsrader skyddas även i det gamla API:t.
Finansiella källändringar stoppas; interna fakturaanteckningar tillåts. Den
befintliga leverantörssparningens tillfälliga identitetsnormalisering kontrolleras
vid transaktionens slut. Att importera en rad som tidigare använts i det gamla
flödet stoppas.

Låst avtalsversion prioriteras framför accepterad offert och levande kundpris.
Saknade frysta villkor fylls inte från senare kalkyl eller nytt utkast. Villkor
och fakturaregistreringar sparas som tillägg; historiska värden skrivs inte om.

Utanför etappen: Fortnox-integration, OCR, betalningsbevakning, automatisk
budgethöjning, automatisk kundavisering och ett nytt digitalt ÄTA-godkännande.

## Kontroller

- `node --experimental-strip-types --test test/action-cases-billing-flow*.test.mjs`
- `node scripts/preview-billing-flow.mjs --test`
- `node --experimental-strip-types scripts/preview-billing-flow-pdf.mjs`
- Regression: alla `action-cases-*.test.mjs` och `supplier-invoices-*.test.mjs`.

SQL testas i PGlite, inklusive omkörning, roll-/organisationsgränser, exakt
återförsök, versionskonflikt, oförändrade historiska dokument, leverantörsspärr
och det gamla faktura-API:ts tvåstegssparning. Klicktester använder en isolerad
fiktiv testvy och lokala testdata, aldrig riktiga projekt eller mejlutskick.

## Beslutslogg

- 2026-11-09: användaren godkände implementation enligt de fyra grundreglerna.
  Befintliga priser, kalkyler och låsta avtal får inte påverkas.
- 2026-11-09: avrundningsskillnader ska inte blockera bygget. Konsekvent vanlig
  avrundning räcker; ingen separat öresdifferensfunktion eller kontoåtkomst till
  Fortnox krävs för denna etapp.
- 2026-11-09: användaren bekräftade SQL och godkände publicering. Läsning av
  produktionsschemat verifierades före programuppdateringen; ingen automatisk
  aktivering eller omskrivning av befintliga projekt görs.

Detta dokument är en teknisk flödesbeskrivning, inte ett löfte om juridisk
bevisverkan. Kontrollerade kostnader är inte en fullständig slutkostnadsprognos.
