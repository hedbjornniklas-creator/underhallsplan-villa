# Utskick, historik och kopierbar kundlänk

Skicka utlåtande visar redigering/låsning, publicerad version, senaste registrerade utskick och PDF separat. Utskicksstatusen är inte en följd av `completed` eller `locked_at`. Alla tider visas i `Europe/Stockholm`.

## Databas och driftsättning

Kör `docs/db/2026-11-06_01_ob_report_delivery_history.sql` före publicering. Migreringen är idempotent och ändrar inte snapshots, PDF-filer, tokenhashar eller tidigare kundlänkar. Nya utskick får `inspection_id`, `report_link_id` och ett gemensamt `report_dispatch_id` för mottagarna i samma försök. Tidigare utskick kopplas automatiskt endast när en befintlig uppdragsbekräftelse-FK bevisar besiktningstillhörigheten. Fristående äldre utskick utan denna koppling kräver separat verifiering. Ingen matchning görs automatiskt på e-postadress, ämne eller tid.

`docs/db/2026-11-06_02_ob_mokarr_delivery_history.sql` är en separat, avgränsad rättning för de tre specifika utskicks-ID:n som identifierades vid felsökningen av Mokärrsvägen. Den verifierar organisation, besiktning, fastighet och meddelandenas ursprung och status innan den fyller i en saknad besiktningskoppling. Den hittar inte på en rapportversionskoppling som den gamla mejlloggen saknar och ändrar inte innehållet i några dokument. Skriptet avbryter vid avvikande förutsättningar.

Historiken läses genom service-role-vyer, bakom den befintliga besiktnings- och organisationsbehörigheten. Äldre versioner finns kvar i historiken även när deras kundlänkar är återkallade. Datum, mottagare, person när den är känd, rapportversion och fel visas. `Visa äldre` använder en stabil cursor med tid och händelse-ID, inte ett tyst maxantal.

Klarmarkering och låsning sker tillsammans med audit-händelser i en databastransaktion. Inget nytt utskick tillåts om den nya audit-migreringen inte kan verifieras. En saknad historik får aldrig tolkas som ett säkert besked om att inget har skickats.

## Kopiera länk

Knappen kopierar en kundlänk till den aktuella aktiva publicerade snapshoten. URL:en hämtas av den ansvariga besiktningsmannen vid läsning av sidans metadata, före klicket. Clipboard-anropet gör därför inget nätverksanrop innan det använder mobilwebbläsarens användargest. Vid nekad urklippsåtkomst visas länken i ett markerbart fält. Ingen SMS-app öppnas och inget meddelande skickas.

Äldre ursprungliga bearer-token finns bara som hash och kan inte återskapas. Den kopierbara länken använder därför en separat HMAC-signerad referens till samma rapport, bunden till rapport-ID, organisation, besiktning och den ursprungliga tokenhashen. Den skapar ingen rapportversion, databaspost eller ny publicering och ändrar inte den ursprungliga länken. Samtliga publika läs-, PDF-, delnings- och miljöbilagevägar verifierar signaturen och den befintliga återkallningen. En återkallad version blir aldrig tillgänglig igen genom kopiering.

Signeringsnyckel: `OB_REPORT_LINK_SIGNING_KEY`, annars befintlig `SUPABASE_SERVICE_ROLE_KEY`. En särskild stabil produktionsnyckel rekommenderas. Rotation av använd nyckel bryter tidigare kopierade signerade länkar; ursprungliga mejllänkar påverkas inte. Bearer-URL:er ska inte loggas eller läggas i analysverktyg.

## Versionssäkerhet

`Skicka publicerad version igen` använder samma snapshot och ändrar varken PDF, innehåll, tidigare länkar eller redigeringsläge. Det bygger inte en ny rapport från dagens databas. Publicering från ett öppet utkast är en separat tydligt namngiven åtgärd. Historiska PDF-länkar hämtar exakt vald lagrad version via den autentiserade vägen, även för en ersatt version. Det utökar inte offentlig åtkomst och återskapar aldrig en saknad historisk PDF från aktuella besiktningsdata.

Registrerat som `sent` betyder accepterat utskick hos e-posttjänsten. Det utlovar inte leverans till inkorgen eller att kunden har läst mejlet. Leveranswebhooks och läskvitton ingår inte i denna ändring.

## Verifiering

- `test/ob-report-delivery-history.test.ts`: tidszon, cursor, signerade kundlänkar, återkallning och kopieringsvägens avsaknad av sidoeffekter.
- `test/ob-report-delivery-history-sql.test.ts`: riktig SQL i PGlite, upprepad migrering, historiska versioner, tenantbindningar och atomisk audit.
- Befintliga tester för frysta rapporter, PDF, Word och publika rapporter körs som regression.
- Syntetisk layout på `/round?section=delivery&delivery-history&locked&completed` via `scripts/preview-ob-brand.mjs --forms`.

Verifierat 2026-11-06: 116 regressionstester godkända, produktionsbygge och applikationens typkontroll godkända. Webbläsartest på 320, 390 och 1280 px verifierar kopiering, reservfält, äldre historik, versionsbundna PDF-länkar och frånvaro av horisontellt överflöde. Testet använder en isolerad urklippsmock och syntetiska data, inte användarens urklipp eller riktiga utskick.

Ingen riktig besiktning eller mottagare används för testutskick.
