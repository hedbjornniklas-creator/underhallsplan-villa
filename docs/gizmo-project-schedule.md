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

## Beslutsandring: Massval Och Synlig Radordning

Anvandaren vill kunna massmarkera moment vid hamtning fran Projektarbete och
ater ha flyttpilar synliga direkt i listan, inte bara inne i pennpanelen.

- Importen har Valj alla med mellanlage, Avmarkera alla och antal valda. Bara
  annu inte importerade projektmoment visas. Markeringar sparar eller delar inget.
- Lagga till valda moment hamtar det uttryckliga urvalet tillsammans och anvander
  befintlig autosparning. Om urvalet overskrider planens grans pa 200 moment visas
  hur manga som maste avmarkeras. Inga val kapas tyst och inga datum hittas pa.
- Upp/ned och penna ligger direkt pa varje rad. Ytterlagena ar avaktiverade.
  Flytt foljer momentets ID aven vid snabba klick, och samma ordning anvands i
  tabell och Gantt. Pilfunktionerna inne i panelen finns ocksa kvar.
- Avtal, datum, projektarbetets ordning och redan delad kundkopia andras inte.
  Endast den interna tidsplanens ordning autosparas; uppdaterad delning ar separat.

Andringen kraver ingen SQL. Anvandaren har godkant publicering efter granskad
forhandsvisning. Paketet innehaller endast importval, synlig radordning och
deras dokumentation och tester; inga avtalskomponenter eller API:er andras.

Verifiering: 771 avgransade tester, riktad ESLint och produktionsbygge passerar.
Klicktestet anvander enbart fiktiva uppgifter och bekraftar massval, avmarkering,
gemensam import utan dubbletter, snabba upp/ned-klick och sparad ordning efter
omladdning. Datorraderna ar fortsatt 40 px. I mobilramen ar rootens clientWidth
och scrollWidth bada 375 px; tabellen rullar separat och pilknapparna ar 40x44 px.

## Beslut 2026-11-03: Justerbar Gantt-hojd

Gantt-rutans nederkant har ett draghandtag for mus och pekskarm. Hojden kan
justeras mellan 180 och 1000 px utan att andra datum eller skalor valjs. Samma
handtag ar tangentbordsatkomligt: upp/ned justerar 40 px, Shift justerar 100 px,
Home/End valjer min/max. Escape eller avbruten pekdragning aterstaller dragningens
utgangspunkt. En aterstallningsikon ger tillbaka den innehallsanpassade
standardhojden (max 510 px pa dator, 430 px pa mobil).

Hojdvalet ar enbart lokal visningsstatus medan vyn ar oppen. Inget API-anrop,
autosparning, delning eller andring av avtal, projektmoment eller betalningsplan
gors. Ingen SQL behovs. Tom tidsplan visar fortfarande sin befintliga tomvy,
utan ett draghandtag for ett diagram som annu saknar datum.

Verifiering: 777 Uppdragstester, riktad ESLint och rent produktionsbygge inklusive
typkontroll passerar. Det nya komponenttestet provar pekfangst, mus/pekskarm,
granser, andra pekare, avbrott, tangentbord, aterstallning och observer-stadning.
Klicktestet bekraftar faktisk dragning pa dator och i 390 px mobilram,
tangentbordsjustering samt aterstallning. Mobilens clientWidth/scrollWidth ar
375/375 px och handtaget ar 44 px hogt. Testserverns revision ar kvar pa 0 med
8 ursprungliga moment, ingen delad kopia och noll skrivningar efter alla dessa
visningsandringar. Verifieringen anvander enbart fiktiva uppgifter.
