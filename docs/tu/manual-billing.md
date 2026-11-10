# TU: manuell fakturamarkering

## Beslut 2026-11-10

- Fakturamarkeringen tillhör den tekniska utredningen, inte fastigheten eller
  uppdragsbekräftelsen. Den fungerar även för utredningar utan bekräftelse.
- En intern ruta **Fakturering – endast internt** visas i utredningens
  leveranssteg, nära åtgärderna för att skicka utlåtandet.
- **Fakturerad**, frivilligt fakturanummer samt vem/när följer samma upplägg
  som ÖB och EB. Ändringar sparas med revisionsskydd och historik.
- Avmarkering är möjlig och behåller fakturanumret tills användaren uttryckligen
  tömmer det. Detta är inte betalstatus och skapar eller skickar ingen faktura.
- Fakturering får ändras för ett låst utlåtande utan att rapporten, beslutet,
  leveranshistoriken eller besiktningens faktiska arbetsstatus ändras.

## Listan

- Endast fakturastatus visas, aldrig fakturanummer eller ändrarhistorik.
- **Aktuella** inkluderar färdiga men ofakturerade utredningar. För att en
  utredning ska ingå i **Avslutade** krävs både färdig/låst utredning och
  bekräftad fakturamarkering. Pågående arbete förblir aktuellt även om fakturerat.
- **Att fakturera** visar färdiga, bekräftat ofakturerade utredningar. Uppdrag
  utan utredning ingår inte. Filtret fungerar oberoende av **Kräver åtgärd**.
- Urval och antal räknas på hela den inlästa listan före sidindelning.
- Okänd/otillgänglig fakturastatus antas aldrig fakturerad eller ofakturerad.
  Färdiga utredningar med okänd status ligger kvar i Aktuella och räknas separat
  i en varning under Att fakturera.
- Befintlig hantering av arkiverade/avbokade uppdragsbekräftelser bevaras.
  Den gemensamma dashboardens verkliga arbetsstatus och kalender påverkas inte.

## Åtkomst och införande

Följ TU:s befintliga organisations- och modulåtkomst, med uttryckligt vald
organisation även för faktureringsanrop. Ingen ny ägar-/kollegabegränsning införs.
Data lagras i separata interna tabeller och sparas atomärt med användare,
tidpunkt och revisionskontroll. Kundens rapportlänk, PDF och frysta rapporter
innehåller aldrig fakturamarkeringen eller dess privata metadata.

Kör `docs/db/2026-11-10_01_tu_investigation_billing.sql` före publicering.
Innan databasstödet finns ska fakturering vara otillgänglig, inte antas ha ett
värde. Ingen befintlig utredning markeras automatiskt fakturerad utifrån att
utlåtandet har skickats eller låsts.
