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
- EB behåller sin gröna accentfärg i knappar, länkar, filter, fokusmarkeringar
  och aktiva rader. Den gemensamma layouten ska inte ge EB ÖB:s blå färg.
- Ny besiktning läggs i befintlig entreprenad eller en ny. En sparad entreprenad
  återanvänds om skapandet av besiktningen behöver försökas igen.
- Entreprenader utan besiktning kan återupptas från en separat hopfälld lista.
- Länkar öppnar besiktning, utlåtande eller entreprenadens avtal/historik.
  Leveransdialogen hanterar klarmarkering, leverans och upplåsning.
- Beslut 2026-10-20: besiktningens namn är en direktlänk till besiktningen
  (arbetsvy när den är öppen, utlåtande när den är låst). Entreprenadens namn
  är en separat direktlänk till entreprenadsidan med avtal, parter och historik.
  Båda länkarna visas direkt även på mobil; projektvägen ska inte kräva att
  detaljraden först öppnas. Befintliga handlingsknappar finns kvar.

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

## Ny slutbesiktning från tidigare

Beslut 2026-10-19: efter en ej godkänd slutbesiktning ska besiktningsmannen
kunna skapa en separat ny slutbesiktning med den tidigare som arbetsmall.
Det är inte en upplåsning eller rättelse av det gamla utlåtandet.

- Välj **Ny slutbesiktning från tidigare** i den tidigare besiktningens rad
  eller i entreprenadens besiktningslista. Källan ska vara en låst, ej godkänd
  slutbesiktning i samma entreprenad och organisation. Det går även att välja
  återanvändning i dialogen för ny slutbesiktning.
- Objekt, avtal, beställare, entreprenörer och projektbilagor finns kvar i samma
  entreprenad. Besiktningens egna kontaktpersoner, relevanta redigerbara
  utlåtandetexter, fack och dokumentunderlag förs över till nya poster.
- **Ta med tidigare noteringar och bilder** är ett separat val. Punkterna blir
  vanliga redigerbara noteringar att gå igenom; ingen ny kontrollstatus eller
  särskild bekräftelse per punkt införs. De är en arbetsmall, inte ett automatiskt
  beslut om den nya besiktningen.
- Den nya besiktningen börjar som utkast och får egna datum/tider, faktisk
  närvaro, kallelse, beslut, tidsfrister, underskrift och publicering. Gamla
  godkännanden, utskicksstatusar, accepterade uppdragsbekräftelser och köpt
  åtgärdsuppföljning blir inte nya godkännanden eller beställningar.
- Bilder får egna filer och en bestående märkning om vilken tidigare besiktning
  de kommer från. Märkningen finns i redigeringsvyerna, digitalt utlåtande och
  PDF även om bildtexten ändras. Upprepad återanvändning behåller bildens
  ursprungliga källa.
- Noteringar, bildkopplingar och rubrikhänvisningar får nya identiteter. Det gamla
  utlåtandet, dess bilder och publika länkar ändras inte när den nya besiktningen
  skapas eller redigeras. Kopieringsfel ska rulla tillbaka den nya kopian.
- Kopian får en komplett arbetsmall för Granska vid första öppningen. De
  återanvända textavsnitten läggs över den nya mallen; de ersätter inte resten av
  mallen. Noteringarna ska därför visas både under Runda och i Granska.
- En redan skapad, olåst kopia med det tidigare felet (enbart återanvända
  textavsnitt och saknade sakavsnitt) kompletteras vid öppning. Endast saknade
  avsnitt läggs till. Befintliga texter, val, noteringar, rubriker och bilder
  behålls. Låsta utlåtanden och vanliga fullständiga arbetsmallar ändras inte.

Kör även `docs/db/2026-10-19_01_eb_inspection_reuse.sql` före användning av
återanvändningsfunktionen. Den lägger till ursprungsinformation för kopierade
noteringar och bilder; den ändrar inte gamla bedömningar eller utlåtanden.

Teknisk avgränsning: kopieringen sker i skapandebegäran med högst fyra
filkopieringar samtidigt och 300 sekunders tillåten körtid. Vanliga fel städar
målbesiktningen och dess filer efter att pågående filkopieringar har avslutats.
Ett hårt processavbrott kan inte köra denna städning. Det finns ännu inget
beständigt bakgrundsjobb eller en begärandenyckel som gör en ny begäran efter
ett förlorat svar idempotent; kontrollera då listan innan en ny kopia skapas.

## Noteringarnas nummer i arbetsvyerna

Granska och mobil Runda använder samma aktuella visningsnummer som utlåtandet.
Numret räknas från hela besiktningens ordning, före eventuell filtrering på fack.
Lista, redigeringsrubrik och raderingsfråga ska därför visa samma nummer även
direkt efter att en notering raderas eller flyttas. Noteringens sparade identitet,
äldre lagrade nummer och historiska bildmärkning ändras inte av visningen.

Befintliga noteringar i Granskas redigeringsruta autosparas efter en kort paus.
Spara och stäng sparar dessutom direkt och stänger redigeringen; Spara och skapa
ny sparar och öppnar en ny punkt. Krysset, klick utanför rutan och byte till en
annan punkt ska också slutföra sparningen innan redigeringen lämnas. En äldre
pågående autosparning ska slutföras före den senaste textens slutliga sparning.
Om sparningen misslyckas behålls rutan och texten så att användaren kan försöka
igen. En orörd tom ny notering kan stängas utan att skapa någon databaspost.
Stängning av hela webbläsaren kan inte invänta nätverket; varningen för osparat
innehåll är ett skydd, inte en garanti för att en sådan stängning sparar.

## Verifiering

```powershell
node --experimental-strip-types --test test/eb-overview.test.ts test/eb-overview-theme.test.ts test/eb-inspection-lifecycle.test.ts test/eb-inspection-lifecycle-sql.test.ts test/dashboard-model.test.ts test/dashboard-server.test.ts
node scripts/preview-eb-overview.mjs --test
node --experimental-strip-types --test test/eb-inspection-reuse.test.ts test/eb-inspection-reuse-sql.test.ts test/eb-inspection-reuse-display.test.ts test/eb-report-editing.test.ts
node --experimental-strip-types --test test/eb-note-editor-numbering.test.ts test/eb-note-editor-saving.test.ts
node scripts/test-eb-note-editor.mjs
node scripts/test-eb-inspection-reuse-display.mjs
```

Förhandsvisningen använder syntetiska uppgifter och lokala API-svar. Den skickar
inga riktiga mejl och skriver inte till produktionen.
