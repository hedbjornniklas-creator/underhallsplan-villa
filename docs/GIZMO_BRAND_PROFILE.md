# Gizmo / Uppdrag - varumärkesprofil 2.1

Beslutad riktning: 2026-10-01. Implementation och verifiering dokumenteras nedan.
Gäller Uppdrags interna projektlista, projektytor och tillhörande arbetsdialoger.
ÖB, EB, TU och RenoApp ändras inte. Offertdokument, avtalsversioner och kundens
godkännandeflöde får inte ändras som en följd av en visuell uppdatering.

## Grund

Utgår från [ÖB:s varumärkesprofil 1.2](OB_BRAND_PROFILE.md): kompakt hierarki,
sammanhängande listor, vita arbetsytor, tunna avdelare, lokalt Manrope och noll
teckenavstånd. ÖB:s blå modulidentitet eller produktregler kopieras inte.
Gizmos befintliga tokens i `src/components/tasks/uppdrag-theme.css` behålls.

- Gizmo är modulens namn. Projekt, projektarbete och uppgift beskriver olika nivåer.
- BesiktApps befintliga globala produktnavigation och logotyp behålls.
- Ingen ny maskot eller omritad logotyp ingår.
- Grafit #252A2D för primärhandlingar och viktig text, #101518 vid hover.
- Dämpad gul #F2D76A används sparsamt i vald navigering och förhandsgranskning.
- Grönblå #206961 används för länkar och tangentbordsfokus.
- Vita arbetsytor, neutral stödtext #596368 och avdelare #D5DCDD.
- Ingen gul/beige bakgrund över hela sidan, gradient eller dekorativ hero.
- Status uttrycks i ord; färg eller en stapel får aldrig ensam förmedla betydelsen.

## Struktur

1. **Projektlista:** välj projekt. Ingen redigerare eller förvalt projekt bredvid listan.
2. **Projektarbetsyta:** ett projekt, ett huvud och en gemensam navigering.
3. **Åtgärd:** sidopanel för omfattning, underlag och intern kalkyl.

Projekt är standardvyn på /uppdrag. Aktuellt och Statistik behålls som
separata tvärgående vyer. Länkar till en specifik befintlig uppgift öppnar fortsatt
uppgiften i Aktuellt; uppgifter och projekt slås inte ihop i databasen.

Projektnavigering: Översikt, Projektarbete, Offert och avtal, Val och tillval,
Betalningsplan, Tidsplan, Bilder och filer. Visa som beställare är en avskild
förhandsgranskningshandling i projekthuvudet. Kundens sida har inte intern meny.
Granska grundavtal hör till Offert och avtal, inte till ytterligare en projektnivå.

## Listor och dator

- Högst 1856 px för listan och 1600 px för projektets meny plus arbetsyta.
- En rad per projekt, med namn/adress, beställare, status och konkret åtgärdsbehov.
- Vita rader, tunna horisontella avdelare, inga kort eller statuspiller per projekt.
- Projektarbete använder varianten **Tydlig tabell**: tonad rubrikrad #EDF1F1,
  grafitfärgade kolumnnamn i 12 px/vikt 600 och vita åtgärdsrader med raka
  avdelare, utan rundade hörn. Åtgärdsnamn har vikt 600; stödtext är dämpad.
  Rader har minst 60 px höjd och får växa när text behöver radbrytas.
- Handlingsförteckningen i Avtal använder samma tabellvariant och tokens.
  Typ, namn och datum sammanfattas i en rad. En handling öppnas åt gången
  för redigering; nya handlingar öppnas direkt. Filöppning finns i raden med
  ikon, tooltip och separat flik. Långa typer har tooltip och visas i sin
  helhet vid redigering. På smal yta staplas typ och datum under namnet.
- Hela åtgärdsraden öppnar den befintliga sidopanelen. Pekning och
  tangentbordsfokus ger grönblå ton #F1F6F5 och en tunn vänstermarkering.
  Öppen åtgärd markeras med befintlig dämpad gul färg. Markeringar och
  fokusram får inte ändra radens storlek eller flytta andra rader.
- Sökning, aktivt/avslutat/alla-filter och Nytt projekt i samma verktygsrad.
- Sortering och sidbläddring är sekundära; högst 25 projekt per sida.
- Projektrader är normalt 72 px inklusive två rader för projekt/objekt.
  Detta är en minhöjd: text får radbrytas utan att klippas.
- Sidrubrik 26/34 px vikt 600; sektionsrubrik 20/28; underrubrik 16/24.
  Listtext 14/21 px, vikt 400, projektnamn vikt 600. Ingen viewportskalad text.
- Kontroller minst 44 px. Lucide-ikoner med namn och tooltip för verktyg.
- Sidomenyn ligger kvar inom projektet. Åtgärdsdialoger behåller stängningsskydd,
  tangentbordsfokus och samma visuella identitet även när de renderas via portal.

## Mobil

- Sidrubrik 22/30 px, listtext och inmatning minst 16 px, kontroller minst 48 px.
- Projektlistan byter till staplade rader under 56 rem innehållsbredd.
- Projektnavigeringen blir en horisontellt rullningsbar navigeringsrad under
  768 px. Bara menyn får rulla i sidled, inte formulär eller hela sidan.
