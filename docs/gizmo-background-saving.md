# Bakgrundssparning i Uppdrag

## Beslut 2026-11-02

Anvandaren har godkant att gora den interna redigeringen enhetlig: kalkylrader
och prisunderlag i Projektarbete, Offert och Tidsplan ska sparas i bakgrunden.
Utganspunkten ar den befintliga sparningskon. Text och belopp samlas efter en
kort skrivpaus. Fortsatt redigering far inte stoppas av en tidigare sparning.

- Sparstatus ska skilja pa osparat/ogiltigt utkast, sparar, sparat och sparfel.
- Nyare lokal text och tomma belopp far inte skrivas over av sena svar.
- Ofullstandiga lokala rader far inte bli gratis eller markeras som sparade.
- Gamla flikar ska avvisas med versionskontroll. Aterforsok maste vara idempotenta.
- Ett automatiskt hamtningssvar far aldrig ersatta en osparad tidsplan.
- Sparning ska begransas till berort projekt/moment, inte ladda om alla projekt.
- Skicka, dela, godkann, las, exportera och skapa projekt ar fortfarande uttryckliga
  kommandon. Behorighetsandringar och externa utskick autosparas inte som utkast.
- Intern kalkyl far inte bli avtalat kundpris. Befintlig koppling av omfattning
  fore lasning behalls. Lasta moment och signerade handlingar forblir lasta.
- Inga befintliga projekt eller avtal migreras till nya belopp.

## Avgransning

Avtal, Val och tillval, betalningsplan och Delning behaller sina befintliga
sparningsfloden. Meddelanden och svar publiceras inte automatiskt. Eventuella
privata meddelandeutkast eller nya delningsregler ar inte del av detta beslut.

## Genomgang Av Modulen

| Del | Sparning efter denna andring |
| --- | --- |
| Projektarbete: omfattning | Befintlig autosparning, samordnad med kalkylens versionskontroll. |
| Kalkylrader: belopp, mangd, kallor, anteckningar | Autosparning efter 700 ms skrivpaus, utan att lasa nasta rad. |
| Klar och borttagning av kalkylrad | Sparas direkt i samma ko; borttagning kraver fortfarande bekraftelse. |
| Arbetsdelens namn och omfattning | Autosparning; nya arbetsdelar far aterforsokssakert server-ID. |
| Direkt mangd/enhetskostnad och offertpaslag | Autosparning, med tydlig intern kostnad och moms. |
| Samlat kalkylpris | Autosparning. Byte av prisunderlag invantar tidigare sparningar. Raderna bevaras. |
| Offert | Befintlig utkastko anvands aven for det fristaende offertutkastet. Manuell sparknapp borttagen. |
| Tidsplan | Autosparning. Automatisk omlasning vantar tills lokala andringar ar sparade. |
| Avtal, Val och tillval, betalningsplan, Delning | Befintliga sparningsfloden behalls. Lasning invantar aven kalkylens osparade andringar. |
| Samlade massandringar och leverantorsofferter | Tillampas med avsiktligt kommando, efter att automatiska sparningar ar klara. |
| Filer, mottagare, utskick, kunddelning och signering | Fortsatt uttryckliga kommandon; inga automatiska utskick eller bestallningar. |

## Teknisk Implementering

- `save_calculation` returnerar bara det uppdaterade momentet och projektstatus,
  inte hela organisationens projektlista. Serverlasningen avgransas till projektet.
- En gemensam ko samordnar omfattning, kalkyl och efterfoljande manuella kommandon.
  Endast egna kvitterade versioner far flytta fram en vantande sparnings basversion.
- Kalkylsparningar anvander unika request-ID:n och Postgres mikrosekundversioner.
  Efter ett osakert natfel skickas exakt samma begaran igen innan nyare text sparas.
- Utkast ags av projektvyn, inte sidopanelen. Att stanga panelen kastar inte utkast.
  Nyare text, tomma belopp och sparfel ligger kvar. Hela sidan ska inte laddas om
  fore lyckad sparning; webblasaren varnar om osparade andringar finns.
- Vid konflikt kan anvandaren aterforsoka eller uttryckligen hamta sparad kalkyl.
  Ett misslyckat hamtningsforsok kastar aldrig utkastet.
- Gamla API-anrop for direkta radandringar utan versionskontroll avvisas med en
  uppmaning att ladda om klienten. Offertregistrering och andra uttryckliga
  kommandon behaller sina egna befintliga sparningsregler.

## Databas Och Leverans

Kor `docs/db/2026-11-02_01_action_case_calculation_autosave.sql` fore publicering.
Den lagger till en service-only RPC och en tabell for aterforsokskvittenser.
Inga befintliga kalkylbelopp, avtal, betalningsplaner eller filer skrivs om.
Filen kraver tidigare migrationer for kalkyl, arbetsdelar, Klar och avtalslasning.

Verifiering omfattar riktiga koer med fordrojda och forlorade svar, faktisk
Postgres-migrering i PGlite, tenant/aktor/versionskontroller och lasta avtal.
Klicktesterna anvander enbart fiktiva uppgifter och en lokal HTTP-server; inga
riktiga projekt har redigerats. Projektarbete och Tidsplan har provats med
sparfel, stangd/ateroppnad panel, samtidiga andringar och omladdning. Mobilvyn
har kontrollerats vid 390 px utan horisontell sidrullning. Offertens autosparade
rubrik ligger kvar efter omladdning och den separata avtalskopian ar oforandrad.

Den avgransade, rena verifieringskopians 756 tester och produktionsbygge passerar.
Riktad ESLint ar utan fel eller varningar.

## Publiceringspaket 2026-11-02

Anvandaren har bekraftat att SQL-filerna ar korda och godkant publicering av alla
aterstaende andringar i chatten: bakgrundssparning, tidsuppskattningar i Uppgifter
och utelamnande av tomma ansvarsrader i nya avtals-PDF:er. Lasande kontroll av
produktionens API-schema bekraftar bada nya tabellerna och de tre funktionerna
for kalkylsparning och tidsuppskattning. Den rena, sammanslagna kopians 771 tester
passerar. Inga riktiga projekt anvands for mutationstester. Driftsatt version och
skrivfri jamforelse av befintliga projektunderlag verifieras efter publiceringen.
