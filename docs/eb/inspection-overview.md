# EB: besiktningsöversikt och arbetsstatus

Beslut 2026-10-15: EB:s startsida utgår från varje besiktning. Entreprenaden
samlar avtal, parter och historik; fastighetskopplingen finns kvar. Denna etapp
ändrar inte det gemensamma fastighetsregistret.

## Arbetsvy

- En rad per besiktning med typ/nummer, datum, adress, entreprenad och beställare.
- Pågående är standard och visar öppna besiktningar samt kvarstående
  leveransuppgifter. Klara visar avslutade besiktningar utan leveransproblem;
  Alla visar båda. Arkiverat/avbokat visas endast när det väljs uttryckligen.
- Sökning, sortering och sidbläddring följer ÖB/TU:s tabell- och mobillayout.
- Ny besiktning läggs i befintlig entreprenad eller en ny. En sparad entreprenad
  återanvänds om skapandet av besiktningen behöver försökas igen.
- Entreprenader utan besiktning kan återupptas från en separat hopfälld lista.
- Länkar öppnar besiktning, utlåtande eller entreprenadens avtal/historik.
  Leveransdialogen hanterar klarmarkering, leverans och upplåsning.

## Gemensamma regler

`src/lib/eb/inspectionLifecycle.ts` används av EB-översikten, entreprenadens
besiktningslista och den gemensamma dashboarden.

- Klarmarkera och lås utlåtandet sätter arbetet till klart. Godkänd/ej godkänd/
  avbruten är ett separat besiktningsbeslut, inte arbetsstatus.
- Upplåsning med anledning återför arbetet till pågående/under ändring.
  Tidigare publicerade versioner ligger kvar och blir inte redigerbara.
- Äldre completed utan lås återöppnas bara med belägg från organisationens
  upplåsningshistorik. Ett tomt låsfält räcker inte.
- Klara, levererade besiktningar lämnar dashboardens arbetslista. Utebliven
  leverans, misslyckat utskick och PDF-fel ger i stället en konkret leveransuppgift.
- Ett pågående utskick eller automatiskt PDF-arbete är en separat leveransstatus.
- Upplåst rapportarbete och leveransuppgifter skapar inga nya kalenderbesök.
- Dashboardens aktiva räknare räknar öppna besiktningar. Leveransuppgifter och
  entreprenader som väntar på sin första besiktning visas som nästa steg men
  ökar inte antalet öppna besiktningar.
- En entreprenad märkt completed döljer inte en senare, öppen efterbesiktning.
  En arkiverad/avbokad entreprenad kan inte väljas för att skapa nytt arbete.
- Kundens digitala åtgärdsuppföljning ändrar inte besiktningens arbetsstatus.

Leveransstatus gäller den aktuella publicerade versionen och senaste försöket
per mottagare. Ett lyckat mejl döljer inte ett misslyckat utskick till en annan
mottagare. Ett tidigare utskick räknas inte som leverans av en ny låst revision.

## Databas och publicering

Kör `docs/db/2026-10-15_01_eb_inspection_lifecycle.sql` före publicering. Den
ersätter upplåsningsfunktionen och återställer arbetsstatus i samma transaktion
som låset tas bort och historiken skrivs. Äldre upplåsta EB-besiktningar rättas
endast när upplåsningshistorik finns. Publicerade länkar och befintliga
funktionsbehörigheter bevaras. Kör inte äldre upplåsnings-SQL efter denna fil.

## Verifiering

```powershell
node --experimental-strip-types --test test/eb-overview.test.ts test/eb-inspection-lifecycle.test.ts test/eb-inspection-lifecycle-sql.test.ts test/dashboard-model.test.ts test/dashboard-server.test.ts
node scripts/preview-eb-overview.mjs --test
```

Förhandsvisningen använder syntetiska uppgifter och lokala API-svar. Den skickar
inga riktiga mejl och skriver inte till produktionen.
