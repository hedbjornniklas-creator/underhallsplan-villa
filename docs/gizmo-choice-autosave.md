# Autosparning av Val och tillval

## Beslut 2026-10-19

Användaren godkände automatisk intern sparning efter att lokalt borttagna
kategorier återkom vid omladdning. Den tidigare redigeraren krävde en separat
manuell sparning även efter bekräftad borttagning.

- Kategorier, alternativ, egna kalkylrader och PDF-kopplingar autosparas.
- Textredigering sparas efter 700 ms paus. Bekräftad borttagning sparas direkt.
- Ångra återställer även kalkyl och PDF-kopplingar och sparar återställningen.
- Inga manuella sparknappar finns i listan eller alternativets högerpanel.
- Sparstatus har fast utrymme. Fel behåller den senaste lokala redigeringen
  och erbjuder ett uttryckligt återförsök. Sparat visas först efter bekräftelse.
- En seriell kö använder senast bekräftad revision. Ett gammalt svar får inte
  ersätta nyare text, en ångrad borttagning eller nyare kalkyl- och filuppgifter.
- Öppning av vyn skriver inget och omvandlar inte äldre kategorier i bakgrunden.
- Visa för beställaren kräver fortsatt granskning och ett separat kommando.
  Vid uttrycklig delning av äldre planering sparas först de granskade kategorierna.
  Autosparning delar inte nya texter, kundpriser eller PDF-filer med beställaren.
- Kundens registrering av alternativ ändras inte.
- Avtal, låsta versioner, avtals-PDF, offert och betalningsplan ändras inte.
- Befintligt customer-planning-API och befintlig revisionskontroll används.
  Ingen SQL-migrering krävs.

## Verifiering

Riktade kötester täcker sammanslagning av skrivningar, direkt borttagning,
ångra under pågående sparning, nyare text/kalkyl/PDF-kopplingar, sparfel,
återförsök, avmontering och avgränsning mot avtal och automatisk kunddelning.
UI-flöden provas med fiktiva uppgifter i den befintliga lokala Uppdrag-fixturen.

## Beslutslogg

- 2026-10-19: Manuell intern sparning ersätts med autosparning på användarens
  uttryckliga begäran. Separat kunddelning och avtalsisolering behålls.
