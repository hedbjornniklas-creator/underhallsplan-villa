# Supabase: säkerhetsgranskning 17 november 2026

De 33 felen om avstängd RLS är åtgärdade i produktion. Skydd mot läckta
lösenord har aktiverats och kontrollerats efter att inställningen sparats.
Återstående varningar behöver fortsatt granskning; samtliga är inte åtgärdade.

Varningsmejlet skickades den 10 november och avsåg läget den 8 november.
Granskningen jämförde mejlet med aktuell Security Advisor, källkod och läsande
kontroller av produktionsdatabasens schema, rättigheter och policyer.

| Security Advisor | Före | Efter uppdatering |
|---|---:|---:|
| Fel | 33 | 0 |
| Varningar | 142 | 141 |
| Information | 124 | 149 |

Efterkontrollen gjordes den 17 november 2026. Informationsposter är en separat
klassificering och ska inte räknas som åtgärdade eller nytillkomna säkerhetsfel.

## Genomförda ändringar och verifiering

Tre granskade migrationer kördes i produktionsprojektets SQL Editor:

- [01: serverstyrda tabeller](db/2026-11-17_01_server_table_rls.sql) aktiverar
  RLS och tar bort direkta klienträttigheter på 25 tabeller. De auktoriserade
  serverflödena behåller service-rollens åtkomst.
- [02: klienttabeller och kataloger](db/2026-11-17_02_client_table_rls.sql)
  skyddar åtta tabeller. Egna certifieringar och tilläggstjänster kräver aktivt medlemskap i
  organisationen; byggnadsvärden följer fastighetsägaren. Befintliga publika
  läsrättigheter till plattformens tre kataloger bevaras. Övriga två kataloger
  är läsbara för inloggade användare.
- [03: byggnadsuppgifter](db/2026-11-17_03_building_warning_boundaries.sql)
  begränsar tre befintliga tabeller med restriktiva ägarpolicyer, inklusive
  kontroll när en rad får ett annat byggnads-ID.

Migrationerna ändrar rättigheter och policyer, inte verksamhetsrader. Inga nya
GRANT-rättigheter läggs till. Produktionskörningen rapporterade framgång.
Körartefaktens SHA-256:
`241e5e206b011f5ca61d9862b0e1c79d7e755c8c2ed543ab826ced7492f9df6d`.

Efterkontrollerna visar:

- Inga vanliga tabeller i `public` har längre avstängd RLS. De 36 granskade tabellerna
  har RLS och bevarade SELECT/INSERT/UPDATE/DELETE-rättigheter för service-rollen.
- Anonym direkt REST-läsning nekas på 33 tabeller med HTTP 401. Plattformens
  tre avsiktligt publika kataloger svarar HTTP 200. Oönskade klienträttigheter
  som DELETE, TRUNCATE och privilegier utanför avsedd åtkomst är borttagna.
- Service-rollens 36 REST-kontroller svarar HTTP 200. Dessa kontroller använder
  `limit=0` och läser inget kundinnehåll.
- RenoApps publika föreningslista och ansökningskonfiguration fungerar via
  server-API. Före och efter finns fyra listade föreningar, tolv åtgärdstyper
  och sexton frågor; ansökningskonfigurationens kontrollsumma är identisk.
- [Den lokala regressionen](../scripts/test-security-rls.mjs) klarade 310
  kontroller med syntetiska data, bland annat ägar-/organisationsgränser,
  nekade främmande skrivningar, service-åtkomst och avbruten omkörning.

Lokala SQL-prov kördes i PGlite/PostgreSQL 18.3; produktionen använder PostgreSQL
17.6. Produktionsmetadata och läsande HTTP-prov kompletterar dessa tester.
Inga riktiga kundärenden skapades eller ändrades för testen och inga testutskick
gjordes. Kompletta skrivflöden med en verklig inloggad användare verifierades inte.

Revisionsunderlaget har sparats separat med bland annat
`security-errors-before.csv`, `security-warnings-before.csv`,
`schema-access-before.csv`, `warning-details-before.csv`,
`table-access-after.json`, `http-before.json`, `http-after.json`,
`security-rls-test-results.json`, `execution-receipt.json` och `advisor-after.json`.
Rapporten innehåller inga nycklar, kunduppgifter eller personliga filsökvägar.

## Kvarstående varningar och nästa steg

De 141 kvarstående varningarna motsvarar följande klasser från förkontrollen,
med lösenordsskyddets varning borttagen:

| Klass | Antal |
|---|---:|
| SECURITY DEFINER-funktion tillgänglig för inloggad roll | 50 |
| SECURITY DEFINER-funktion tillgänglig för anonym roll | 38 |
| Funktion utan låst `search_path` | 32 |
| Policy med generellt sant uttryck | 19 |
| Publik Storage-bucket med listningsvarning | 2 |

De 19 policyvarningarna finns kvar trots restriktiva gränser. De granskade
tabellerna har restriktiva policyer som kombineras med de äldre tillåtande
policyerna. Även berörda Storage-policyer har restriktiva ägar- och
organisationsgränser. De generella uttrycken visar därför inte ensamma att
gränserna kan kringgås. Publik filåtkomst behöver ändå bedömas utifrån vad som
avsiktligt ska vara offentligt.

Nästa arbete är att låsa `search_path` i de 32 berörda funktionerna efter
granskning av varje funktions objektberoenden. Därefter bör SECURITY DEFINER-
funktionernas ägare, auktorisering och EXECUTE-rättigheter begränsas till vad
respektive server- eller klientflöde behöver. Varningsantalet visar inte i sig
vilka funktioner som kan anropas som RPC eller har en faktisk åtkomstbrist.

Granskningen fastställer inte om historisk obehörig åtkomst har förekommit.
