# HF17 I Uppdrag

## Beslut 2026-11-03

Hantverkarformularet 17 ska vara ett eget avtalsval i Offert och Avtal, vid sidan
av ABS 18 och egen avtalshandling. Valet galler respektive redigerbart dokument.
Inget befintligt utkast, skickat dokument eller last avtal byter form automatiskt.
Gashaga ska uttryckligen stallas om till HF17 efter driftsattning. Lokevagens
redan lasta avtal far inte andras.

## Originalhandling

- Kalla: Konsumentverket, BO 2017:6, Hantverkarformularet 17, hamtad 2026-11-03.
- Original: https://publikationer.konsumentverket.se/downloads/bo-2017-03-hantverkarformularet-17/230/view
- Fyra sidor, oforandrad PDF inklusive formular och allmanna bestammelser.
- Lokal tillgang: `public/hf17-2017.pdf`, fast storlek och SHA-256 i standardregistret.
- Ingen exakt utgivningsdag finns angiven; endast utgava 2017 visas. Systemet
  hittar inte pa ett datum for att komma forbi handlingsvalideringen.
- Originalet anvands som en separat standardbilaga. HusHubs projektspecifika
  offert/avtals-PDF ar inte en omritad kopia av det upphovsrattsskyddade formularet.

## Implementerat

- Samma avtalsvaljare anvands i offertuppgifter och avtalets uppdrag.
- Originalbilagan lagras privat per organisation, projekt och utgava med stabilt
  ID, utan overskrivning. Upprepade forsok skapar inte dubbla bilagor.
- Explicit byte tar bort den tidigare automatiska standardbilagan fran det
  redigerade dokumentet, inte fran projektets filer eller historiska versioner.
- Automatiska ABS 18-ansvars- och betalningstexter tas bort nar de ar exakt
  oforandrade standardtexter. Egna projektspecifika texter behalls och ska granskas.
- HF17 erbjuder inte ABS 18-knappen for att aterstalla arbetsmiljotext.
- PDF och kundvy visar Hantverkarformularet 17, vald avsandare och dokumentets
  befintliga omfattning och prisvillkor. Budget blir aldrig en fast kontraktssumma.
- Utskick verifierar vald originalutgava. Lasning verifierar standardfiler som
  faktiskt valts, men gor inga nya uppgifter obligatoriska for lasning.
- Inget skickas till bestallaren automatiskt nar avtalsgrund eller budget andras.

## Installation Och Kontroll

Kor `docs/db/2026-11-03_03_hf17.sql` fore publicering. Migreringen ateranvander
befintliga tabeller, behorigheter och revisionskontroller och skriver ingen
befintlig dokumentdata. Standardrutinerna ar inte direkt tillgangliga for anonym
eller vanlig inloggad webblasaratkomst.

Tester provar normalisering, formularet i bada redigerarna, byte i bada riktningar,
bevarande av egna texter och frysta snapshots, oforandrade PDF-bytes, separat
lagring, idempotens, korrupta filer och server/databasvalidering. Klick- och
layouttester anvander endast fiktiva projekt; Gashaga uppdateras sedan genom
normala granssnitt med anvandarens uttryckligen bestallda uppgifter.