- Ingen fast nederkantsrad som täcker formulär eller tangentbord.
- Samma funktioner och uppgifter som på dator, inte en andra datamodell.
- I smalt Projektarbete staplas radens uppgifter. Rubrikbandet behålls med
  "Åtgärd" medan övriga kolumnrubriker döljs. Långa namn bryts utan sidrullning.

## Sanning och säkerhet i gränssnittet

- Visa sparat, osparat och pågående arbete utifrån verkligt tillstånd.
- Autosparstatus har reserverad höjd i åtgärdspanelens sidfot. Ingen tillfällig
  sparrad ovanför projektlistan som flyttar innehållet vid varje ändring.
  Sparfel visas med befintlig toast och finns kvar i åtgärdsraden tills de är
  lösta. Sidopanelen behåller utkastet och erbjuder ett nytt sparförsök.
- Navigation följer `docs/UI_FEEDBACK_STANDARD.md`: projektlänkar använder
  gemensamma `PendingLink`, visar vänteläge direkt och spärrar upprepade klick.
  En långsam sidladdning visar "Öppnar projekt…" utan uppskattad procentsats.
  Läsfel visas på sidan med "Försök igen" som hämtar om serverunderlaget.
- Byte mellan projektdelar behåller formulärutkast och pågående uppladdning.
  Byte av projekt eller omladdning är inte samma sak som ett internt vybyte.
- Utkast, publicerad offert och godkänt grundavtal är olika tillstånd.
- Betalningsplanens belopp är inte fakturerat eller betalt. Ingen faktureringsgraf
  visas innan en verklig fakturakälla finns.
- Val/tillval ligger separat från grundavtalet. Planering är ingen beställning.
- Tidsplan visar en manuellt redigerad lista med moment, projektdel, start, slut
  och status. Moment kan hämtas från Projektarbete utan att befintliga datum ändras.
  Intern sparning och delning med beställaren är separata handlingar. Avtalstider
  och beslutsdatum visas separat. Beroenden och automatisk planering är senare steg.
- Dokumentåtkomst och delning använder befintliga behörighetsregler.
- Äldre /kund-länkar leder till samma projekts Offert och avtal.
- Den interna projektmenyn och projekthuvudet ska inte följa med vid utskrift.

## Beslutslogg

- 2026-10-07: Handlingsförteckningen komprimeras enligt den befintliga
  varianten Tydlig tabell efter användarens återkoppling. Det är samma
  Gizmo-profil, inte ett nytt formspråk. Autosparning, dokumentåtkomst,
  avtalsvillkorsroll och publicerade avtalsversioner är oförändrade.
- 2026-10-06: Användaren väljer **Tydlig tabell** för Projektarbete: tonad
  rubrikrad, tydligare åtgärdsnamn, raka avdelare samt peknings-/valmarkering.
  Gizmos färger, innehåll, sidopanel och befintligt autosparande behålls.
- 2026-10-06: Klickrespons och laddningsgränser införs i Uppdrag enligt den
  befintliga standarden från ÖB/EB. Interna vybyten är fortsatt direkta och
  behåller utkast. Projektöppning hämtar kontaktlistan utan uppdragshistorik
  och utför oberoende, behörighetsavgränsade läsningar samtidigt.
- 2026-10-01: Offert, val/tillval och delbetalningar får kompakta sammanfattningsrader.
  En rad öppnas åt gången; nya rader öppnas direkt. Att fälla ihop sparar inte och
  raderar inte något. Sammanfattningen visar rubrik, relevant status/datum och pris.
  Inmatning kan fortsätta under sparning; senare ändringar förblir osparade och
  ersätts inte av ett äldre serversvar. Samlat åtgärdspris är ett aktivt val,
  inte fiktiva timmar. Detaljrader bevaras utan att dubbelräknas.
- 2026-10-01: Manuell produktionsplan godkänns som ett första steg. Projektdel är
  fri text med förslag såsom Mark, Grund och Stomme, inte en ny obligatorisk
  projektstruktur. Delning ändrar inte avtalets låsta tider.
- 2026-10-01: Användaren godkänner projektlista och gemensam projektnavigering nu,
  inte längre som enbart framtida riktning. ÖB:s formspråk är förebild, Gizmos
  färger och identitet behålls. Befintliga funktioner återanvänds.
- Tidigare namnändring till Projektarbete kvarstår inne i projektet.
  Listnivån heter Projekt för att skilja val av projekt från arbete i projektet.

## Verifiering före publicering

Kontrollera listval, sökning, filter, tomläge, direktlänk och webbläsarens tillbaka.
Prova osparat offertutkast och planering genom alla projektdelar, betalningsplan,
åtgärdspanel, filvisning och skrivskyddad beställarförhandsgranskning. Kontrollera
dator, mobil och tangentbord, samt att inga utskick sker enbart genom navigering.

### Handlingsförteckning 2026-10-07

