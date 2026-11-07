# Fakturaunderlag Och Projektavslut

## Avgransning 2026-11-07

- Fakturan skapas manuellt i Fortnox eller annat ekonomisystem. Hushub skapar
  endast ett separat fakturaunderlag som PDF att bifoga till fakturan.
- Ingen betalstatus, bokforing, fakturanummerserie, Fortnox-export eller utskick
  byggs. Markeringen Fardigfakturerat ar en manuell bekraftelse, inte en berakning.
- Underlag ar frivilliga. Det gar att bekrafta slutfakturering som gjorts helt
  utanfor Hushub. Budget, kalkyl, avtal och betalningsplan ar aldrig fakturor.
- Underlag har egna beskrivningsrader, mangd, enhet, a-pris exklusive moms och
  momssats. Inga belopp eller rader kopieras automatiskt fran andra moduler.
  Avsandare och fakturakund kan uttryckligen hamtas som utgangsvarden. Sparat
  underlag bevarar sina egna uppgifter och revisionshistorik.
- Underlag autosparas. PDF anvander en bekraftad sparad revision, aldrig lokalt
  osparad text. Dokumentet heter Fakturaunderlag, inte Faktura, och har inga
  betalningsinstruktioner eller uppgift om betalning.
- Projektansvarig kan under Oversikt markera Arbetet klart och Fardigfakturerat.
  Avsluta projekt kravs bada markeringarna och att samtliga fragor ar Avslutade.
  Besvarad ar inte samma sak som avslutad. Kontrollen gors atomart i databasen,
  aven for fragor som inte visas i en viss deltagares lista.
- Avslut anvander befintlig status completed och befintligt filter Avslutade
  projekt. Inga avtals-, kalkyl-, moment- eller fragetexter skrivs om.
- Endast projektansvarig far avsluta/ateroppna och andra slutmarkeringarna.
  Ateroppning loggas och nollstaller slutmarkeringarna. Den oppnar aldrig ett
  last avtal. Nya eller ateroppnade fragor kravs forst ateroppning av projektet.
- Befintliga avslutade projekt migreras inte. Vid uttrycklig ateroppning atertas
  sparad tidigare status, annars Pagar. Alla andringar loggas med aktor och tid.
- Migrationen ar additiv. Ingen SQL kors i produktion eller publicering sker
  utan separat bestallning. Endast syntetiska projekt anvands vid skrivtester.

## Teknik

`2026-11-07_01_project_completion_and_invoice_basis.sql` lagger till privata
tabeller for slutmarkeringar, underlag och append-only handelsehistorik.
Aktivt organisationsmedlemskap och Uppdrag-atkomst kontrolleras i API:t.
RPC:n kontrollerar aktor, projekt, ansvarig, revision och idempotent request-ID.
Projektets radlas serialiserar avslut mot frageandringar och underlagssparning.
Saknad migration visas som ej aktiverad, aldrig som noll oppna fragor.

Underlagens belopp lagras i heltalsore. Tomt belopp och noll ar olika saker.
PDF anvander Hushubs gemensamma PDF-renderare och lokala Manrope-typsnitt.
Underlag delas inte automatiskt med bestallaren eller projektets filbibliotek.

## Verifiering 2026-11-07

- Uppdragsvitens 988 tester passerade; ytterligare tva PDF-/exporttester och de
  riktade databas-, doman- och servertesterna passerade efter slutandringarna.
- Klicktest med fiktiva uppgifter: slutmarkeringar, oppna-fragor-sparr,
  avslut/ateroppning, autosparning, nyare text under pagaende sparning, nollpris,
  tomt pris, sparfel med samma request-ID vid aterforsok samt omladdning.
- Skarmbilder granskade vid 390, 768 och 1440 pixlars bredd. Ingen sidrullning.
- Tva sidors test-PDF granskad visuellt och med textextraktion: alla rader,
  summering, underlagsreferens och sidnummer finns med.
- Typkontroll, lint av nya produktionsfiler och isolerat Next-produktionsbygge
  godkanda. Bygget anvande en lokal test-URL och ingen produktionsnyckel.
- SQL ar endast kord i PGlite-tester. Ingenting publicerat eller andrat i drift.
