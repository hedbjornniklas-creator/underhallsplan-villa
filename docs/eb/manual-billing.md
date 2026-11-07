# EB: manuell fakturamarkering

Beslut 2026-11-07: fakturamarkeringen tillhör respektive besiktning. Den ändras
inne på uppdraget via **Hantera → Fakturering**, inte direkt i EB-listan.

## Funktion

- Två markeringar: **Ej fakturerad** och **Fakturerad**. Ett saknat eller
  otillgängligt faktureringsunderlag får inte tolkas som Ej fakturerad.
- Ett frivilligt fakturanummer är separat från befintlig fakturareferens och
  fakturamottagare. Ingen faktura skapas, skickas eller markeras som betald.
- Markeringen sparas med datum, användare och historik. Avmarkering är möjlig;
  ett befintligt fakturanummer raderas endast när användaren uttryckligen tömmer det.
- Ändringar använder en revisionskontroll. En samtidig ändring ska ge konflikt,
  inte skriva över en annan användares senaste uppgift.
- Faktureringen kan ändras även för en låst besiktning, utan att låsa upp eller
  ändra utlåtandet, beslutet, arbetsstatusen eller leveranshistoriken.

## Översikten

- EB-listan visar endast fakturastatusen; den har ingen fakturakryssruta.
- **Pågående** visar öppna besiktningar samt kvarstående leverans och fakturering.
  En färdig men ej fakturerad besiktning ligger kvar här. **Klara** kräver både
  färdig besiktning och fakturamarkering, utan kvarstående leveransåtgärder.
  Saknad/otillgänglig fakturastatus räknas inte som fakturerad och ligger kvar
  bland Pågående tills statusen kan bekräftas.
- **Att fakturera** visar färdiga, ännu inte fakturamarkerade besiktningar.
  Detta är ett eget urval av bekräftat ofakturerade besiktningar.
- Om fakturastatus inte kan hämtas visas en varning för berörda klara
  besiktningar. De räknas inte som vare sig fakturerade eller bekräftat ofakturerade.
- Ofakturerade besiktningar återöppnas inte och påverkar inte den gemensamma
  dashboardens arbets-/leveransuppgifter.

Förtydligande 2026-11-07: faktureringen styr bara listans indelning Pågående/Klara,
inte besiktningens faktiska arbetsstatus, lås eller den gemensamma dashboarden.

## Genvägar

Varje rad har genvägar till besiktningen, **Utlåtande** (den redigerbara
Granska-vyn) och entreprenaden. Granska-vyn har en synlig **Till entreprenaden**-
knapp. Utlåtandets förhandsgranskning och publika delningslänk ändras inte.

## Integritet och databas

Uppgifterna ligger i separata interna tabeller med organisations-, entreprenad-
och besiktningskoppling. Servern kontrollerar modulåtkomst och organisation;
anonyma/publika rapportlänkar har ingen åtkomst till faktureringen. Markeringen
och fakturanumret tas bort när en publik rapportversion skapas.

Kör `docs/db/2026-11-07_01_eb_inspection_billing.sql` före publicering. Den
lägger till lagring, historik och atomär sparning. Före migrationen fortsätter
besiktningsarbetet fungera, men faktureringen visas som otillgänglig och kan
inte sparas. Äldre besiktningar utan markering får status Ej fakturerad först
när databasstödet faktiskt är tillgängligt.
