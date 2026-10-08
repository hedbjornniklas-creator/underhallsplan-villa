# Slutgiltiga beslut och beslutsmejl

Produktbeslut 2026-10-08: fattade beslut får inte ändras. Detta ändrar inte
styrelsens möjlighet att fatta ett första beslut trots kvarstående frågor eller
underlag. Utkast kan inte beslutas. Motivering krävs alltid, villkorstext dessutom
vid godkännande med villkor.

## Implementation

- `renoapp_record_final_decision` låser ärenderaden och sparar status, beslut och
  historik i samma transaktion. Samma försöks-ID med samma innehåll ger samma
  beslut. Andra försök nekas efter beslut, även från gamla flikar.
- Databastriggers stoppar statusändringar efter beslut och ändring/borttagning av
  själva beslutsuppgifterna. Gallring av ett helt ärende via befintlig cascade
  hindras inte; detta inför ingen gallringsfunktion. FK-nollställning av besluts-
  fattarens profil vid kontoborttagning tillåts utan att beslutstext ändras.
- Vyn visar det sparade beslutet i stället för beslutsformuläret. Det finns ingen
  omprövning eller återöppning.
- Beslutsmejl innehåller beslut, motivering, eventuella villkor och länk till
  samma ansökan. RenoApps gemensamma mejlmall/avsändare används, med BRF som Reply-To.
- Mejlunderlaget sparas före utskicket och återanvänds oförändrat tillsammans med
  en idempotensnyckel per beslut. Inget nytt beslut skapas vid återförsök.
  Mejlunderlaget innehåller en personlig länk och är bara åtkomligt för servern.
- `sent` betyder accepterat av mejlleverantören, inte bekräftad inkorgsleverans.
  Fel eller avsaknad av bekräftelse visas även efter omladdning. En behörig
  styrelseanvändare kan då trycka Skicka beslutsmejlet.
- Återförsök gäller bara senaste beslutet på ett avslutat ärende. Läsning av
  ärendet eller publicering av koden skickar inte gamla mejl automatiskt.

## Driftsättning

Kör hela `docs/db/2026-10-08_01_renoapp_final_decisions.sql` innan koden publiceras.
SQL är inte körd i produktion av kodändringen. Ingen extern tjänst behöver läggas
till. Befintlig Resend-konfiguration används.

Äldre beslut ändras inte och får leveransstatus `unknown`, eftersom äldre kod
inte skickade beslutsmejl. Om ett ärende redan har flera beslut behålls de alla;
nya beslut spärras. Ingen automatisk rättning av äldre statusar görs. Ett äldre
ärende vars status inte stämmer med beslutshistoriken behöver granskas separat.

Verifiera efter publicering ett nytt testbeslut och ett manuellt utskick av ett
befintligt testbeslut. Kontrollera mottagandet i inkorgen separat. Ett tidigare
beslut ska inte fattas på nytt för att få iväg mejlet.

## Tester

- `node --experimental-strip-types --test test/renoapp-final-decisions.test.ts test/renoapp-completion-api.test.ts`
- `node scripts/test-renoapp-final-decisions-ui.mjs` (isolerad fixture på 344 och 1440 px)
- `npx tsc --noEmit --incremental false`

Testerna skickar inga riktiga mejl och kör inte SQL i produktion.