- Ingår i publiceringspaketet enligt Tydlig tabell. Datorns
  standardrader är 60 px; rubrikradens färg är #EDF1F1 med 12 px/vikt 600.
  Den öppna raden använder #FFF7D6. Markeringar ändrar inte radens dimensioner.
- Tangentbord, radbyte, omordning, autosparning under fortsatt inmatning,
  sparfel/återförsök och omladdning är klicktestade med fiktiva data.
  Mobil 390 och 344 px är kontrollerad utan sidöverflöde eller klippta fält.
- 305 action-case-regressionstester, TypeScript, riktad ESLint och
  produktionsbygge passerar. Ingen databas eller publicerad avtalsversion ändras.

### Navigationskontroll 2026-10-06

- 215 automatiserade action-case-tester, TypeScript, riktad ESLint och
  produktionsbygget passerar.
- En lokal Next-produktionsfixtur använder de riktiga komponenterna med fiktiva
  uppgifter och sex sekunders serverfördröjning. Klick och Enter visar omedelbart
  laddningsläget; tillbaka och återöppning fungerar.
- Ett simulerat serverfel visar ett bestående fel med återförsök. Återförsöket
  hämtar nya serverdata och öppnar projektet när felet försvunnit.
- Interna vybyten och webbläsarens tillbaka bevarar osparat offertutkast.
- Projektlistan kontrollerad på dator och vid 390 px mobilbredd utan sidöverflöde.
  Mobilklick visar samma laddningsläge.
- Ingen produktionsdata, SQL eller något utskick ändrades. Verklig svarstid på
  hushub.se återstår att mäta efter publicering.

### Åtgärdslista och sparstatus 2026-10-06

- Tydlig tabell kontrollerad i lokal testversion med produktionskomponenterna:
  tonad rubrikrad, raka 60 px-rader, markerad öppen åtgärd och tangentbordsfokus.
- Enter öppnar sidopanelen; Escape återför fokus till samma rad. Ny åtgärd och
  byte till Kalkyl efter en omfattningsändring fungerar fortsatt.
- Vid 390 px bredd staplas uppgifterna och långa namn bryts utan sidöverflöde.
- Autosparande visar inte längre en tillfällig rad ovanför listan. Sidfotens
  höjd är stabil vid väntan, sparat, sparfel och saknad rubrik. Sparfel behåller
  utkastet och kan återförsökas efter att sidopanelen har stängts och öppnats.
- 220 automatiserade action-case-tester, TypeScript och riktad ESLint passerar.
  Produktionsbygget passerar. Ingen produktionsdata eller något kundutskick
  ändrades i testerna. Driftsättning verifieras separat mot publicerad commit.

### Lokal kontroll 2026-10-01

- 172 automatiserade tester för action-cases passerade, inklusive sju nya för
  projektrouter, organisationsavgränsning, åtkomst och äldre länkar.
- TypeScript och riktad ESLint passerade.
- Produktionsbygget (`next build --webpack`) passerade med projektets befintliga
  lokala miljöinställningar. Den isolerade arbetskopian har ingen egen miljöfil.
- Klicktest med fiktiva data: sökning, tomt sökresultat, avslutade projekt,
  nytt projekt till rätt arbetsyta, åtgärdspanel och sparning.
- Osparat offertutkast, planerade tillval och betalningsrader behölls vid vybyte.
  Simulerat sparfel behöll texten; nytt sparförsök lyckades.
- Beställarförhandsgranskningen visade publicerad avtalsversion, inte ett
  osparat internt utkast. Inget verkligt utskick eller kundgodkännande gjordes.
- Dator samt mobilbredder 390 och 344 px kontrollerade. Smal projektlista
  staplar rader och verktyg utan horisontellt sidöverflöde.
- Projektmenyn, webbläsarens tillbaka och fokus i projektdialogen provades.
  Tidsplan är fortsatt en vy över befintliga tider, inte en ny planeringsmotor.

Den lokala UI-fixturen återanvänder produktionskomponenterna med en isolerad
testserver. Den ersätter inte kontroll av riktiga databasbehörigheter och
utskick efter publicering. Driftsättning verifieras separat mot publicerad commit.

### Kompakta projektredigerare 2026-10-01

- 188 automatiserade action-case-tester passerar, inklusive SQL-test av de nya
  migrationerna, organisationsgränser, revisionskonflikter och privata/delade planer.
- Lokal CUA-klickkontroll av sammanfattningsrader, fortsatt inmatning under sparning,
  sparfel/nytt försök, omordning och ta bort/ångra delbetalning.
- Samlat pris och uttrycklig överföring till offert provade, inklusive moms.
- Tidsplan: valbar import, sparning och uttrycklig delning provade. Senare interna
  ändringar ersatte inte den delade planen i beställarförhandsgranskningen.
- Bildminiatyrens laddade pixlar samt öppning i fullformat kontrollerade.
- Inga riktiga kunduppgifter, avtal eller utskick ändrades i dessa lokala tester.
- Publiceringskontroll 2026-10-01: båda nya migrationerna körda i produktion.
  Tidsplanens RLS och nekad klientåtkomst verifierade, liksom service-rollens RPC
  och den validerade databaskontrollen för samlat pris. Inga befintliga avtal ändrades.
