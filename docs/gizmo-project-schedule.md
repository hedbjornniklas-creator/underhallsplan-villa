# Gizmo: Visuell Produktionsplanering

## Beslut 2026-11-02

Anvandaren har godkant en Gantt-vy ovanfor en kompakt momenttabell. Varje moment
ska ligga pa en rad pa dator. Pennan oppnar redigering i en hogerpanel. Detta ar
en visuell utbyggnad av produktionsplaneringen, inte en andring av avtalade tider.

## Implementerat

- Vecko- och manadsskala, datumaxel med ar, dagens markering och statusfarger.
- Gantt och tabell anvander exakt samma lokala moment i samma ordning. Klick pa
  en stapel markerar motsvarande tabellrad. Pennan eller momentnamnet oppnar
  panelen med rubrik, projektdel, start, slut och manuellt vald status.
- Tabellen ar 40 px per rad pa dator och har en egen scrollruta pa smal skarm.
  Langa momentnamn forkortas visuellt; full text finns i panelen och tooltip.
- Kalenderdagar raknas inklusive start och slut, inte arbetsdagar. UTC-intervall
  fran D3 hanterar skottar, veckor, manader och sommartid utan datumforskjutning.
  Mycket langa planer far en begransad axel sa att vyn inte skapar tusentals tick.
- Ett ensamt start- eller slutdatum visas som en markering utan pahittad period.
  Helt odaterade moment behaller tomma datum och saknar stapel. Inga datum,
  beroenden, fardigprocent eller automatiska datumflyttar skapas.
- Befintlig autosparning, revision, konfliktskydd, import, flytt, borttagning och
  angra behalls. Att stanga panelen kastar inte en lokal andring. Sparfel visas
  aven i panelen med uttryckligt aterforsok. Hamta sparad tidsplan anvander en
  synlig bekraftelse och behaller text om lasningen misslyckas.
- Inget delas automatiskt. Bestallaren ser fortfarande endast den uttryckligen
  delade kopian. Avtalsdatum, offert, pris, betalningsplan och lasta underlag
  skrivs inte av dessa komponenter. Kundens befintliga dokumentvy behalls.

Ingen ny SQL behovs. Lagring och API ar oforandrade. De nya D3-beroendena anvands
endast for datumintervall och skalning; React renderar all anvandartext som text,
inte som HTML.

## Verifiering

`test/action-cases-schedule-timeline.test.mjs` provar tomma och partiella datum,
ogiltiga datum, kalenderdagar, skottar, sommartidsbyten, arsskiften och 200 moment
over en mycket lang period. `test/action-cases-schedule-ui.test.mjs` monterar
redigeraren med den verkliga sparningskon och provar sena svar, lokala ogiltiga
datum, panelstangning, flytt, borttagning/angra, sparfel, aterforsok och delning.

Klicktest: `node --experimental-strip-types scripts/test-background-saving-ui.mjs
--schedule-gantt`. Servern anvander enbart fiktiva uppgifter. Vecko/manadsvy,
datumredigering, borttagning/angra, sparfel och omladdning provas dar. Produktions-
SQL eller riktiga projekt anvands aldrig for mutationstester.

Denna tidsplaneandring byggs separat fran publiceringen av offertens sparstatus
och gemensam omfattning (`2ae97579`). Anvandaren har godkant en separat publicering.

Slutkontroll fore mobilrattningen: 766 avgransade regressionstester, riktad ESLint och ett rent
produktionsbygge inklusive Nexts typkontroll passerar. Fristaende tsc omfattar
aven aldre tester med befintliga konfigurationsfel; ingen testkonfiguration har
andrats for att dolja dem. Klicktesterna bekraftar 40 px datorrader, panelens
sparfel/aterforsok, angra under sparning och kvarvarande uppgifter efter omladdning.
Mobilkontrollen ar nu slutford i en fast 390 px iframe utan skarmemulering.
Den dolda kolumnrubriken anvander absolut position och behovde en positionerad
scrollbehalare. Utan den kunde rubriken bidra till hela sidans scrollbredd trots
att tabellen var klippt. Behalaren har nu position: relative; ett regressionstest
skyddar detta. Rotens clientWidth och scrollWidth ar bada 375 px (390 minus
scrollbar). Ett faktiskt horisontellt rullforsok lamnar sidans scrollLeft vid 0.
Tabellen rullar separat och pennan oppnar panelen, vars falt ryms utan overhang.
Testserverns `/__test__/responsive` gor denna kontroll reproducerbar.

Den slutliga releasekopians 767 tester, riktad ESLint och produktionsbygge
passerar efter mobilrattningen. Releasefilerna har hashjamforts med den testade
kopian. Publiceringspaketet andrar inga API:er, SQL-filer eller avtalskomponenter.
