# Byggavtal Med Foretag Och Foreningar

## Beslut 2026-11-03

Uppdrag ska aven kunna anvandas for byggarbeten dar bestallaren ar en
bostadsrattsforening eller ett foretag. AB 04 och ABT 06 ar egna avtalsval i
Offert och Avtal. ABK 09 for konsultuppdrag ingar inte i denna andring.
Inget projekt stalls om automatiskt; Gashaga behaller HF17 och lasta handlingar
andras inte.

## Avtalsgrund

- AB 04 avser utforandeentreprenad; ABT 06 avser totalentreprenad.
- Valet styr inte automatiskt prisform, belopp, budget eller tidplan.
- Den tidigare automatiska konsumentbilagan valjs bort vid ett uttryckligt byte.
- Exakta automatiska ABS-texter tas bort. Egna redigerade villkor behalls.
- Byte mellan AB 04 och ABT 06 valjer bort den tidigare standardbilagan fran
  utkastet, men raderar varken projektfilen eller historiska versioner.
- BKK:s standardbestammelser saljs separat fran de fria kontraktsformularen.
  HusHub distribuerar inte en kopia utan verifierad rattighet. En egen tillaten
  PDF kan laddas upp bland projektfilerna och valjas som standardbilaga.
- Referens: https://foreningenbkk.se/produkter/ (kontrollerad 2026-11-03).
- HusHubs PDF ar en egen presentation, inte en kopia av BKK:s kontraktsformular.

## Bestallare

Bestallartypen Foretag eller forening anvander samma namnfalt och kontaktvagar
som befintliga parter, kompletterat med organisationsnummer, kontaktperson och
undertecknare. En juridisk person ar en bestallare; kontaktpersonen laggs inte
till som en extra avtalspart. Personnummer ska inte sparas i denna gren.
En uppgiven undertecknare innebar inte att HusHub har verifierat firmateckning.

Org-uppgifter visas i offert, kundgranskning och PDF. Underskriftsrutan i
avtals-PDF avser foretradaren for bestallaren. Alla priser behaller systemets
befintliga uttryckliga momsbenamningar och belopp; inget momsbyte eller
automatisk omrakning gors.

Den aldre registerkopplingen for privata avtalskunder ar inte utvidgad har.
Foretags-/foreningsuppgifter fylls i direkt i dokumentutkastet. Registerbindning
blockeras for denna gren sa att en forening aldrig skapas som privatkund.
Fakturakund hanteras fortfarande separat.

## Installation Och Kontroll

Kor `docs/db/2026-11-03_04_commercial_contracts.sql` efter HF17-migreringen och
fore publicering. Inga befintliga rader skrivs om. Nya data kontrolleras i server
och databas. Gamla flikar kan inte tyst radera organisationens uppgifter.
Validering av komplett underlag fore utskick ar separat fran lasning for
papperssignering, som fortsatt tillater tomma falt.
