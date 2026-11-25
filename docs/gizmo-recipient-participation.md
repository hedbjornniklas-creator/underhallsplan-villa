# Mina uppdrag: delat deltagande

Beslut 2026-11-18: deltagande i en publicerad projektfraga ska inte vara
beroende av aktuell ansvarig eller av att ett aviseringsmejl har kommit fram.

## Regler

- Aktiva deltagare far en gemensam fraga i Mina uppdrag efter forsta uttryckliga
  delningen eller utskicket. Ett internt, aldrig delat utkast visas inte.
- Senare tillagda deltagare ser hela den tidigare gemensamt delade dialogen
  och dess delade bilagor. Inga interna anteckningar eller endast valda filer delas.
- Ansvarigbytet sparas forst, och utskick till den nya ansvariga sker separat.
  Statusflodet och tidigare direktlankars aterkallning andras inte.
- Tidigare mottagare behaller inloggad, lasande tillgang till sitt tidigare
  delade uppdrag fram till ansvarigbytet, inte till senare privata meddelanden.
  Enskilda uppdragsdialoger slas inte ihop med fragans gemensamma dialog.
- Borttagning fran fragan eller avaktivering av identiteten/kontakten sparrar
  tillgangen. Kontot maste ha verifierad, matchande e-postadress.
- Skicka om lank i Deltagare aviserar en vald person om den redan publicerade
  versionen. Varken osparad text eller nya bilagor skickas med. Aterforsok anvander
  samma request-id, och mottagaren har en kort frekvensbegransning.
- Vanliga uppgifter anvander sin befintliga utskicksfunktion med knappnamnet
  Skicka om lank. En projektfragans privata ansvariguppdrag finns separat.
- En delad fraga med ett eget kopplat uppdrag visas en gang under Aktiva/Alla.
  Det egna uppdraget och dess privata historik oppnas fran fragan. Ansvarsstatistik,
  Ditt nasta steg och Forsenade behaller uppdragets befintliga statusflode.

## Driftsattning

Kor `docs/db/2026-11-18_01_recipient_participation.sql` fore applikationen.
Migreringen ar transaktionell och aterkorbar. Den kompletterar enbart publicerade
fragors sakra snapshots och befintliga aktiva deltagares kontokopplingar.
Den skickar inga mejl och skriver inte om avtal, kalkyler eller fragans utkast.

Regressioner: `test/recipient-participation-db.test.mjs`,
`test/recipient-participation-api.test.mjs` samt befintliga task/question-tester.
Fiktiv UI-kontroll: `node scripts/preview-recipient-participation.mjs`.
