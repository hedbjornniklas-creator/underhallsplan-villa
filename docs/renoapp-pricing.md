# RenoApp - pris och betalning

Beslutat och slutligt bekräftat 2026-09-17.

## Erbjudande

- Föreningen betalar 1 500 kr exklusive moms per ärende när styrelsen väljer att starta handläggningen.
- Ingen abonnemangsavgift. Anslutning och mottagning av ansökningar kostar inget.
- Kompletteringar i samma ärende ingår.
- Start av handläggning är inte ett godkännande av renoveringen.
- Priset ska visas innan styrelsen väljer att starta handläggningen.
- Personlig rådgivning och sakkunnig granskning ingår inte. Det befintliga, separata granskningspriset ändras inte av detta beslut.

## Publiceringsytor

- `src/lib/renoapp/pricing.ts` samlar pristexten för HusHubs produktsida, intresseanmälan och BRF-villkor.
- `src/lib/publicCommercialContent.ts` aktiverar prisavsnittet enbart för RenoApp. BesiktApps prisinställning ändras inte.
- `src/lib/renoapp/brfTerms.ts` har villkorsversion 2026-09-17. Aktiveringssidan och den utskrivbara villkorssidan läser samma innehåll.
- Den separata marknadswebbplatsen i `C:/Users/hedbj/renoapp-site/site` visar priset på startsidan och anslutningssidan. Den har en separat Vercel-publicering och måste hållas i takt med HusHub.
- Mejlmallarna innehåller inget fast grundärendepris. Beställningsmejl för sakkunnig granskning använder fortsatt det separata granskningspriset.

## Implementation och historik

Ändringen uppdaterar prisinformation, inte debitering. Vid kodgranskningen hittades
ingen separat betalbeställning eller automatisk fakturering för grundärendet.
En visning, statussättning, inskickning eller komplettering ska inte användas som
en ny debiteringshändelse genom denna ändring.

Återstående arbete är ett uttryckligt beställningssteg med prisbekräftelse,
beständig registrering av avtalat pris och beställare, skydd mot dubbelbeställning
och underlag för fakturering. Detta kräver en separat implementation.

Tidigare accepterade villkorsversioner och historiska uppgifter ändras inte.
Äldre version 2026-09-06 angav 1 000 kr exklusive moms. Det nya priset får inte
tillämpas retroaktivt genom att skriva över sparade godkännanden eller beställningar.
Övergången för redan anslutna föreningar behöver hanteras uttryckligen inför debitering.

Ingen SQL-migrering behövs för prisinformationen. Inga mejl skickas och inga
fakturor skapas av denna kodändring.
