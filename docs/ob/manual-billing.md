# ÖB: manuell fakturamarkering

## Beslut 2026-11-07

- En separat intern ruta **Fakturering – endast internt** på **Skicka utlåtande**,
  efter utskicksknapparna och före PDF-status/logg.
- Kryssrutan **Fakturerad**, frivilligt fakturanummer samt vem/när. Uppgifterna
  autosparas med revisionsskydd och historik. Avmarkering behåller fakturanumret
  om användaren inte uttryckligen tömmer det.
- Rutan skapar/skickar ingen faktura och visar inte om kunden har betalat.
  Utskick eller klarmarkering får aldrig automatiskt fakturamarkera besiktningen.
- Markeringen tillhör besiktningen, inte fastigheten, uppdragsbekräftelsen eller
  mottagarens e-postadress. Den fungerar även utan uppdragsbekräftelse.
- Låsta utlåtanden lämnas låsta och orörda. Intern fakturering kan ändras separat.

## ÖB-listan och ändrat färdigbegrepp

Användarens tillägg 2026-11-07: en ej fakturerad besiktning ska inte räknas som
helt klar i listans urval. Därför ligger en klarmarkerad men ofakturerad besiktning
kvar i **Aktuella**. Först när både besiktningen är färdig och faktureringen är
markerad räknas den till **Avslutade**. Befintlig hantering av arkivering och
avbokning behålls. Den riktiga besiktningsstatusen och fakturastatusen visas var för
sig. Ingen status skrivs om i besiktningsposten och dashboardens arbetsstatus ändras inte.

Listan visar endast fakturastatus, inte kryssruta eller fakturanummer.
**Att fakturera** visar färdiga, bekräftat ofakturerade besiktningar; uppdrag utan
besiktning ingår inte. Urval och totals beräknas på servern före paginering, inte
bara bland raderna på skärmen. Filtret är fristående från **Kräver åtgärd**.

## Åtkomst och införande

Följ ÖB:s organisationsbindning, modulbehörighet och ägargräns. Tillåten
kollegavisning förblir skrivskyddad och får bara se fakturastatus, inte nya
fakturanummer eller ändrarhistorik. Även listans serversvar innehåller bara
statusprojektionen, inte de privata fakturadetaljerna. Fakturauppgifter lagras separat från rapport-
och leveransdata och exponeras aldrig genom kundens rapportlänkar eller PDF.

Kör `docs/db/2026-11-07_02_ob_inspection_billing.sql` före publicering av appkoden.
Före migrationen ska fakturering vara uttryckligt otillgänglig, inte antas
fakturerad/ofakturerad. Översikten kräver det nya databasstödet för att kunna visa
korrekta urval/antal. Befintliga besiktningar får ingen automatisk markering som
fakturerade; det kan inte härledas från ett skickat utlåtande.
