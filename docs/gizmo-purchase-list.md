# Bestallningslista fran projektkalkylen

## Beslut 2026-10-22

Bestallningslistan ar en ren utskriftsfunktion. Den sparar ingen PDF, historik
eller bestallning och skickar ingenting till leverantoren. Inga SQL-andringar
eller nya API-anrop behovs.

## Flode

1. Oppna Projektarbete, en atgard och Kalkyl.
2. Valj Fler verktyg, Markera rader och markera produkter.
3. Valj Bestallningslista. Endast markerade materialrader tas med.
4. Granska och justera listans egna produkttexter, artikelnummer, mangder,
   enheter och noteringar. Ange valfria leveransuppgifter och referens.
5. Valj Skriv ut. Webblasarens vanliga utskrift anvands.

Listan ar prisfri som standard. Anvandaren kan visa inkopspriser per enhet
exklusive moms. Kundpris, prispaslag, interna anteckningar och kallankar
kopieras aldrig till utskriften. Priser for offerttackta rader antas inte.
Byte av enhet tommer listans enhetspris for att undvika felaktiga paketpriser.

Tom mangd eller tomt inkopspris ger en varning men lamnas tomt i utskriften.
Ett angivet nollpris ar kant och visas. Ogiltiga tal, tom produkt eller tom
enhet maste korrigeras fore utskrift. Andrade listuppgifter kraver bekraftelse
innan listan stangs och kastas.

## Avgransning

Listan skapas som en tillfallig, fristaende kopia i klienten. Komponenten far
inga callback-funktioner for att spara kalkyl eller avtal. Utskriften sker i ett
isolerat dokument med egen CSS, A4-layout och upprepade tabellrubriker, utan
att sidans andra utskriftsmallar andras. Utskriftsramen tas bort efter utskrift
eller nar nasta utskrift oppnas.

Kalkylens mangder, priser, Klar-markeringar och offertkopplingar andras inte.
Avtal, avtals-PDF, betalningsplan, delning och leverantorsutskick berors inte.

## Tester

- Domantester for separat kopia, materialurval, nollpris, tomma uppgifter,
  decimaler, valfria inkopspriser och HTML-escaping.
- Komponenttester for urval, enhetsbyte, borttagning, Escape och utskriftsfel.
- Fiktiv klicktest: `scripts/test-customer-offer-ui.mjs --serve
  --project-overview --purchase-list`. `purchase-print-test=1` visar det
  verkliga utskriftsdokumentet utan att oppna operativsystemets skrivardialog.
- Integritetskontrollen i testprojektet ska visa oforandrat avtal och inga
  skrivningar efter granskning och utskrift.
