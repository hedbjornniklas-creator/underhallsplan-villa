# Ny TU-utredning med samma uppgifter

## Beslut 2026-10-16

Funktionen gäller endast TU. ÖB och EB ändras inte.

Från TU-översikten, Alla utredningar eller en öppen utredning kan användaren välja
**Ny utredning med samma uppgifter**. Åtgärden öppnar det befintliga
skapandeformuläret med sparade kund-, kontakt-, faktura- och objektuppgifter.
Att öppna formuläret skapar eller skickar ingenting.

- Datum och tid är tomma. Omfattning och pris kräver aktiva val för återanvändning.
- En aktiv rapportmall föreslås från ursprunget. Om mallen inte längre är aktiv
  måste en annan väljas. Den aktuella mallversionen används vid skapandet.
- Användaren kan skapa en direkt utredning eller ett nytt utkast till
  uppdragsbekräftelse. Kopieringsflödet erbjuder inget direktutskick.
- Vid ny uppdragsbekräftelse föreslås den befintliga aktiva kundkopplingen med
  aktuell kundversion endast om kontakt- och fakturauppgifterna matchar källan.
  Avvikande eller ändrade kunduppgifter kräver ett nytt uttryckligt kundval,
  eftersom kundkopplingen annars ersätter dem med kundregistrets uppgifter.
- Direkt skapande använder TU:s befintliga fristående kunduppgifter, utan att
  skapa eller ändra någon post i kundregistret.
- Objektuppgifterna sparas på en ny objektpost enligt TU:s befintliga skapande.
  Delning av en muterbar objektpost skulle annars kunna ändra äldre utredningar.
- Observationer, mätningar, bilder, dokument, AI-resultat, rapporttexter,
  signaturer, godkännanden, datum, arbetsnummer och kundlänkar kopieras inte.
- Det tidigare uppdraget ändras, avbryts eller låses inte upp. Även låsta
  utredningar kan användas som källa. Funktionen **Skapa ny version** används inte.

Källan läses endast efter TU-behörighetskontroll i den valda organisationen.
Kopieringen använder en separat skrivskyddad läsning, inte rapportläsaren som
kan fylla i ett saknat arbetsnummer. En uttrycklig lista begränsar vilka fält som
får lämna källan. Inga nya databaskolumner eller SQL-migreringar behövs.

## Verifiering

- `node --experimental-strip-types --test test/tu-copy-investigation.test.ts`
- `node scripts/preview-tu-overview.mjs --test-copy`
- `npm run test:tu`

Webbläsartesterna använder endast syntetiska uppgifter och simulerade skrivningar.
Ingen verklig utredning eller kund ändras under testerna.

## Publiceringskontroll 2026-10-16

De 19 berörda filerna har överförts till en separat publiceringsgren ovanpå
`bbe5db21`. Befintliga statusmenyer och flödet för start före godkännande behålls.
TU:s listlänkar har egna pekytor eftersom den delade ÖB-stilen har ändrats.

- 129 ordinarie TU-tester och 30 kopierings-/kundkopplingstester passerar.
- Full TypeScript-kontroll, riktad ESLint och produktionsbygge passerar.
- Kopieringsflödet är testat på mobil och dator; översikten i sju skärmstorlekar.
- Inga SQL-filer, beroenden, ÖB-/EB-filer eller parallella ändringar ingår.
